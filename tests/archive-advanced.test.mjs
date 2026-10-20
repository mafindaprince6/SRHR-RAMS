import assert from 'node:assert/strict';
import test from 'node:test';
import {applySchema, asD1, loadWorker, openDatabase, tokenHash} from './sqlite-d1.mjs';

const worker=await loadWorker();
const bucket={files:new Map(),async put(key,bytes){this.files.set(key,bytes)},async get(key){const bytes=this.files.get(key);return bytes?{body:new Blob([bytes]).stream()}:null},async delete(key){this.files.delete(key)}};

async function session(db,username,token){
  const user=db.prepare('SELECT id FROM users WHERE username=?').get(username);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await tokenHash(token),user.id,'2099-01-01T00:00:00.000Z');
}
function call(db,path,token,{method='GET',body,useBucket=false}={}){
  const headers={cookie:`srhr_session=${token}`};
  let payload;
  if(body instanceof FormData)payload=body;
  else if(body!==undefined){headers['content-type']='application/json';payload=JSON.stringify(body)}
  const env={DB:asD1(db),ASSETS:{fetch(){return new Response('missing',{status:404})}}};
  if(useBucket)env.DOCUMENTS=bucket;
  return worker.fetch(new Request('https://srhr.test'+path,{method,headers,body:payload}),env);
}

test('unverified document text is searchable and does not change the request amount',async()=>{
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'admin','tok-a');
  await session(db,'secretary','tok-s');
  const created=await (await call(db,'/api/requests','tok-a',{method:'POST',body:{title:'Scan file',implementing_entity:'DPPI',amount_nle:15}})).json();
  const pdf=new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x37]);
  const form=new FormData();
  form.set('category','scan');
  form.set('file',new File([pdf],'legacy.pdf',{type:'application/pdf'}));
  const uploaded=await (await call(db,'/api/requests/'+created.id+'/documents','tok-a',{method:'POST',body:form,useBucket:true})).json();
  const indexed=await call(db,'/api/documents/'+uploaded.id+'/extract','tok-a',{method:'POST',body:{text:'Bo district facility assessment phrase',source:'operator transcription'}});
  assert.equal(indexed.status,201);
  assert.equal((await indexed.json()).verified,false);
  const found=await (await call(db,'/api/archive?q=facility%20assessment%20phrase','tok-s')).json();
  assert.equal(found.total,1);
  assert.equal(found.records[0].request_number,created.request_number);
  assert.equal(db.prepare('SELECT amount_nle FROM requests WHERE id=?').get(created.id).amount_nle,15);
});

test('duplicate file checksums are reported and a legacy import does not repeat',async()=>{
  const {db}=openDatabase();
  await applySchema(db);
  await session(db,'admin','tok-a');
  await session(db,'finance','tok-f');
  const pdf=new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x39]);
  for(const title of ['Copy A','Copy B']){
    const created=await (await call(db,'/api/requests','tok-a',{method:'POST',body:{title,implementing_entity:'DPPI',amount_nle:1}})).json();
    const form=new FormData();
    form.set('category','other');
    form.set('file',new File([pdf],title+'.pdf',{type:'application/pdf'}));
    assert.equal((await call(db,'/api/requests/'+created.id+'/documents','tok-a',{method:'POST',body:form,useBucket:true})).status,201);
  }
  const duplicates=await (await call(db,'/api/admin/documents/duplicates','tok-a')).json();
  assert.equal(duplicates.duplicates.length,1);
  assert.equal(duplicates.duplicates[0].copies,2);
  assert.equal((await call(db,'/api/admin/documents/duplicates','tok-f')).status,403);
  const imported=await (await call(db,'/api/admin/legacy-import','tok-a',{method:'POST',body:{idempotency_key:'legacy-batch-1',records:[{title:'Old supervision file',implementing_entity:'DRCH',amount_nle:0}]}})).json();
  assert.equal(imported.created.length,1);
  const replay=await (await call(db,'/api/admin/legacy-import','tok-a',{method:'POST',body:{idempotency_key:'legacy-batch-1',records:[{title:'Different',implementing_entity:'DRCH'}]}})).json();
  assert.equal(replay.idempotent,true);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM requests WHERE title='Old supervision file'`).get().n,1);
});
