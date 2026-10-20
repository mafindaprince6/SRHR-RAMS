import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { applySchema, asD1, loadWorker, openDatabase, tokenHash } from './sqlite-d1.mjs';

const worker = await loadWorker();
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

async function session(db, username, token) {
  const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await tokenHash(token), user.id, '2099-01-01T00:00:00.000Z');
}
function call(db, path, token, { method = 'GET', body } = {}) {
  const headers = { cookie: `srhr_session=${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return worker.fetch(new Request('https://srhr.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { DB: asD1(db), ASSETS: { fetch() { return new Response('missing', { status: 404 }); } } });
}

test('due deliverables and unmatched disbursements store in-app reminders only', async () => {
  const { db } = openDatabase();
  await applySchema(db);
  await session(db, 'directorate', 'tok-d');
  await session(db, 'secretary', 'tok-s');
  await session(db, 'chairman', 'tok-c');
  await session(db, 'finance', 'tok-f');
  await session(db, 'admin', 'tok-a');
  const due = await (await call(db, '/api/requests', 'tok-d', { method: 'POST', body: { title: 'Due deliverable', implementing_entity: 'DPPI', amount_nle: 40 } })).json();
  await call(db, '/api/requests/' + due.id + '/transition', 'tok-s', { method: 'POST', body: { action: 'clear' } });
  await call(db, '/api/requests/' + due.id + '/transition', 'tok-c', { method: 'POST', body: { action: 'approve', approved_amount_nle: 40 } });
  await call(db, '/api/requests/' + due.id + '/deliverables', 'tok-f', { method: 'POST', body: { title: 'Session report', due_on: '2020-01-01' } });
  await call(db, '/api/requests/' + due.id + '/disbursements', 'tok-f', { method: 'POST', body: { reference_number: 'PV-REM', amount_nle: 40 } });
  db.prepare(`UPDATE disbursements SET created_at='2020-01-01T00:00:00.000Z' WHERE reference_number='PV-REM'`).run();
  const later = await (await call(db, '/api/requests', 'tok-d', { method: 'POST', body: { title: 'Not due yet', implementing_entity: 'DPPI', amount_nle: 10 } })).json();
  await call(db, '/api/requests/' + later.id + '/transition', 'tok-s', { method: 'POST', body: { action: 'clear' } });
  await call(db, '/api/requests/' + later.id + '/transition', 'tok-c', { method: 'POST', body: { action: 'approve', approved_amount_nle: 10 } });
  await call(db, '/api/requests/' + later.id + '/deliverables', 'tok-f', { method: 'POST', body: { title: 'Future report', due_on: '2099-01-01' } });
  assert.equal((await call(db, '/api/admin/reminders/run', 'tok-f', { method: 'POST' })).status, 403);
  const first = await call(db, '/api/admin/reminders/run', 'tok-a', { method: 'POST' });
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.email_delivery, 'not_configured');
  assert.equal(body.channel, 'in_app');
  assert.equal(body.created, 3);
  const second = await (await call(db, '/api/admin/reminders/run', 'tok-a', { method: 'POST' })).json();
  assert.equal(second.created, 0);
  const directorate = await (await call(db, '/api/notifications', 'tok-d')).json();
  assert.equal(directorate.some(item => item.type === 'deliverable_due' && item.request_id === due.request_number), true);
  assert.equal(directorate.some(item => item.request_id === later.request_number && item.type === 'deliverable_due'), false);
  const finance = await (await call(db, '/api/notifications', 'tok-f')).json();
  assert.equal(finance.some(item => item.type === 'liquidation_overdue' && item.request_id === due.request_number), true);
  assert.equal(db.prepare('SELECT amount_nle FROM requests WHERE id=?').get(due.id).amount_nle, 40);
  await worker.scheduled({}, { DB: asD1(db), ASSETS: { fetch() { return new Response('missing', { status: 404 }); } } }, { waitUntil() {} });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE type='liquidation_overdue' AND request_id=?`).get(due.request_number).n, 1);
  assert.match(html, /Email and SMS are not sent/);
  assert.match(html, /runDueRemindersNow/);
});
