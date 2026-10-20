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

test('directorate can update a draft and readiness blocks incomplete submit',async()=>{
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'directorate','tok-d');
  await session(db,'secretary','tok-s');
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Editable draft',implementing_entity:'DPPI',status:'Draft',amount_nle:5}})).json();
  const patched=await (await call(db,'/api/requests/'+created.id,'tok-d',{method:'PATCH',body:{title:'Editable draft v2',details:'Updated purpose text for the activity.'}})).json();
  assert.equal(patched.request.title,'Editable draft v2');
  assert.equal((await call(db,'/api/requests/'+created.id+'/transition','tok-d',{method:'POST',body:{action:'submit'}})).status,400);
  await call(db,'/api/requests/'+created.id,'tok-d',{method:'PATCH',body:{
    deliverable:'Report',timeline:'2026',budget_lines:[{description:'Line',quantity:1,unit_cost:5,total:5}],
    concept_note:{background:'Context note',goal:'Improve services'}
  }});
  const ready=await (await call(db,'/api/requests/'+created.id+'/readiness','tok-d')).json();
  assert.equal(ready.ready,true);
  const submitted=await call(db,'/api/requests/'+created.id+'/transition','tok-d',{method:'POST',body:{action:'submit'}});
  assert.equal(submitted.status,200);
});

test('approval stores a retrievable decision record without R2',async()=>{
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'directorate','tok-d');
  await session(db,'secretary','tok-s');
  await session(db,'chairman','tok-c');
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Approval record',implementing_entity:'DPPI',amount_nle:20}})).json();
  await call(db,'/api/requests/'+created.id+'/transition','tok-s',{method:'POST',body:{action:'clear'}});
  await call(db,'/api/requests/'+created.id+'/transition','tok-c',{method:'POST',body:{action:'approve',approved_amount_nle:20,note:'Approved for implementation'}});
  const meta=await (await call(db,'/api/requests/'+created.id+'/approval-record','tok-s')).json();
  assert.ok(meta.document_id);
  const preview=await call(db,meta.preview_path,'tok-s');
  assert.equal(preview.status,200);
  assert.match(await preview.text(),/approval record/i);
});

test('register lists live requests for oversight roles',async()=>{
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'directorate','tok-d');
  await session(db,'secretary','tok-s');
  await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Register row',implementing_entity:'DPPI',amount_nle:1}})).json();
  const register=await (await call(db,'/api/register','tok-s')).json();
  assert.ok(register.records.some(r=>r.title==='Register row'));
  assert.equal((await call(db,'/api/register','tok-d')).status,403);
  const exported=await call(db,'/api/register/export','tok-s');
  assert.match(exported.headers.get('content-type'),/csv/);
});

async function act(db,id,token,body){
  return call(db,'/api/requests/'+id+'/transition',token,{method:'POST',body});
}
