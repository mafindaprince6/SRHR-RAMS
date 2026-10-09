import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from './finance-fixture.mjs';

test('IHPAU rate persists and is readable by independent Directorate and Secretary sessions',async()=>{
  const f=fixture();
  assert.equal((await (await f.call('Directorate User')).json()).rate,null);
  assert.equal((await f.call('IHPAU','PUT',{rate:24.75})).status,200);
  for(const role of ['Directorate User','Project Secretary']){
    const r=await f.call(role);assert.equal(r.status,200);
    const data=await r.json();assert.equal(data.rate,24.75);assert.equal(data.updated_by,'IHPAU');assert.ok(data.updated_at);
    assert.equal(r.headers.get('cache-control'),'no-store');
  }
  await f.call('IHPAU','PUT',{rate:25});
  assert.equal((await (await f.call('Project Secretary')).json()).rate,25);
  assert.equal(f.state.audits.length,2);
});

test('unauthenticated and non-finance users cannot update the shared rate',async()=>{
  const f=fixture();
  assert.equal((await f.call('IHPAU','PUT',{rate:24},false)).status,401);
  for(const role of ['Directorate User','Project Secretary','Chairman']){
    assert.equal((await f.call(role,'PUT',{rate:24})).status,403);
  }
  assert.equal(f.state.setting,null);
  assert.equal((await f.call('Administrator','PUT',{rate:24})).status,200);
});

test('invalid rates and unsupported methods do not change saved data',async()=>{
  const f=fixture();await f.call('IHPAU','PUT',{rate:24});
  for(const rate of [0,-1,null,'24','',true,{},1e309]){
    assert.equal((await f.call('IHPAU','PUT',{rate})).status,400);
  }
  assert.equal((await f.call('IHPAU','POST',{rate:25})).status,405);
  assert.equal(f.state.setting.rate,24);
  assert.equal(f.state.audits.length,1);
});
