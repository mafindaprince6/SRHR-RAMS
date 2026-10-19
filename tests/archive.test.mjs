import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {applySchema, asD1, loadWorker, openDatabase, tokenHash} from './sqlite-d1.mjs';

const worker=await loadWorker();

async function session(db,username,token){
  const user=db.prepare('SELECT id,role,entity FROM users WHERE username=?').get(username);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await tokenHash(token),user.id,'2099-01-01T00:00:00.000Z');
  return user;
}

function call(db,path,token,{method='GET',body,bucket}={}){
  const headers={cookie:`srhr_session=${token}`};
  let payload;
  if(body instanceof FormData)payload=body;
  else if(body!==undefined){headers['content-type']='application/json';payload=JSON.stringify(body)}
  const env={DB:asD1(db),ASSETS:{fetch(){return new Response('missing',{status:404})}}};
  if(bucket)env.DOCUMENTS=bucket;
  return worker.fetch(new Request('https://srhr.test'+path,{method,headers,body:payload}),env);
}

async function database(){
  const {db}=openDatabase();
  await applySchema(db);
  db.prepare(`INSERT INTO users(name,username,password_hash,role,entity) VALUES('Other Directorate','directorate2','x','Directorate User','DRCH')`).run();
  await session(db,'directorate','tok-a');
  await session(db,'directorate2','tok-b');
  await session(db,'secretary','tok-s');
  await session(db,'admin','tok-admin');
  return db;
}

test('migration keeps an existing request and the next reference continues after it',async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  await applySchema(db,false);
  const now='2026-01-15T00:00:00.000Z';
  db.prepare(`INSERT INTO requests(id,request_number,title,request_type,implementing_entity,amount_nle,amount_usd,status,current_stage,created_by,created_at,updated_at) VALUES('old-1','SRHR-2026-0047','Existing supervision','Operational','DPPI',95,0,'Submitted','Project Secretary',1,?,?)`).run(now,now);
  db.exec(await readFile(new URL('../migrations/001_archive.sql',import.meta.url),'utf8'));
  await session(db,'directorate','tok-a');
  assert.equal(db.prepare(`SELECT title FROM requests WHERE request_number='SRHR-2026-0047'`).get().title,'Existing supervision');
  assert.equal(db.prepare('SELECT last_seq FROM request_numbers WHERE year=2026').get().last_seq,47);
  const created=await (await call(db,'/api/requests','tok-a',{method:'POST',body:{title:'Next activity',implementing_entity:'DPPI',amount_nle:10}})).json();
  assert.equal(created.request_number,'SRHR-2026-000048');
  const again=await (await call(db,'/api/requests','tok-a',{method:'POST',body:{title:'Another activity',implementing_entity:'DPPI'}})).json();
  assert.equal(again.request_number,'SRHR-2026-000049');
  assert.notEqual(created.request_number,again.request_number);
});

