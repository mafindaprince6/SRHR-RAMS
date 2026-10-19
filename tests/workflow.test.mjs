import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {applySchema, asD1, loadWorker, openDatabase, tokenHash} from './sqlite-d1.mjs';

const worker=await loadWorker();

async function session(db,username,token){
  const user=db.prepare('SELECT id FROM users WHERE username=?').get(username);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await tokenHash(token),user.id,'2099-01-01T00:00:00.000Z');
  return user;
}
function call(db,path,token,{method='GET',body}={}){
  const headers={cookie:`srhr_session=${token}`};
  if(body!==undefined)headers['content-type']='application/json';
  return worker.fetch(new Request('https://srhr.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),{DB:asD1(db),ASSETS:{fetch(){return new Response('missing',{status:404})}}});
}
async function act(db,id,token,body){
  const response=await call(db,'/api/requests/'+id+'/transition',token,{method:'POST',body});
  const data=await response.json();
  return {status:response.status,data};
}
async function setup(){
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'directorate','tok-d');
  await session(db,'secretary','tok-s');
  await session(db,'chairman','tok-c');
  await session(db,'finance','tok-f');
  await session(db,'admin','tok-a');
  return db;
}

test('a request can move only through the desk that holds it',async()=>{
  const db=await setup();
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Supervision',implementing_entity:'DPPI',amount_nle:80}})).json();
  assert.equal((await act(db,created.id,'tok-c',{action:'approve'})).status,409);
  assert.equal((await act(db,created.id,'tok-s',{action:'approve'})).status,403);
  assert.equal((await act(db,created.id,'tok-f',{action:'finance',status:'Closed'})).status,400);
  const cleared=await act(db,created.id,'tok-s',{action:'clear'});
  assert.equal(cleared.status,200);
  assert.equal(cleared.data.status,'Awaiting Approval');
  const again=await act(db,created.id,'tok-s',{action:'clear'});
  assert.equal(again.data.already,true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM request_events WHERE request_id=? AND action=?').get(created.id,'CLEAR').n,1);
  assert.equal((await act(db,created.id,'tok-a',{action:'approve'})).status,400);
  const approved=await act(db,created.id,'tok-c',{action:'approve',approved_amount_nle:75});
  assert.equal(approved.data.current_stage,'IHPAU / Finance');
  assert.equal(db.prepare('SELECT approved_amount_nle FROM requests WHERE id=?').get(created.id).approved_amount_nle,75);
  const finance=await act(db,created.id,'tok-f',{action:'finance',status:'Payment Processing'});
  assert.equal(finance.data.status,'Payment Processing');
  const same=await act(db,created.id,'tok-f',{action:'finance',status:'Payment Processing'});
  assert.equal(same.data.already,true);
  assert.equal((await call(db,'/api/requests/'+created.id+'/disbursements','tok-f',{method:'POST',body:{reference_number:'PAY-75',amount_nle:75}})).status,201);
  assert.equal((await call(db,'/api/requests/'+created.id+'/receipts','tok-f',{method:'POST',body:{reference_number:'R-75',amount:75}})).status,201);
  await act(db,created.id,'tok-f',{action:'verify_receipts',note:'Checked'});
  assert.equal((await act(db,created.id,'tok-f',{action:'close'})).status,200);
  assert.equal(db.prepare(`SELECT status FROM requests WHERE id=?`).get(created.id).status,'Closed');
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE request_id=?').get(created.request_number).n>=4);
});

test('queries need a reason, rejections stay searchable, and a creator cannot approve',async()=>{
  const db=await setup();
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Returned training',implementing_entity:'DPPI',amount_nle:10}})).json();
  assert.equal((await act(db,created.id,'tok-s',{action:'query'})).status,400);
  assert.equal((await act(db,created.id,'tok-s',{action:'query',note:'Add the venue'})).status,200);
  const resubmitted=await act(db,created.id,'tok-d',{action:'submit',note:'Venue added'});
  assert.equal(resubmitted.data.status,'Submitted');
  assert.equal(db.prepare('SELECT version FROM requests WHERE id=?').get(created.id).version,2);
  assert.equal((await act(db,created.id,'tok-s',{action:'submit'})).status,403);
  await act(db,created.id,'tok-s',{action:'clear'});
  assert.equal((await act(db,created.id,'tok-c',{action:'reject'})).status,400);
  assert.equal((await act(db,created.id,'tok-c',{action:'reject',note:'Outside the workplan'})).status,200);
  const found=await (await call(db,'/api/archive?q=Returned%20training','tok-s')).json();
  assert.equal(found.total,1);
  assert.equal(found.records[0].status,'Rejected');

  const chairman=db.prepare(`SELECT id FROM users WHERE username='chairman'`).get();
  const now='2026-10-19T00:00:00.000Z';
  db.prepare(`INSERT INTO requests(id,request_number,title,request_type,implementing_entity,amount_nle,amount_usd,status,current_stage,created_by,created_at,updated_at,version) VALUES('own-1','SRHR-2026-009999','Own approval','Operational','DPPI',5,0,'Awaiting Approval','Chairman',?,?,?,1)`).run(chairman.id,now,now);
  assert.equal((await act(db,'own-1','tok-c',{action:'approve'})).status,403);
  assert.equal(db.prepare(`SELECT status FROM requests WHERE id='own-1'`).get().status,'Awaiting Approval');
});

test('closure stops for a legal hold or a pending receipt',async()=>{
  const db=await setup();
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Close controls',implementing_entity:'DPPI',amount_nle:12}})).json();
  await act(db,created.id,'tok-s',{action:'clear'});
  await act(db,created.id,'tok-c',{action:'approve',approved_amount_nle:12});
  db.prepare('UPDATE requests SET legal_hold=1 WHERE id=?').run(created.id);
  assert.equal((await act(db,created.id,'tok-f',{action:'close'})).status,409);
  db.prepare('UPDATE requests SET legal_hold=0 WHERE id=?').run(created.id);
  assert.equal((await call(db,'/api/requests/'+created.id+'/receipts','tok-d',{method:'POST',body:{reference_number:'R-1',amount:12}})).status,403);
  assert.equal((await call(db,'/api/requests/'+created.id+'/disbursements','tok-f',{method:'POST',body:{reference_number:'PAY-12',amount_nle:12}})).status,201);
  const receipt=await call(db,'/api/requests/'+created.id+'/receipts','tok-f',{method:'POST',body:{reference_number:'R-1',amount:12}});
  assert.equal(receipt.status,201);
  assert.equal((await act(db,created.id,'tok-f',{action:'close'})).status,409);
  assert.equal((await act(db,created.id,'tok-f',{action:'verify_receipts'})).status,400);
  assert.equal((await act(db,created.id,'tok-f',{action:'verify_receipts',note:'Checked against the activity'})).status,200);
  assert.equal((await act(db,created.id,'tok-f',{action:'close'})).status,200);
  assert.equal(db.prepare('SELECT closed_at IS NOT NULL AS closed FROM requests WHERE id=?').get(created.id).closed,1);
});

test('withdraw keeps the record and an administrator cannot skip a stage without a reason',async()=>{
  const db=await setup();
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Withdrawn activity',implementing_entity:'DPPI',amount_nle:3}})).json();
  assert.equal((await act(db,created.id,'tok-s',{action:'withdraw',note:'No longer required'})).status,403);
  assert.equal((await act(db,created.id,'tok-d',{action:'withdraw'})).status,400);
  assert.equal((await act(db,created.id,'tok-d',{action:'withdraw',note:'Activity cancelled by the directorate'})).status,200);
  const found=await (await call(db,'/api/archive?status=Withdrawn','tok-s')).json();
  assert.equal(found.records[0].request_number,created.request_number);
  const second=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Admin path',implementing_entity:'DPPI',amount_nle:4}})).json();
  assert.equal((await act(db,second.id,'tok-a',{action:'clear'})).status,400);
  assert.equal((await act(db,second.id,'tok-a',{action:'approve',note:'Trying to skip the secretary'})).status,409);
  assert.equal((await act(db,second.id,'tok-a',{action:'clear',note:'Secretary is unavailable'})).status,200);
});

test('a repeated submission key keeps the original record',async()=>{
  const db=await setup();
  const first=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Once only',implementing_entity:'DPPI',amount_nle:9,idempotency_key:'desk-click-001',concept_note:{background:'Confirmed note'}}})).json();
  const replay=await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'A different title',implementing_entity:'DPPI',amount_nle:99,idempotency_key:'desk-click-001'}});
  const second=await replay.json();
  assert.equal(replay.status,200);
  assert.equal(second.idempotent,true);
  assert.equal(second.request_number,first.request_number);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM requests').get().n,1);
  assert.equal(db.prepare('SELECT title FROM requests').get().title,'Once only');
  assert.equal(db.prepare('SELECT background FROM concept_notes').get().background,'Confirmed note');
  const other=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Second activity',implementing_entity:'DPPI',idempotency_key:'desk-click-002'}})).json();
  assert.notEqual(other.request_number,first.request_number);
  assert.equal((await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Bad key',implementing_entity:'DPPI',idempotency_key:'bad key'}})).status,400);
});

test('submitting a draft records the date, and the creator cannot approve it',async()=>{
  const db=await setup();
  const draft=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Draft visit',implementing_entity:'DPPI',amount_nle:8,status:'Draft'}})).json();
  assert.equal(db.prepare('SELECT submitted_at FROM requests WHERE id=?').get(draft.id).submitted_at,null);
  assert.equal((await act(db,draft.id,'tok-d',{action:'submit'})).data.status,'Submitted');
  assert.ok(db.prepare('SELECT submitted_at FROM requests WHERE id=?').get(draft.id).submitted_at);
  await act(db,draft.id,'tok-s',{action:'clear'});
  const own=await (await call(db,'/api/requests','tok-a',{method:'POST',body:{title:'Admin own request',implementing_entity:'DPPI',amount_nle:2}})).json();
  await act(db,own.id,'tok-s',{action:'clear'});
  assert.equal((await act(db,own.id,'tok-a',{action:'approve',note:'Trying to approve my own request',approved_amount_nle:2})).status,403);
  assert.equal(db.prepare('SELECT status FROM requests WHERE id=?').get(own.id).status,'Awaiting Approval');
  assert.equal((await act(db,draft.id,'tok-c',{action:'approve',note:'Agreed',approved_amount_nle:8})).status,200);
  const row=db.prepare('SELECT approving_authority,approved_amount_nle,approved_at FROM requests WHERE id=?').get(draft.id);
  assert.equal(row.approving_authority,'Chairman');
  assert.equal(row.approved_amount_nle,8);
  assert.ok(row.approved_at);
  const event=db.prepare(`SELECT action,request_version FROM request_events WHERE request_id=? AND action='APPROVE'`).get(draft.id);
  assert.equal(event.request_version,1);
});

test('the request form posts to the workflow and does not invent a reference',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../public/workflow.js',import.meta.url),'utf8');
  assert.match(html,/src="\/workflow\.js"/);
  assert.match(script,/idempotency_key/);
  assert.match(script,/unit\*days/);
  assert.match(script,/\/api\/notifications/);
  assert.doesNotMatch(html,/padStart\(4,'0'\)/);
});
