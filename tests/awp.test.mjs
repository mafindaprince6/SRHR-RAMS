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
  assert.match(html, /Implemented activities/);
  assert.match(html, /Budget issued/);
  assert.match(html, /A voided disbursement removes the tick/);
  assert.match(html, /Excel and PDF files are not read/);
  assert.match(awpJs, /aria-label="Budget issued"/);
  assert.match(awpJs, /awpMark\(row\.implemented, 'Implemented'/);
  assert.match(awpJs, /All directorate work plans/);
  assert.match(readFileSync(new URL('../public/roles/secretary.js', import.meta.url), 'utf8'), /renderAwpDeskSummary/);
  assert.match(readFileSync(new URL('../public/roles/chairman.js', import.meta.url), 'utf8'), /renderAwpDeskSummary/);
  assert.match(readFileSync(new URL('../public/roles/ihpau.js', import.meta.url), 'utf8'), /renderAwpDeskSummary/);
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

test('a work plan line is ticked only after a disbursement for that activity', async () => {
  const { db } = openDatabase();
  await applySchema(db);
  db.prepare(`INSERT INTO users(name,username,password_hash,role,entity) VALUES('DRCH User','drch','x','Directorate User','DRCH')`).run();
  await session(db, 'directorate', 'tok-d');
  await session(db, 'drch', 'tok-r');
  await session(db, 'secretary', 'tok-s');
  await session(db, 'chairman', 'tok-c');
  await session(db, 'finance', 'tok-f');
  await call(db, '/api/awp', 'tok-d', { method: 'POST', body: { fiscal_year: 2026, activity_code: '6.2.19', title: 'School health sessions', budget_nle: 15000 } });
  await call(db, '/api/awp', 'tok-d', { method: 'POST', body: { fiscal_year: 2026, activity_code: '9.1.1', title: 'Approved only', budget_nle: 4000 } });
  await call(db, '/api/awp', 'tok-d', { method: 'POST', body: { fiscal_year: 2025, activity_code: '6.2.19', title: 'Earlier year', budget_nle: 1000 } });
  await call(db, '/api/awp', 'tok-r', { method: 'POST', body: { fiscal_year: 2026, activity_code: '1.1.1', title: 'DRCH outreach', budget_nle: 800 } });

  async function fund(body, payment) {
    const created = await (await call(db, '/api/requests', 'tok-d', { method: 'POST', body })).json();
    assert.equal((await call(db, '/api/requests/' + created.id + '/transition', 'tok-s', { method: 'POST', body: { action: 'clear' } })).status, 200);
    assert.equal((await call(db, '/api/requests/' + created.id + '/transition', 'tok-c', { method: 'POST', body: { action: 'approve', approved_amount_nle: body.amount_nle } })).status, 200);
    if (!payment) return created;
    const paid = await call(db, '/api/requests/' + created.id + '/disbursements', 'tok-f', { method: 'POST', body: payment });
    assert.equal(paid.status, 201);
    return { ...created, disbursement: await paid.json() };
  }

  await call(db, '/api/requests', 'tok-d', { method: 'POST', body: { title: 'Draft only', implementing_entity: 'DPPI', activity_code: '9.1.1', amount_nle: 3, status: 'Draft', fiscal_year: '2026' } });
  const before = await (await call(db, '/api/awp?fiscal_year=2026', 'tok-d')).json();
  assert.equal(before.activities.every(row => row.budget_issued === false && row.issued_nle === 0 && row.implemented === false), true);

  const issued = await fund(
    { title: 'School health payment', implementing_entity: 'Directorate of Policy, Planning and Information', activity_code: '6.2.19', amount_nle: 40, fiscal_year: '2026' },
    { reference_number: 'PV-AWP', amount_nle: 40 }
  );
  await fund(
    { title: 'Approved without payment', implementing_entity: 'DPPI', activity_code: '9.1.1', amount_nle: 25, fiscal_year: '2026' }
  );
  await fund(
    { title: 'Another directorate same code', implementing_entity: 'Directorate of Hospital and Ambulances Service', activity_code: '6.2.19', amount_nle: 15, fiscal_year: '2026' },
    { reference_number: 'PV-OTHER', amount_nle: 15 }
  );
  await fund(
    { title: 'Earlier fiscal year', implementing_entity: 'DPPI', activity_code: '6.2.19', amount_nle: 8, fiscal_year: '2025' },
    { reference_number: 'PV-OLD', amount_nle: 8 }
  );
  await fund(
    { title: 'DRCH payment', implementing_entity: 'DRCH', activity_code: '1.1.1', amount_nle: 12, fiscal_year: '2026' },
    { reference_number: 'PV-DRCH', amount_nle: 12 }
  );
  await call(db, '/api/awp', 'tok-d', { method: 'POST', body: { fiscal_year: 2026, activity_code: '8.8.8', title: 'Closed without a new payment', budget_nle: 900 } });
  const closed = await fund({ title: 'Closed line', implementing_entity: 'DPPI', activity_code: '8.8.8', amount_nle: 9, fiscal_year: '2026' });
  db.prepare(`UPDATE requests SET status='Closed', current_stage='Closed' WHERE id=?`).run(closed.id);

  const own = await (await call(db, '/api/awp?fiscal_year=2026', 'tok-d')).json();
  const school = own.activities.find(row => row.activity_code === '6.2.19');
  const waiting = own.activities.find(row => row.activity_code === '9.1.1');
  assert.equal(school.budget_issued, true);
  assert.equal(school.implemented, true);
  assert.equal(school.issued_nle, 40);
  assert.equal(school.budget_nle, 15000);
  assert.deepEqual(school.issued_requests.map(row => row.request_number), [issued.request_number]);
  assert.equal(waiting.budget_issued, false);
  assert.equal(waiting.implemented, false);
  const closedLine = own.activities.find(row => row.activity_code === '8.8.8');
  assert.equal(closedLine.implemented, true);
  assert.equal(closedLine.issued_nle, 0);
  assert.equal(closedLine.budget_nle, 900);
  assert.equal(closedLine.implementation_requests[0].status, 'Closed');
  assert.equal(own.activities.some(row => row.entity === 'DRCH'), false);
  const earlier = await (await call(db, '/api/awp?fiscal_year=2025', 'tok-d')).json();
  assert.equal(earlier.activities.find(row => row.activity_code === '6.2.19').issued_nle, 8);
  const shared = await (await call(db, '/api/awp?fiscal_year=2026', 'tok-s')).json();
  assert.equal(shared.activities.find(row => row.entity === 'DRCH').implemented, true);
  assert.equal(shared.activities.find(row => row.entity === 'DPPI' && row.activity_code === '6.2.19').issued_nle, 40);
  for (const token of ['tok-c', 'tok-f']) {
    const oversight = await (await call(db, '/api/awp?fiscal_year=2026', token)).json();
    assert.equal(oversight.can_edit, false);
    assert.deepEqual(oversight.activities.map(row => row.entity).filter((entity, index, list) => list.indexOf(entity) === index).sort(), ['DPPI', 'DRCH']);
    assert.equal(oversight.activities.find(row => row.entity === 'DRCH' && row.activity_code === '1.1.1').implemented, true);
    assert.equal(oversight.activities.find(row => row.activity_code === '9.1.1').implemented, false);
  }

  assert.equal((await call(db, '/api/requests/' + issued.id + '/disbursements/' + issued.disbursement.id + '/void', 'tok-f', { method: 'POST', body: { reason: 'Wrong voucher' } })).status, 200);
  const cleared = await (await call(db, '/api/awp?fiscal_year=2026', 'tok-f')).json();
  const after = cleared.activities.find(row => row.entity === 'DPPI' && row.activity_code === '6.2.19');
  assert.equal(after.budget_issued, false);
  assert.equal(after.implemented, false);
  assert.equal(after.issued_nle, 0);
  assert.equal(after.budget_nle, 15000);
});