test('archive search honours combined filters, pagination and draft secrecy',async()=>{
  const db=await database();
  db.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES('usd_nle_rate','{"rate":20,"updated_at":"2026-01-01T00:00:00.000Z","updated_by":"IHPAU"}','2026-01-01T00:00:00.000Z')`).run();
  const draft=await (await call(db,'/api/requests','tok-b',{method:'POST',body:{title:'Hidden draft',implementing_entity:'DRCH',status:'Draft',amount_nle:500}})).json();
  assert.equal(draft.status,'Draft');
  const visible=await (await call(db,'/api/requests','tok-a',{method:'POST',body:{title:'Supervision visit',implementing_entity:'DPPI',fiscal_year:'2026',funding_source:'SRHR Grant',amount_nle:100,activity_code:'6.2.19',budget_lines:[{description:'DSA',quantity:2,unit_cost:50}],concept_note:{background:'Facility visit'}}})).json();
  await call(db,'/api/requests','tok-a',{method:'POST',body:{title:'Equipment',implementing_entity:'DPPI',fiscal_year:'2025',request_type:'Procurement',amount_nle:40}});
  db.prepare(`UPDATE system_settings SET value='{"rate":25}' WHERE key='usd_nle_rate'`).run();

  const filtered=await (await call(db,'/api/archive?q=Supervision&entity=DPPI&fiscal_year=2026&category=Operational&programme=6.2&funding_source=SRHR%20Grant&amount_min=50&amount_max=150&page_size=1','tok-s')).json();
  assert.equal(filtered.total,1);
  assert.equal(filtered.records.length,1);
  assert.equal(filtered.records[0].request_number,visible.request_number);
  assert.equal(filtered.records[0].rate_snapshot,undefined);

  const detail=await (await call(db,'/api/archive/'+visible.id,'tok-s')).json();
  assert.equal(detail.request.rate_snapshot,20);
  assert.equal(detail.request.amount_usd,5);
  assert.equal(detail.budget_lines[0].total,100);
  assert.equal(detail.concept_note.background,'Facility visit');
  assert.equal(detail.events[0].action,'SUBMITTED');

  const page=await (await call(db,'/api/archive?entity=DPPI&page_size=1&page=1&sort=title&dir=asc','tok-admin')).json();
  assert.equal(page.records.length,1);
  assert.ok(page.total>=2);

  const secretaryList=await (await call(db,'/api/archive?q=Hidden%20draft','tok-s')).json();
  assert.equal(secretaryList.total,0);
  assert.equal((await call(db,'/api/archive/'+draft.id,'tok-s')).status,404);
  assert.equal((await call(db,'/api/archive/'+draft.id,'tok-a')).status,404);
  assert.equal((await call(db,'/api/archive/'+draft.id,'tok-b')).status,200);
  const exported=await call(db,'/api/archive/export?q=Hidden','tok-s');
  assert.equal(exported.headers.get('x-total-count'),'0');
  assert.doesNotMatch(await exported.text(),/Hidden draft/);
  const dash=await (await call(db,'/api/dashboard','tok-s')).json();
  assert.ok(dash.requested<500);
});

test('document uploads stay closed without storage and record checksums when storage exists',async()=>{
  const db=await database();
  const created=await (await call(db,'/api/requests','tok-a',{method:'POST',body:{title:'File request',implementing_entity:'DPPI',amount_nle:1}})).json();
  const denied=await call(db,'/api/requests/'+created.id+'/documents','tok-a',{method:'POST',body:new FormData()});
  assert.equal(denied.status,503);
  assert.match((await denied.json()).message,/DOCUMENTS/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,0);

  const bucket={files:new Map(),async put(key,bytes){this.files.set(key,bytes)},async get(key){const bytes=this.files.get(key);return bytes?{body:new Blob([bytes]).stream()}:null},async delete(key){this.files.delete(key)}};
  const pdf=new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34]);
  const form=new FormData();
  form.set('category','concept_note');
  form.set('file',new File([pdf],'note.pdf',{type:'application/pdf'}));
  const uploaded=await (await call(db,'/api/requests/'+created.id+'/documents','tok-a',{method:'POST',body:form,bucket})).json();
  assert.equal(uploaded.version,1);
  assert.match(uploaded.checksum_sha256,/^[a-f0-9]{64}$/);
  const row=db.prepare('SELECT storage_key,checksum_sha256,version FROM documents WHERE id=?').get(uploaded.id);
  assert.equal(row.checksum_sha256,uploaded.checksum_sha256);
  assert.doesNotMatch(row.storage_key,/note\.pdf/);

  const bad=new FormData();
  bad.set('category','concept_note');
  bad.set('file',new File([new Uint8Array([1,2,3,4])],'fake.pdf',{type:'application/pdf'}));
  assert.equal((await call(db,'/api/requests/'+created.id+'/documents','tok-a',{method:'POST',body:bad,bucket})).status,400);

  const duplicate=new FormData();
  duplicate.set('category','report');
  duplicate.set('file',new File([pdf],'copy.pdf',{type:'application/pdf'}));
  assert.equal((await call(db,'/api/requests/'+created.id+'/documents','tok-a',{method:'POST',body:duplicate,bucket})).status,409);

  const next=new FormData();
  next.set('category','concept_note');
  next.set('replaces',uploaded.id);
  next.set('file',new File([new Uint8Array([...pdf,0x0a])],'note-v2.pdf',{type:'application/pdf'}));
  const second=await (await call(db,'/api/requests/'+created.id+'/documents','tok-a',{method:'POST',body:next,bucket})).json();
  assert.equal(second.version,2);
  assert.ok(db.prepare('SELECT superseded_by FROM documents WHERE id=?').get(uploaded.id).superseded_by);

  const download=await call(db,'/api/documents/'+second.id,'tok-a',{bucket});
  assert.equal(download.headers.get('x-content-type-options'),'nosniff');
  assert.match(download.headers.get('content-disposition'),/attachment/);
  const saved=new Uint8Array(await download.arrayBuffer());
  assert.equal(saved[0],0x25);
  assert.equal((await call(db,'/api/documents/'+second.id,'tok-b',{bucket})).status,404);

  const huge=new Uint8Array(10*1024*1024+1);
  huge.set(pdf);
  const oversized=new FormData();
  oversized.set('category','scan');
  oversized.set('file',new File([huge],'scan.pdf',{type:'application/pdf'}));
  assert.equal((await call(db,'/api/requests/'+created.id+'/documents','tok-a',{method:'POST',body:oversized,bucket})).status,413);
});

test('archive routes require the migration and a session',async()=>{
  const {db}=openDatabase();
  await applySchema(db,false);
  await session(db,'secretary','tok-s');
  assert.equal((await call(db,'/api/archive','tok-s')).status,503);
  assert.equal((await worker.fetch(new Request('https://srhr.test/api/archive'),{DB:asD1(db),ASSETS:{fetch(){return new Response('',{status:404})}}})).status,401);
});

test('archive screen is present for every role and does not restore the theme switcher',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../public/archive.js',import.meta.url),'utf8');
  assert.match(html,/data-v="archive"/);
  assert.match(html,/id="archiveSearch"/);
  assert.match(html,/id="archiveMore"/);
  assert.match(html,/Back to results|id="archiveResults"/);
  assert.doesNotMatch(html,/id="archiveTable"/);
  assert.match(script,/\/api\/archive/);
  assert.doesNotMatch(html,/themePick|data-theme=/);
});
