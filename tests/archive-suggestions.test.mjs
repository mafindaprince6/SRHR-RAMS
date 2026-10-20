import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { applySchema, asD1, loadWorker, openDatabase, tokenHash } from './sqlite-d1.mjs';

const worker = await loadWorker();
const archiveJs = readFileSync(new URL('../public/archive.js', import.meta.url), 'utf8');

async function session(db, username, token) {
  const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await tokenHash(token), user.id, '2099-01-01T00:00:00.000Z');
}
function call(db, path, token, { method = 'GET', body } = {}) {
  const headers = { cookie: `srhr_session=${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return worker.fetch(new Request('https://srhr.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { DB: asD1(db), ASSETS: { fetch() { return new Response('missing', { status: 404 }); } } });
}

test('catalogue suggestions are confirmed by an administrator and do not change amounts', async () => {
  const { db } = openDatabase();
  await applySchema(db);
  await session(db, 'directorate', 'tok-d');
  await session(db, 'secretary', 'tok-s');
  await session(db, 'admin', 'tok-a');
  const created = await (await call(db, '/api/requests', 'tok-d', { method: 'POST', body: { title: 'Acronym record', implementing_entity: 'DPPI', amount_nle: 40 } })).json();
  const detail = await (await call(db, '/api/archive/' + created.id, 'tok-s')).json();
  const entity = detail.suggestions.find(item => item.code === 'entity_acronym');
  assert.equal(entity.value, 'Directorate of Policy, Planning and Information');
  assert.equal((await call(db, '/api/archive/' + created.id + '/suggestions', 'tok-d', { method: 'POST', body: { code: 'entity_acronym', value: entity.value, note: 'Use the official name' } })).status, 403);
  assert.equal((await call(db, '/api/archive/' + created.id + '/suggestions', 'tok-a', { method: 'POST', body: { code: 'entity_acronym', value: 'Invented Office', note: 'Not allowed' } })).status, 400);
  const applied = await call(db, '/api/archive/' + created.id + '/suggestions', 'tok-a', { method: 'POST', body: { code: 'entity_acronym', value: entity.value, note: 'Store the official name' } });
  assert.equal(applied.status, 200);
  assert.equal((await applied.json()).amount_nle, 40);
  assert.equal(db.prepare('SELECT implementing_entity, amount_nle FROM requests WHERE id=?').get(created.id).implementing_entity, entity.value);

  const unknown = await (await call(db, '/api/requests', 'tok-d', { method: 'POST', body: { title: 'Unknown office', implementing_entity: 'Not A Real Office', amount_nle: 5 } })).json();
  const unknownDetail = await (await call(db, '/api/archive/' + unknown.id, 'tok-a')).json();
  assert.equal(unknownDetail.suggestions.find(item => item.code === 'unrecognised_entity').value, null);
  assert.equal((await call(db, '/api/archive/' + unknown.id + '/suggestions', 'tok-a', { method: 'POST', body: { code: 'unrecognised_entity', value: 'DPPI', note: 'Guess' } })).status, 400);

  db.prepare(`UPDATE requests SET status='Closed', closed_at=?, retention_category=NULL, retention_until=NULL WHERE id=?`).run('2026-10-01T00:00:00.000Z', created.id);
  const closed = await (await call(db, '/api/archive/' + created.id, 'tok-a')).json();
  const retention = closed.suggestions.find(item => item.code === 'retention_category');
  assert.equal(retention.value, 'operational');
  assert.equal((await call(db, '/api/archive/' + created.id + '/suggestions', 'tok-a', { method: 'POST', body: { code: 'retention_category', value: 'operational', note: 'Apply the existing operational rule' } })).status, 200);
  assert.equal(db.prepare('SELECT retention_category, amount_nle FROM requests WHERE id=?').get(created.id).retention_category, 'operational');
  assert.ok(db.prepare('SELECT retention_until FROM requests WHERE id=?').get(created.id).retention_until);

  const extractId = 'extract-1';
  db.prepare(`INSERT INTO documents(id,request_id,kind,file_name,created_at) VALUES('doc-1',?,'scan','note.txt',?)`).run(created.id, '2026-10-01T00:00:00.000Z');
  db.prepare(`INSERT INTO document_extracts(id,document_id,request_id,extracted_text,source,verified,created_at) VALUES(?,?,?,?,?,0,?)`).run(extractId, 'doc-1', created.id, 'facility note', 'operator transcription', '2026-10-01T00:00:00.000Z');
  const confirmed = await call(db, '/api/archive/' + created.id + '/suggestions', 'tok-a', { method: 'POST', body: { code: 'confirm_extract', value: extractId, note: 'Text checked by the records officer' } });
  assert.equal(confirmed.status, 200);
  assert.equal(db.prepare('SELECT verified FROM document_extracts WHERE id=?').get(extractId).verified, 1);
  assert.equal(db.prepare('SELECT amount_nle FROM requests WHERE id=?').get(created.id).amount_nle, 40);

  db.prepare(`INSERT INTO documents(id,request_id,kind,file_name,storage_key,checksum_sha256,created_at) VALUES('doc-a',?,'scan','a.pdf','key-a','abc',?)`).run(unknown.id, '2026-10-02T00:00:00.000Z');
  db.prepare(`INSERT INTO documents(id,request_id,kind,file_name,storage_key,checksum_sha256,created_at) VALUES('doc-b',?,'scan','b.pdf','key-b','abc',?)`).run(created.id, '2026-10-02T00:00:00.000Z');
  const integrity = await (await call(db, '/api/admin/audit/integrity', 'tok-a')).json();
  assert.equal(integrity.issues.some(item => item.code === 'duplicate_checksum'), true);
  assert.match(archiveJs, /Catalogue suggestions/);
  assert.match(archiveJs, /Amounts are not guessed/);
});
