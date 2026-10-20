import assert from 'node:assert/strict';
import test from 'node:test';
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
async function setup(){
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'directorate','tok-d');
  await session(db,'secretary','tok-s');
  await session(db,'chairman','tok-c');
  await session(db,'finance','tok-f');
  return db;
}

test('desk queues are filtered on the server and reject cross-role access',async()=>{
  const db=await setup();
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Queue test',implementing_entity:'DPPI',amount_nle:40}})).json();
  let secretary=await (await call(db,'/api/queues?desk=secretary','tok-s')).json();
  assert.equal(secretary.total,1);
  assert.equal(secretary.records[0].request_number,created.request_number);
  assert.equal((await call(db,'/api/queues?desk=secretary','tok-c')).status,403);
  assert.equal((await call(db,'/api/queues?desk=chairman','tok-s')).status,403);
  let chairman=await (await call(db,'/api/queues?desk=chairman','tok-c')).json();
  assert.equal(chairman.total,0);
  await call(db,'/api/requests/'+created.id+'/transition','tok-s',{method:'POST',body:{action:'clear'}});
  chairman=await (await call(db,'/api/queues?desk=chairman','tok-c')).json();
  assert.equal(chairman.total,1);
  secretary=await (await call(db,'/api/queues?desk=secretary','tok-s')).json();
  assert.equal(secretary.total,0);
  await call(db,'/api/requests/'+created.id+'/transition','tok-c',{method:'POST',body:{action:'approve',approved_amount_nle:40}});
  const ihpau=await (await call(db,'/api/queues?desk=ihpau','tok-f')).json();
  assert.equal(ihpau.total,1);
  const directorate=await (await call(db,'/api/queues?desk=directorate','tok-d')).json();
  assert.ok(directorate.total>=1);
  assert.equal((await call(db,'/api/queues?desk=ihpau','tok-d')).status,403);
});

test('dashboard exposes queue_counts for the signed-in role',async()=>{
  const db=await setup();
  await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Dash queue',implementing_entity:'DPPI'}})).json();
  const dash=await (await call(db,'/api/dashboard','tok-s')).json();
  assert.equal(dash.queue_counts.secretary,1);
  assert.equal(dash.pending_action,1);
});

test('notifications can be marked read and stay scoped to the recipient role',async()=>{
  const db=await setup();
  const created=await (await call(db,'/api/requests','tok-d',{method:'POST',body:{title:'Notify test',implementing_entity:'DPPI'}})).json();
  await call(db,'/api/requests/'+created.id+'/transition','tok-s',{method:'POST',body:{action:'clear'}});
  const list=await (await call(db,'/api/notifications','tok-c')).json();
  assert.ok(list.length>=1);
  const id=list[0].id;
  assert.equal((await call(db,'/api/notifications/'+id+'/read','tok-d',{method:'POST'})).status,403);
  const read=await (await call(db,'/api/notifications/'+id+'/read','tok-c',{method:'POST'})).json();
  assert.ok(read.ok);
  const again=await (await call(db,'/api/notifications','tok-c')).json();
  assert.ok(again.find(n=>n.id===id)?.read_at);
  await call(db,'/api/notifications/read-all','tok-c',{method:'POST'});
  const cleared=await (await call(db,'/api/notifications','tok-c')).json();
  assert.equal(cleared.filter(n=>!n.read_at).length,0);
});
