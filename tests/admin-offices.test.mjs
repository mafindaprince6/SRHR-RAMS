import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { applySchema, asD1, loadWorker, openDatabase, tokenHash } from './sqlite-d1.mjs';

const worker = await loadWorker();
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../public/workflow.js', import.meta.url), 'utf8');

async function session(db, username, token) {
  const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await tokenHash(token), user.id, '2099-01-01T00:00:00.000Z');
}
function call(db, path, token, { method = 'GET', body } = {}) {
  const headers = { cookie: `srhr_session=${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return worker.fetch(new Request('https://srhr.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { DB: asD1(db), ASSETS: { fetch() { return new Response('missing', { status: 404 }); } } });
}

test('directorates and the request prefix are saved on the server', async () => {
  const { db } = openDatabase();
  await applySchema(db);
  await session(db, 'directorate', 'tok-d');
  await session(db, 'admin', 'tok-a');
  await session(db, 'finance', 'tok-f');
  assert.equal((await call(db, '/api/admin/entities', 'tok-d', { method: 'POST', body: { name: 'Blocked Office', note: 'No' } })).status, 403);
  const created = await call(db, '/api/admin/entities', 'tok-a', { method: 'POST', body: { name: 'Western Area Urban', acronym: 'WAU', type: 'Directorate', focal_person: 'Desk officer', note: 'Presentation office' } });
  assert.equal(created.status, 201);
  const entity = (await created.json()).entity;
  const visible = await (await call(db, '/api/entities', 'tok-d')).json();
  assert.equal(visible.some(row => row.name === 'Western Area Urban'), true);
  assert.equal((await call(db, '/api/admin/entities/' + entity.id, 'tok-a', { method: 'PATCH', body: { active: false, note: 'Office closed' } })).status, 200);
  const after = await (await call(db, '/api/entities', 'tok-d')).json();
  assert.equal(after.some(row => row.name === 'Western Area Urban'), false);
  const prefix = await call(db, '/api/admin/settings', 'tok-a', { method: 'PUT', body: { request_prefix: 'MOHS', reminder_hours: 48, note: 'Presentation numbering' } });
  assert.equal(prefix.status, 200);
  assert.equal((await prefix.json()).currency, 'NLe');
  assert.equal((await call(db, '/api/admin/settings', 'tok-f', { method: 'PUT', body: { request_prefix: 'FAKE', note: 'Not allowed' } })).status, 403);
  const request = await (await call(db, '/api/requests', 'tok-d', { method: 'POST', body: { title: 'Prefix check', amount_nle: 1000, implementing_entity: 'DPPI' } })).json();
  assert.match(request.request_number, /^MOHS-\d{4}-/);
});

test('a pending deliverable stops closure until IHPAU verifies it', async () => {
  const { db } = openDatabase();
  await applySchema(db);
  await session(db, 'directorate', 'tok-d');
  await session(db, 'secretary', 'tok-s');
  await session(db, 'chairman', 'tok-c');
  await session(db, 'finance', 'tok-f');
  const created = await (await call(db, '/api/requests', 'tok-d', { method: 'POST', body: { title: 'Deliverable close check', amount_nle: 5000, implementing_entity: 'DPPI' } })).json();
  await call(db, '/api/requests/' + created.id + '/transition', 'tok-s', { method: 'POST', body: { action: 'clear' } });
  await call(db, '/api/requests/' + created.id + '/transition', 'tok-c', { method: 'POST', body: { action: 'approve', approved_amount_nle: 5000 } });
  assert.equal((await call(db, '/api/requests/' + created.id + '/deliverables', 'tok-d', { method: 'POST', body: { title: 'Training report' } })).status, 403);
  const deliverable = await call(db, '/api/requests/' + created.id + '/deliverables', 'tok-f', { method: 'POST', body: { title: 'Training report', due_on: '2026-12-01' } });
  assert.equal(deliverable.status, 201);
  const deliverableId = (await deliverable.json()).id;
  await call(db, '/api/requests/' + created.id + '/disbursements', 'tok-f', { method: 'POST', body: { reference_number: 'IHPAU-DEL-1', amount_nle: 5000 } });
  const receipt = await (await call(db, '/api/requests/' + created.id + '/receipts', 'tok-f', { method: 'POST', body: { reference_number: 'RCT-DEL-1', amount: 5000 } })).json();
  await call(db, '/api/receipts/' + receipt.id + '/decision', 'tok-f', { method: 'POST', body: { decision: 'Verified', note: 'Matched' } });
  assert.equal((await call(db, '/api/requests/' + created.id + '/transition', 'tok-f', { method: 'POST', body: { action: 'close' } })).status, 409);
  assert.equal((await call(db, '/api/deliverables/' + deliverableId + '/decision', 'tok-f', { method: 'POST', body: { decision: 'Verified', note: 'Report received' } })).status, 200);
  assert.equal((await call(db, '/api/requests/' + created.id + '/transition', 'tok-f', { method: 'POST', body: { action: 'close' } })).status, 200);
});

test('admin screens no longer pretend to redesign the workflow', () => {
  assert.match(html, /enforced by the server/);
  assert.match(html, /\/api\/admin\/entities/);
  assert.match(html, /\/api\/admin\/settings/);
  assert.match(workflow, /\/api\/finance\/deliverables/);
  assert.doesNotMatch(html, /function moveStage/);
});
