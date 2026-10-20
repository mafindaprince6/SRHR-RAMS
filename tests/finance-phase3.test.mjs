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
async function approvedRequest(db){
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Finance phase',implementing_entity:'DPPI',amount_nle:40}})).json();
  await call(db,'/api/requests/'+created.id+'/transition','tok-s',{method:'POST',body:{action:'clear'}});
  await call(db,'/api/requests/'+created.id+'/transition','tok-c',{method:'POST',body:{action:'approve',approved_amount_nle:40}});
  return created;
}

test('changing the live USD rate keeps history and does not rewrite a saved request rate',async()=>{
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'directorate','tok-d');
  await session(db,'finance','tok-f');
  await session(db,'secretary','tok-s');
  await session(db,'chairman','tok-c');
  await call(db,'/api/finance/usd-rate','tok-f',{method:'PUT',body:{rate:22,source:'Treasury note'}});
  const created=await approvedRequest(db);
  assert.equal(db.prepare('SELECT rate_snapshot FROM requests WHERE id=?').get(created.id).rate_snapshot,22);
  await call(db,'/api/finance/usd-rate','tok-f',{method:'PUT',body:{rate:28,source:'Updated circular'}});
  assert.equal(db.prepare('SELECT rate_snapshot FROM requests WHERE id=?').get(created.id).rate_snapshot,22);
  const history=await (await call(db,'/api/finance/usd-rate/history','tok-d')).json();
  assert.equal(history.history.length,2);
  assert.equal(history.history[0].rate,28);
});

test('a receipt can be rejected or verified individually and a repeated disbursement key is not duplicated',async()=>{
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'directorate','tok-d');
  await session(db,'secretary','tok-s');
  await session(db,'chairman','tok-c');
  await session(db,'finance','tok-f');
  const created=await approvedRequest(db);
  const first=await (await call(db,'/api/requests/'+created.id+'/disbursements','tok-f',{method:'POST',body:{reference_number:'PV-1',amount_nle:20,idempotency_key:'pay-key-001'}})).json();
  const replay=await (await call(db,'/api/requests/'+created.id+'/disbursements','tok-f',{method:'POST',body:{reference_number:'PV-OTHER',amount_nle:20,idempotency_key:'pay-key-001'}})).json();
  assert.equal(replay.idempotent,true);
  assert.equal(replay.id,first.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM disbursements').get().n,1);
  const receipt=await (await call(db,'/api/requests/'+created.id+'/receipts','tok-f',{method:'POST',body:{reference_number:'RC-1',amount:20}})).json();
  assert.equal((await call(db,'/api/receipts/'+receipt.id+'/decision','tok-f',{method:'POST',body:{decision:'Rejected'}})).status,400);
  assert.equal((await call(db,'/api/receipts/'+receipt.id+'/decision','tok-f',{method:'POST',body:{decision:'Rejected',note:'Amount does not match'}})).status,200);
  const queue=await (await call(db,'/api/finance/receipts?status=Rejected','tok-f')).json();
  assert.equal(queue.receipts.length,1);
  const dossier=await (await call(db,'/api/requests/'+created.id+'/financial-dossier','tok-f')).json();
  assert.equal(dossier.financials.disbursed,20);
  assert.equal(dossier.financials.verified_receipts,0);
  assert.equal((await call(db,'/api/requests/'+created.id+'/disbursements/'+first.id+'/void','tok-f',{method:'POST',body:{reason:'Wrong voucher'}})).status,200);
  assert.equal((await (await call(db,'/api/requests/'+created.id+'/financial-dossier','tok-f')).json()).financials.disbursed,0);
});

test('closure checklist reports an open deliverable',async()=>{
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'directorate','tok-d');
  await session(db,'secretary','tok-s');
  await session(db,'chairman','tok-c');
  await session(db,'finance','tok-f');
  const created=await approvedRequest(db);
  await call(db,'/api/requests/'+created.id+'/disbursements','tok-f',{method:'POST',body:{reference_number:'PV-40',amount_nle:40}});
  const receipt=await (await call(db,'/api/requests/'+created.id+'/receipts','tok-f',{method:'POST',body:{reference_number:'RC-40',amount:40}})).json();
  await call(db,'/api/receipts/'+receipt.id+'/decision','tok-f',{method:'POST',body:{decision:'Verified',note:'Matched'}});
  db.prepare(`INSERT INTO deliverables(id,request_id,title,status,created_at) VALUES('del-1',?,'Supervision report','Pending',?)`).run(created.id,new Date().toISOString());
  const checklist=await (await call(db,'/api/requests/'+created.id+'/closure-checklist','tok-f')).json();
  assert.equal(checklist.ready,false);
  assert.equal((await call(db,'/api/requests/'+created.id+'/transition','tok-f',{method:'POST',body:{action:'close'}})).status,409);
  db.prepare(`UPDATE deliverables SET status='Verified' WHERE id='del-1'`).run();
  assert.equal((await call(db,'/api/requests/'+created.id+'/transition','tok-f',{method:'POST',body:{action:'close'}})).status,200);
});
