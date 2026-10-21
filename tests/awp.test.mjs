import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { applySchema, asD1, loadWorker, openDatabase, tokenHash } from './sqlite-d1.mjs';

const worker = await loadWorker();
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const awpJs = readFileSync(new URL('../public/awp.js', import.meta.url), 'utf8');

async function session(db, username, token) {
  const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await tokenHash(token), user.id, '2099-01-01T00:00:00.000Z');
}
function call(db, path, token, { method = 'GET', body } = {}) {
  const headers = token ? { cookie: `srhr_session=${token}` } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  return worker.fetch(new Request('https://srhr.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { DB: asD1(db), ASSETS: { fetch() { return new Response('missing', { status: 404 }); } } });
}

test('a directorate work plan is visible to secretary, chairman and finance', async () => {
  const { db } = openDatabase();
  await applySchema(db);
  db.prepare(`INSERT INTO users(name,username,password_hash,role,entity) VALUES('DRCH User','drch','x','Directorate User','DRCH')`).run();
  await session(db, 'directorate', 'tok-d');
  await session(db, 'drch', 'tok-r');
  await session(db, 'secretary', 'tok-s');
  await session(db, 'chairman', 'tok-c');
  await session(db, 'finance', 'tok-f');
  await session(db, 'admin', 'tok-a');

  assert.equal((await call(db, '/api/awp', 'tok-s', { method: 'POST', body: { activity_code: '6.2.19', title: 'Not their plan' } })).status, 403);
  assert.equal((await call(db, '/api/awp', 'tok-f', { method: 'POST', body: { activity_code: '6.2.19', title: 'Not their plan' } })).status, 403);
  assert.equal((await call(db, '/api/awp', 'tok-c', { method: 'POST', body: { activity_code: '6.2.19', title: 'Not their plan' } })).status, 403);

  const created = await call(db, '/api/awp', 'tok-d', { method: 'POST', body: { fiscal_year: 2026, activity_code: '6.2.19', title: 'School health sessions', budget_nle: 15000, output: 'Sessions held' } });
  assert.equal(created.status, 201);
  const activity = await created.json();
  assert.equal(activity.entity, 'DPPI');
  assert.equal(activity.budget_nle, 15000);
  assert.equal((await call(db, '/api/awp', 'tok-d', { method: 'POST', body: { fiscal_year: 2026, activity_code: '6.2.19', title: 'Duplicate line' } })).status, 409);

  await call(db, '/api/awp', 'tok-r', { method: 'POST', body: { fiscal_year: 2026, activity_code: '1.1.1', title: 'DRCH outreach', budget_nle: 800 } });
  const own = await (await call(db, '/api/awp', 'tok-d')).json();
  assert.equal(own.can_edit, true);
  assert.deepEqual(own.activities.map(row => row.activity_code), ['6.2.19']);

  for (const token of ['tok-s', 'tok-c', 'tok-f', 'tok-a']) {
    const shared = await (await call(db, '/api/awp?fiscal_year=2026', token)).json();
    assert.equal(shared.can_edit, false);
    assert.deepEqual(shared.activities.map(row => row.entity).sort(), ['DPPI', 'DRCH']);
  }

  const updated = await call(db, '/api/awp/' + activity.id, 'tok-d', { method: 'PATCH', body: { title: 'School health sessions revised' } });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).budget_nle, 15000);
  assert.equal((await call(db, '/api/awp/' + activity.id, 'tok-f', { method: 'PATCH', body: { title: 'Changed by finance' } })).status, 403);
  assert.equal((await call(db, '/api/awp/' + activity.id, 'tok-d', { method: 'PATCH', body: { active: false } })).status, 200);
  const after = await (await call(db, '/api/awp', 'tok-s')).json();
  assert.equal(after.activities.some(row => row.activity_code === '6.2.19'), false);
  assert.equal(after.activities.some(row => row.activity_code === '1.1.1'), true);
});

