// Finance rate is shared through D1; budget totals are calculated from this form.
let sharedUsdRate=null;
let sharedRateTimer=null;
let sharedRateGeneration=0;
let rateEditorDirty=false;
let rateSavePending=false;
const numberFormat=new Intl.NumberFormat('en-GB',{maximumFractionDigits:6});
const moneyFormat=new Intl.NumberFormat('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});

function renderSharedRate(message=''){
  const rate=sharedUsdRate?.rate;
  document.querySelectorAll('[data-usd-rate]').forEach(el=>{
    el.textContent=rate ? `1 USD ($) = NLe ${numberFormat.format(rate)}` : (message || 'USD rate not set — awaiting IHPAU.');
  });
  document.querySelectorAll('[data-usd-rate-meta]').forEach(el=>{
    el.textContent=rate ? `Updated ${new Date(sharedUsdRate.updated_at).toLocaleString()} by ${sharedUsdRate.updated_by}.` : '';
  });
  const canEdit=!!authSession && ['IHPAU','Administrator'].includes(authSession.role);
  document.getElementById('usdRateEditor').hidden=!canEdit;
  const input=document.getElementById('usdRateInput');
  if(!rateEditorDirty && document.activeElement!==input) input.value=rate ?? '';
  updateBudgetSummary();
}

async function refreshSharedRate(){
  if(!authSession || document.hidden || rateSavePending) return;
  const generation=++sharedRateGeneration;
  try{
    const setting=await authApi('/api/finance/usd-rate');
    if(generation!==sharedRateGeneration || !authSession) return;
    sharedUsdRate=setting;
    renderSharedRate();
  }catch{
    if(generation!==sharedRateGeneration || !authSession) return;
    sharedUsdRate=null;
    renderSharedRate('USD rate unavailable — checking again shortly.');
  }
}

function startSharedRate(){
  stopSharedRate();
  renderSharedRate('Loading IHPAU USD rate…');
  refreshSharedRate();
  sharedRateTimer=setInterval(refreshSharedRate,15000);
}

function stopSharedRate(){
  clearInterval(sharedRateTimer);
  sharedRateTimer=null;
  sharedRateGeneration++;
  sharedUsdRate=null;
  rateEditorDirty=false;
  rateSavePending=false;
  document.getElementById('usdRateInput').value='';
  document.getElementById('usdRateStatus').textContent='';
}

async function saveSharedRate(event){
  event.preventDefault();
  const input=document.getElementById('usdRateInput');
  const rate=Number(input.value);
  const status=document.getElementById('usdRateStatus');
  if(!input.value.trim() || !Number.isFinite(rate) || rate<=0){
    status.textContent='Enter a positive NLe amount for 1 USD.';
    input.focus();return;
  }
  const button=document.getElementById('usdRateSave');
  button.disabled=true;status.textContent='Saving…';
  // Ignore reads started before this write so an old rate cannot replace it.
  const generation=++sharedRateGeneration;
  rateSavePending=true;
  try{
    const setting=await authApi('/api/finance/usd-rate',{method:'PUT',body:JSON.stringify({rate})});
    if(generation!==sharedRateGeneration || !authSession) return;
    sharedUsdRate=setting;rateEditorDirty=false;
    renderSharedRate();
    status.textContent='Saved. Directorate and Project Secretary workspaces will refresh automatically.';
  }catch(e){
    if(generation===sharedRateGeneration) status.textContent=`Could not save: ${e.message}`;
  }finally{
    if(generation===sharedRateGeneration) rateSavePending=false;
    button.disabled=false;
  }
}

function budgetNumber(value){
  const text=String(value).trim().replace(/^NLe\s*/i,'').trim();
  // Accept ungrouped numbers or correctly grouped thousands; reject negatives and stray text.
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return NaN;
  return Number(text.replaceAll(',',''));
}

function budgetRowTotal(row){
  const values=[3,4,5].map(i=>budgetNumber(row.cells[i].textContent));
  const result=values.reduce((a,b)=>a*b,1);
  return Number.isFinite(result) ? Math.round((result+Number.EPSILON)*100)/100 : NaN;
}

function updateBudgetSummary(){
  let totalCents=0,valid=true;
  const rows=Array.from(document.getElementById('budget').rows).slice(1);
  for(const row of rows){
    const total=budgetRowTotal(row);
    if(!Number.isFinite(total)){valid=false;row.cells[6].textContent='Check values';}
    else{row.cells[6].textContent=`NLe ${moneyFormat.format(total)}`;totalCents+=Math.round(total*100);}
  }
  if(!Number.isSafeInteger(totalCents)) valid=false;
  const text=valid ? `NLe ${moneyFormat.format(totalCents/100)}` : 'Check budget values';
  document.querySelectorAll('[data-budget-total]').forEach(el=>el.textContent=text);
  document.getElementById('budgetUsdTotal').textContent=valid && sharedUsdRate?.rate
    ? `USD ($) ${moneyFormat.format(totalCents/100/sharedUsdRate.rate)} at the current IHPAU rate`
    : 'USD equivalent available when the IHPAU rate is loaded.';
  return valid ? totalCents/100 : null;
}

function prepareBudgetRow(row){
  for(let i=1;i<=5;i++){
    row.cells[i].contentEditable='true';
    row.cells[i].setAttribute('aria-label',`${document.getElementById('budget').rows[0].cells[i].textContent}, budget line ${row.rowIndex}`);
  }
  row.cells[6].contentEditable='false';
}

document.getElementById('usdRateEditor').addEventListener('submit',saveSharedRate);
document.getElementById('usdRateInput').addEventListener('input',()=>rateEditorDirty=true);
document.getElementById('budget').addEventListener('input',updateBudgetSummary);
Array.from(document.getElementById('budget').rows).slice(1).forEach(prepareBudgetRow);
updateBudgetSummary();
window.addEventListener('focus',refreshSharedRate);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSharedRate();});
