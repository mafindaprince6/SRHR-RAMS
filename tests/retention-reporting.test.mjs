import assert from 'node:assert/strict';
import test from 'node:test';
import {applySchema, asD1, loadWorker, openDatabase, tokenHash} from './sqlite-d1.mjs';

const worker=await loadWorker();

async function session(db,username,token){
  const user=db.prepare('SELECT id FROM users WHERE username=?').get(username);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await tokenHash(token),user.id,'2099-01-01T00:00:00.000Z');
}
function call(db,path,token,{method='GET',body}={}){
  const headers={cookie:`srhr_session=${token}`};
  if(body!==undefined)headers['content-type']='application/json';
  return worker.fetch(new Request('https://srhr.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),{DB:asD1(db),ASSETS:{fetch(){return new Response('missing',{status:404})}}});
}
async function act(db,id,token,body){
  const response=await call(db,'/api/requests/'+id+'/transition',token,{method:'POST',body});
  return {status:response.status,data:await response.json()};
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

test('closing a request schedules retention from the approved policy',async()=>{
  const db=await setup();
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Retention sample',implementing_entity:'DPPI',amount_nle:20,request_type:'Operational'}})).json();
  await act(db,created.id,'tok-s',{action:'clear'});
  await act(db,created.id,'tok-c',{action:'approve',approved_amount_nle:20});
  await call(db,'/api/requests/'+created.id+'/disbursements','tok-f',{method:'POST',body:{reference_number:'PV-20',amount_nle:20}});
  await call(db,'/api/requests/'+created.id+'/receipts','tok-f',{method:'POST',body:{reference_number:'RC-20',amount:20}});
  await act(db,created.id,'tok-f',{action:'verify_receipts',note:'Checked'});
  assert.equal((await act(db,created.id,'tok-f',{action:'close'})).status,200);
  const row=db.prepare('SELECT retention_category,retention_until,closed_at FROM requests WHERE id=?').get(created.id);
  assert.equal(row.retention_category,'operational');
  assert.ok(row.retention_until);
  const untilYear=Number(row.retention_until.slice(0,4));
  assert.ok(untilYear>=Number(row.closed_at.slice(0,4))+5);
});

test('legal hold changes require a reason and are audited',async()=>{
  const db=await setup();
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Hold sample',implementing_entity:'DPPI',amount_nle:5}})).json();
  const denied=await call(db,'/api/admin/records/'+created.request_number+'/control','tok-a',{method:'POST',body:{action:'legal_hold'}});
  assert.equal(denied.status,400);
  const ok=await call(db,'/api/admin/records/'+created.id+'/control','tok-a',{method:'POST',body:{action:'legal_hold',note:'Pending investigation'}});
  assert.equal(ok.status,200);
  assert.equal(db.prepare('SELECT legal_hold FROM requests WHERE id=?').get(created.id).legal_hold,1);
  assert.ok(db.prepare(`SELECT id FROM audit_log WHERE request_id=? AND action='RECORD_LEGAL_HOLD'`).get(created.id));
  const integrity=await (await call(db,'/api/admin/audit/integrity','tok-a')).json();
  assert.equal(integrity.ok,true);
});

test('management report and integrity checks respect role scope',async()=>{
  const db=await setup();
  await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Report A',implementing_entity:'DPPI',amount_nle:9}})).json();
  const report=await (await call(db,'/api/reports/management','tok-c')).json();
  assert.ok(report.summary.total>=1);
  assert.ok(Array.isArray(report.by_status));
  assert.equal((await call(db,'/api/reports/management','tok-d')).status,403);
  db.prepare(`UPDATE requests SET legal_hold=1 WHERE request_number LIKE 'SRHR-%'`).run();
  const integrity=await (await call(db,'/api/admin/audit/integrity','tok-a')).json();
  assert.equal(integrity.ok,false);
  assert.ok(integrity.issues.some(item=>item.code==='hold_without_audit'));
});