test('the annual work plan menu is on the directorate, secretary, chairman and finance desks', () => {
  assert.match(html, /data-v="awp"/);
  assert.match(html, /Annual Work Plan/);
  assert.match(html, /Submit this year's plan/);
  assert.match(html, /Work plan archive/);
  assert.match(html, /Excel and PDF files are not read/);
  assert.match(html, /'Directorate User':\{views:\[[^\]]*'awp'/);
  assert.match(html, /'Project Secretary':\{views:\[[^\]]*'awp'/);
  assert.match(html, /'Chairman':\{views:\[[^\]]*'awp'/);
  assert.match(html, /'IHPAU':\{views:\[[^\]]*'awp'/);
  assert.match(awpJs, /\/api\/awp\/submissions/);
  assert.match(awpJs, /They cannot change it/);
});

test('a filed work plan is archived and an upload does not rewrite an existing activity', async () => {
  const { db } = openDatabase();
  await applySchema(db);
  db.prepare(`INSERT INTO users(name,username,password_hash,role,entity) VALUES('DRCH User','drch','x','Directorate User','DRCH')`).run();
  await session(db, 'directorate', 'tok-d');
  await session(db, 'drch', 'tok-r');
  await session(db, 'secretary', 'tok-s');
  await session(db, 'finance', 'tok-f');
  await call(db, '/api/awp', 'tok-d', { method: 'POST', body: { fiscal_year: 2026, activity_code: '6.2.19', title: 'School health sessions', budget_nle: 15000, output: 'Sessions held' } });
  assert.equal((await call(db, '/api/awp/submissions', 'tok-f', { method: 'POST', body: { fiscal_year: 2026 } })).status, 403);
  assert.equal((await call(db, '/api/awp/submissions', 'tok-d', { method: 'POST', body: { fiscal_year: 2027 } })).status, 400);
  const filed = await call(db, '/api/awp/submissions', 'tok-d', { method: 'POST', body: { fiscal_year: 2026 } });
  assert.equal(filed.status, 201);
  const first = await filed.json();
  assert.equal(first.line_count, 1);
  assert.equal(first.total_budget_nle, 15000);
  const csv = 'activity code,activity,budget,output\n9.1.1,Community outreach,2500,Visits completed\n6.2.19,Replacement title,1,Should not replace\n';
  assert.equal((await call(db, '/api/awp/submissions/upload', 'tok-d', { method: 'POST', body: { fiscal_year: 2026, file_name: 'plan.xlsx', text: csv } })).status, 400);
  const uploaded = await call(db, '/api/awp/submissions/upload', 'tok-d', { method: 'POST', body: { fiscal_year: 2026, file_name: 'plan.csv', text: csv } });
  assert.equal(uploaded.status, 201);
  const second = await uploaded.json();
  assert.equal(second.added, 1);
  assert.equal(second.skipped, 1);
  const live = await (await call(db, '/api/awp?fiscal_year=2026', 'tok-d')).json();
  const original = live.activities.find(row => row.activity_code === '6.2.19');
  assert.equal(original.budget_nle, 15000);
  assert.equal(original.title, 'School health sessions');
  assert.equal(live.activities.some(row => row.activity_code === '9.1.1'), true);
  const archive = await (await call(db, '/api/awp/submissions?fiscal_year=2026', 'tok-s')).json();
  assert.equal(archive.submissions.length, 2);
  assert.equal(archive.submissions.filter(row => !row.superseded_at).length, 1);
  const hidden = await call(db, '/api/awp/submissions/' + first.id, 'tok-r');
  assert.equal(hidden.status, 404);
  const detail = await (await call(db, '/api/awp/submissions/' + second.id, 'tok-s')).json();
  assert.equal(detail.lines.find(row => row.activity_code === '6.2.19').budget_nle, 1);
  assert.equal(detail.lines.length, 2);
});
