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

test('stored permissions block a finance action after the grant is removed',async()=>{
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'directorate','tok-d');
  await session(db,'secretary','tok-s');
  await session(db,'chairman','tok-c');
  await session(db,'finance','tok-f');
  await session(db,'admin','tok-a');
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Permission gate',implementing_entity:'DPPI',amount_nle:10}})).json();
  await call(db,'/api/requests/'+created.id+'/transition','tok-s',{method:'POST',body:{action:'clear'}});
  await call(db,'/api/requests/'+created.id+'/transition','tok-c',{method:'POST',body:{action:'approve',approved_amount_nle:10}});
  db.prepare(`DELETE FROM role_permissions WHERE role='IHPAU' AND permission='close_requests'`).run();
  await call(db,'/api/requests/'+created.id+'/disbursements','tok-f',{method:'POST',body:{reference_number:'PV-10',amount_nle:10}});
  const receipt=await (await call(db,'/api/requests/'+created.id+'/receipts','tok-f',{method:'POST',body:{reference_number:'RC-10',amount:10}})).json();
  await call(db,'/api/receipts/'+receipt.id+'/decision','tok-f',{method:'POST',body:{decision:'Verified',note:'Matched'}});
  assert.equal((await call(db,'/api/requests/'+created.id+'/transition','tok-f',{method:'POST',body:{action:'close'}})).status,403);
  assert.equal((await call(db,'/api/admin/permissions','tok-f')).status,403);
  assert.equal((await call(db,'/api/admin/permissions','tok-a',{method:'PUT',body:{role:'IHPAU',permission:'close_requests',grant:true}})).status,400);
  assert.equal((await call(db,'/api/admin/permissions','tok-a',{method:'PUT',body:{role:'IHPAU',permission:'close_requests',grant:true,note:'Restore finance closure'}})).status,200);
  assert.equal((await call(db,'/api/requests/'+created.id+'/transition','tok-f',{method:'POST',body:{action:'close'}})).status,200);
});

test('audit filters and admin health stay free of secrets',async()=>{
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'admin','tok-a');
  await session(db,'finance','tok-f');
  await call(db,'/api/admin/permissions','tok-a',{method:'PUT',body:{role:'IHPAU',permission:'export_records',grant:true,note:'Confirm audit row'}});
  const filtered=await (await call(db,'/api/admin/audit?action=PERMISSION_CHANGED','tok-a')).json();
  assert.ok(filtered.length>=1);
  assert.ok(filtered.every(row=>row.action==='PERMISSION_CHANGED'));
  const health=await (await call(db,'/api/admin/health','tok-a')).json();
  assert.equal(health.database,true);
  assert.equal(health.document_storage,false);
  assert.equal(health.email_delivery,'not_configured');
  assert.equal(JSON.stringify(health).includes('password'),false);
  assert.equal((await call(db,'/api/admin/health','tok-f')).status,403);
  assert.equal((await call(db,'/api/admin/reset-core-credentials','tok-a',{method:'POST'})).status,200);
  const login=await call(db,'/api/auth/login','',{method:'POST',body:{username:'admin',password:'admin@123'}});
  assert.equal(login.status,200);
  assert.ok(db.prepare(`SELECT last_login_at FROM users WHERE username='admin'`).get().last_login_at);
});
