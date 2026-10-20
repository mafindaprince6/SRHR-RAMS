import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { applySchema, asD1, loadWorker, openDatabase, tokenHash } from './sqlite-d1.mjs';

const worker = await loadWorker();
const reportsJs = readFileSync(new URL('../public/reports.js', import.meta.url), 'utf8');

async function session(db, username, token) {
  const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await tokenHash(token), user.id, '2099-01-01T00:00:00.000Z');
}
function call(db, path, token, { method = 'GET', body } = {}) {
  const headers = { cookie: `srhr_session=${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return worker.fetch(new Request('https://srhr.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { DB: asD1(db), ASSETS: { fetch() { return new Response('missing', { status: 404 }); } } });
}

test('management report covers queues, money, deliverables and hides drafts', async () => {
  const { db } = openDatabase();
  await applySchema(db);
  await session(db, 'directorate', 'tok-d');
  await session(db, 'secretary', 'tok-s');
  await session(db, 'chairman', 'tok-c');
  await session(db, 'finance', 'tok-f');
  const draft = await (await call(db, '/api/requests', 'tok-d', { method: 'POST', body: { title: 'Hidden draft', implementing_entity: 'DPPI', amount_nle: 10, status: 'Draft', fiscal_year: '2026' } })).json();
  const waiting = await (await call(db, '/api/requests', 'tok-d', { method: 'POST', body: { title: 'Waiting at secretary', implementing_entity: 'DPPI', amount_nle: 15, fiscal_year: '2026' } })).json();
  const created = await (await call(db, '/api/requests', 'tok-d', { method: 'POST', body: { title: 'Report execution', implementing_entity: 'DPPI', amount_nle: 80, fiscal_year: '2026' } })).json();
  await call(db, '/api/requests/' + created.id + '/transition', 'tok-s', { method: 'POST', body: { action: 'clear' } });
  await call(db, '/api/requests/' + created.id + '/transition', 'tok-c', { method: 'POST', body: { action: 'approve', approved_amount_nle: 80 } });
  await call(db, '/api/requests/' + created.id + '/disbursements', 'tok-f', { method: 'POST', body: { reference_number: 'PV-RPT', amount_nle: 30 } });
  await call(db, '/api/requests/' + created.id + '/receipts', 'tok-f', { method: 'POST', body: { reference_number: 'RC-RPT', amount: 10 } });
  await call(db, '/api/requests/' + created.id + '/deliverables', 'tok-f', { method: 'POST', body: { title: 'Session report' } });
  assert.equal((await call(db, '/api/reports/management', 'tok-d')).status, 403);
  assert.equal((await call(db, '/api/reports/management/export', 'tok-d')).status, 403);
  const report = await (await call(db, '/api/reports/management?fiscal_year=2026', 'tok-c')).json();
  assert.equal(report.by_status.some(row => row.status === 'Draft'), false);
  assert.equal(Number(report.summary.ihpau_queue) >= 1, true);
  assert.equal(report.execution.disbursed, 30);
  assert.equal(report.execution.outstanding_disbursement.amount, 50);
  assert.equal(report.execution.outstanding_liquidation.count >= 1, true);
  assert.equal(report.deliverables.pending, 1);
  assert.equal(report.approval_turnaround.decided >= 1, true);
  assert.equal(Number(report.summary.secretary_queue) >= 1, true);
  assert.equal(report.summary.missing_documents >= 1, true);
  assert.ok(waiting.request_number);
  assert.equal(report.document_storage, false);
  assert.equal(report.by_year.some(row => String(row.fiscal_year) === '2026'), true);
  const otherYear = await (await call(db, '/api/reports/management?fiscal_year=1999', 'tok-c')).json();
  assert.equal(otherYear.summary.total, 0);
  const csv = await (await call(db, '/api/reports/management/export', 'tok-s')).text();
  assert.match(csv, /disbursed_nle,verified_receipts_nle,pending_deliverables/);
  assert.match(csv, new RegExp(created.request_number));
  assert.doesNotMatch(csv, new RegExp(draft.request_number));
  assert.match(reportsJs, /Budget execution/);
  assert.match(reportsJs, /By fiscal year/);
});
