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
  return db;
}

test('disbursements store the saved request rate and cannot exceed the approved amount',async()=>{
  const db=await setup();
  db.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES('usd_nle_rate','{"rate":30,"updated_at":"2026-01-01T00:00:00.000Z","updated_by":"IHPAU"}','2026-01-01T00:00:00.000Z')`).run();
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Training',implementing_entity:'DPPI',amount_nle:100}})).json();
  await act(db,created.id,'tok-s',{action:'clear'});
  await act(db,created.id,'tok-c',{action:'approve',approved_amount_nle:80});
  db.prepare(`UPDATE system_settings SET value='{"rate":40}' WHERE key='usd_nle_rate'`).run();
  const posted=await (await call(db,'/api/requests/'+created.id+'/disbursements','tok-f',{method:'POST',body:{reference_number:'PV-80',amount_nle:80}})).json();
  assert.equal(posted.rate_snapshot,30);
  assert.equal(db.prepare('SELECT rate_snapshot FROM disbursements WHERE id=?').get(posted.id).rate_snapshot,30);
  assert.equal((await call(db,'/api/requests/'+created.id+'/disbursements','tok-f',{method:'POST',body:{reference_number:'PV-99',amount_nle:1}})).status,409);
  assert.equal((await call(db,'/api/requests/'+created.id+'/disbursements','tok-d',{method:'POST',body:{reference_number:'PV-x',amount_nle:1}})).status,403);
});

test('closure requires matching disbursements and verified receipts',async()=>{
  const db=await setup();
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Accountability',implementing_entity:'DPPI',amount_nle:50}})).json();
  await act(db,created.id,'tok-s',{action:'clear'});
  await act(db,created.id,'tok-c',{action:'approve',approved_amount_nle:50});
  assert.equal((await act(db,created.id,'tok-f',{action:'close'})).status,409);
  await call(db,'/api/requests/'+created.id+'/disbursements','tok-f',{method:'POST',body:{reference_number:'PV-50',amount_nle:50}});
  await call(db,'/api/requests/'+created.id+'/receipts','tok-f',{method:'POST',body:{reference_number:'RC-50',amount:40}});
  await act(db,created.id,'tok-f',{action:'verify_receipts',note:'Checked'});
  assert.equal((await act(db,created.id,'tok-f',{action:'close'})).status,409);
  await call(db,'/api/requests/'+created.id+'/receipts','tok-f',{method:'POST',body:{reference_number:'RC-10',amount:10}});
  await act(db,created.id,'tok-f',{action:'verify_receipts',note:'Checked again'});
  assert.equal((await act(db,created.id,'tok-f',{action:'close'})).status,200);
  const detail=await (await call(db,'/api/archive/'+created.id,'tok-f')).json();
  assert.equal(detail.financials.balanced,true);
  assert.equal(detail.financials.disbursed,50);
  assert.equal(detail.financials.verified_receipts,50);
});
