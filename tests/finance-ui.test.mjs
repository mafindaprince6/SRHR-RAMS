import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from './finance-fixture.mjs';
const source=await readFile(new URL('../public/finance.js',import.meta.url),'utf8');

function screen(role,f){
  function element(text=''){return {textContent:text,value:'',hidden:false,events:{},setAttribute(){},focus(){},addEventListener(name,fn){this.events[name]=fn;}};}
  function row(values,index){return {rowIndex:index,cells:values.map(element)};}
  const rows=[row(['No.','Type','Description','Unit','Qty/Days','Unit Cost','Total'],0),
    row(['1','Senior','DSA','10','14','NLe 700','NLe 98,000'],1),
    row(['2','Junior','DSA','5','14','NLe 500','NLe 35,000'],2),
    row(['3','Driver','DSA','5','14','NLe 500','NLe 35,000'],3)];
  const ids=Object.fromEntries(['usdRateEditor','usdRateInput','usdRateSave','usdRateStatus','budgetUsdTotal'].map(id=>[id,element()]));
  ids.budget={...element(),rows};
  const rates=[element(),element(),element(),element()],meta=rates.map(()=>element()),totals=[element(),element()];
  const document={hidden:false,activeElement:null,getElementById:id=>ids[id],
    querySelectorAll:selector=>({'[data-usd-rate]':rates,'[data-usd-rate-meta]':meta,'[data-budget-total]':totals}[selector]||[]),addEventListener(){}};
  const context=vm.createContext({document,window:{addEventListener(){}},Intl,Date,Number,authSession:{role},
    setInterval:()=>1,clearInterval(){},authApi:async(path,options={})=>{
      const r=await f.call(role,options.method||'GET',options.body?JSON.parse(options.body):undefined);
      const data=await r.json();if(!r.ok)throw Error(data.error);return data;
    }});
  vm.runInContext(source,context);
  return {ids,rates,totals,rows,run:code=>vm.runInContext(code,context)};
}

test('finance editor saves a rate visible in independent Directorate and Secretary screens',async()=>{
  const f=fixture(),ihpau=screen('IHPAU',f),directorate=screen('Directorate User',f),secretary=screen('Project Secretary',f);
  ihpau.ids.usdRateInput.value='24';await ihpau.run('saveSharedRate({preventDefault(){}})');
  for(const s of [directorate,secretary]){
    await s.run('refreshSharedRate()');assert.match(s.rates[0].textContent,/1 USD \(\$\) = NLe 24/);
    assert.equal(s.ids.usdRateEditor.hidden,true);
  }
  assert.equal(ihpau.ids.usdRateEditor.hidden,false);
  assert.match(directorate.ids.budgetUsdTotal.textContent,/7,000.00/);
  ihpau.ids.usdRateInput.value='25.5';ihpau.ids.usdRateInput.events.input();
  await ihpau.run('refreshSharedRate()');assert.equal(ihpau.ids.usdRateInput.value,'25.5');
  await ihpau.run('saveSharedRate({preventDefault(){}})');await directorate.run('refreshSharedRate()');
  assert.match(directorate.rates[0].textContent,/25.5/);
});

test('top and bottom totals follow quantity changes, added lines and invalid input',()=>{
  const s=screen('Directorate User',fixture());
  assert.equal(s.totals[0].textContent,'NLe 168,000.00');
  s.rows[1].cells[4].textContent='10';s.ids.budget.events.input();
  assert.equal(s.totals[0].textContent,'NLe 140,000.00');
  s.rows.push({rowIndex:4,cells:['4','Item','Description','1','1','NLe 2.50',''].map(textContent=>({textContent}))});
  s.run('updateBudgetSummary()');assert.equal(s.totals[0].textContent,'NLe 140,002.50');
  assert.equal(s.totals[1].textContent,s.totals[0].textContent);
  for(const invalid of ['-1','abc','','1,2']){
    s.rows[1].cells[4].textContent=invalid;s.ids.budget.events.input();
    assert.equal(s.totals[0].textContent,'Check budget values');
  }
  s.rows[1].cells[4].textContent='10';s.run('updateBudgetSummary()');
  assert.equal(s.totals[0].textContent,'NLe 140,002.50');
});

test('missing and unavailable rates never display an invented USD conversion',async()=>{
  const s=screen('Directorate User',fixture());await s.run('refreshSharedRate()');
  assert.match(s.rates[0].textContent,/awaiting IHPAU/);
  assert.match(s.ids.budgetUsdTotal.textContent,/available when/);
  s.run('authApi=async()=>{throw Error("offline")};');await s.run('refreshSharedRate()');
  assert.match(s.rates[0].textContent,/unavailable/);
  s.run('stopSharedRate()');assert.equal(s.run('sharedRateTimer'),null);
});
