async function workflowApi(path,options={}){
  const response=await fetch(path,{credentials:'include',method:options.method||'GET',headers:{'content-type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.message||data.error||`HTTP ${response.status}`);
  return data;
}
function moneyText(value){
  const amount=Number(value);
  return Number.isFinite(amount)?`NLe ${amount.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'';
}
function renderQueue(id,rows,cells){
  const body=document.getElementById(id);
  if(!body)return;
  body.innerHTML=rows.length?rows.map(row=>`<tr>${cells(row)}</tr>`).join(''):'<tr><td colspan="5" class="small">Nothing is waiting at this desk.</td></tr>';
}
function dashboardStatusBadge(row){
  const s=row.status||'';
  if(s==='Closed')return '<span class="badge">Closed</span>';
  if(row.current_stage==='IHPAU / Finance')return '<span class="badge info">At IHPAU</span>';
  if(s==='Awaiting Approval')return '<span class="badge warn">Awaiting approval</span>';
  if(s==='Query Raised')return '<span class="badge warn">Query raised</span>';
  return `<span class="badge">${esc(s)}</span>`;
}
async function loadDashboard(){
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=String(v??'—')};
  const body=document.getElementById('dashboardRecent');
  if(!body)return;
  try{
    const data=await workflowApi('/api/dashboard');
    set('dashTotal',data.total??0);
    set('dashAwaiting',data.awaiting_approval??0);
    set('dashIhpau',data.at_ihpau??0);
    set('dashClosed',data.closed??0);
    const rows=data.recent||[];
    body.innerHTML=rows.length?rows.map(row=>`<tr><td>${esc(row.request_number)}</td><td>${esc(row.request_type)}</td><td>${esc(row.title)}</td><td>${moneyText(row.amount_nle)}</td><td>${dashboardStatusBadge(row)}</td></tr>`).join(''):'<tr><td colspan="5" class="small">No requests in your scope yet.</td></tr>';
  }catch(error){
    body.innerHTML=`<tr><td colspan="5" class="small">${esc(error.message)}</td></tr>`;
  }
}
async function loadWorkflowQueues(){
  let rows=[];
  try{rows=await workflowApi('/api/requests')}
  catch(error){
    const message=`<tr><td colspan="5" class="small">${esc(error.message)}</td></tr>`;
    for(const id of ['secretaryQueue','approvalQueue','ihpauQueue']){const body=document.getElementById(id);if(body)body.innerHTML=message}
    const mine=document.getElementById('myRequestRows');
    if(mine)mine.innerHTML=`<tr><td colspan="4" class="small">${esc(error.message)}</td></tr>`;
    return;
  }
  renderQueue('secretaryQueue',rows.filter(row=>row.status==='Submitted'&&row.current_stage==='Project Secretary'),row=>`<td>${esc(row.request_number)}</td><td>${esc(row.implementing_entity)}</td><td>${esc(row.request_type)}</td><td>${moneyText(row.amount_nle)}</td><td><button class="btn" type="button" onclick="deskAct('${esc(row.id)}','clear')">Clear</button> <button class="btn secondary" type="button" onclick="deskAct('${esc(row.id)}','query',true)">Return</button></td>`);
  renderQueue('approvalQueue',rows.filter(row=>row.status==='Awaiting Approval'&&row.current_stage==='Chairman'),row=>`<td>${esc(row.request_number)}</td><td>${esc(row.title)}</td><td>${esc(row.implementing_entity)}</td><td>${moneyText(row.amount_nle)}</td><td><button class="btn" type="button" onclick="deskAct('${esc(row.id)}','approve',false,'${esc(row.amount_nle)}')">Approve</button> <button class="btn secondary" type="button" onclick="deskAct('${esc(row.id)}','query',true)">Query</button> <button class="btn danger" type="button" onclick="deskAct('${esc(row.id)}','reject',true)">Reject</button></td>`);
  renderQueue('ihpauQueue',rows.filter(row=>row.current_stage==='IHPAU / Finance'&&row.status!=='Closed'),row=>`<td>${esc(row.request_number)}</td><td>${esc(row.request_type)}</td><td>${esc(row.status)}</td><td>${moneyText(row.amount_nle)}</td><td><button class="btn" type="button" onclick="deskFinance('${esc(row.id)}')">Update</button> <button class="btn secondary" type="button" onclick="deskDisburse('${esc(row.id)}')">Disburse</button> <button class="btn secondary" type="button" onclick="deskReceipt('${esc(row.id)}')">Record receipt</button> <button class="btn secondary" type="button" onclick="deskAct('${esc(row.id)}','verify_receipts',true)">Verify receipts</button> <button class="btn secondary" type="button" onclick="deskAct('${esc(row.id)}','query',true)">Query</button> <button class="btn" type="button" onclick="deskAct('${esc(row.id)}','close')">Close</button></td>`);
  const mine=document.getElementById('myRequestRows');
  if(!mine)return;
  mine.innerHTML=rows.length?rows.map(row=>`<tr><td><button class="btn secondary" type="button" onclick="showRequestTimeline('${esc(row.id)}')">${esc(row.request_number)}</button></td><td>${esc(row.title)}</td><td>${esc(row.status)}</td><td>${row.status==='Query Raised'?`<button class="btn" type="button" onclick="deskAct('${esc(row.id)}','submit')">Resubmit</button> `:''}${['Draft','Submitted','Query Raised'].includes(row.status)?`<button class="btn secondary" type="button" onclick="deskAct('${esc(row.id)}','withdraw',true)">Withdraw</button>`:''}</td></tr>`).join(''):'<tr><td colspan="4" class="small">You have no requests in the archive yet.</td></tr>';
}
async function showRequestTimeline(id){
  const box=document.getElementById('myRequestTimeline');
  try{
    const data=await workflowApi('/api/archive/'+encodeURIComponent(id));
    box.innerHTML=data.events.length?data.events.map(event=>`<div class="event"><b>${esc(event.action)}</b><div class="small">${esc(event.actor_name||'System')} · ${esc(event.to_status||'')}</div><div>${esc(event.note||'')}</div></div>`).join(''):'<p class="small">No decisions are recorded yet.</p>';
  }catch(error){box.innerHTML=`<p class="small">${esc(error.message)}</p>`}
}
async function deskAct(id,action,needsReason,suggestedAmount){
  const body={action};
  if(needsReason){
    const note=prompt('Reason for this decision:');
    if(note===null)return;
    if(!note.trim()){alert('A reason is required.');return}
    body.note=note.trim();
  }
  if(action==='approve'){
    const entered=prompt('Approved amount in NLe',suggestedAmount??'');
    if(entered===null)return;
    const amount=Number(String(entered).replaceAll(',','').replace(/^NLe\s*/i,''));
    if(!Number.isFinite(amount)||amount<0){alert('Enter a zero or positive approved amount.');return}
    body.approved_amount_nle=amount;
  }
  try{
    const result=await workflowApi('/api/requests/'+encodeURIComponent(id)+'/transition',{method:'POST',body});
    alert(result.already?'This decision was already recorded.':`${result.request_number||'Request'} is now ${result.status}.`);
    await loadWorkflowQueues();
  }catch(error){alert(error.message)}
}
async function deskFinance(id){
  const status=prompt('Finance status: Payment Processing, Procurement Processing, Procurement Completed, Awaiting Receipts, or Liquidation Review','Payment Processing');
  if(status===null)return;
  try{
    const result=await workflowApi('/api/requests/'+encodeURIComponent(id)+'/transition',{method:'POST',body:{action:'finance',status}});
    alert(result.already?'That finance status is already recorded.':`Status is now ${result.status}.`);
    await loadWorkflowQueues();
  }catch(error){alert(error.message)}
}
async function deskReceipt(id){
  const reference=prompt('Receipt reference:');
  if(!reference)return;
  const amount=prompt('Receipt amount in NLe:');
  if(amount===null)return;
  try{
    await workflowApi('/api/requests/'+encodeURIComponent(id)+'/receipts',{method:'POST',body:{reference_number:reference,amount:Number(amount)}});
    alert('Receipt recorded as pending. Verify it before closing the request. This does not mark the request liquidated.');
  }catch(error){alert(error.message)}
}
async function deskDisburse(id){
  const reference=prompt('Disbursement reference (voucher or payment note):');
  if(!reference)return;
  const amount=prompt('Disbursement amount in NLe:');
  if(amount===null)return;
  try{
    const result=await workflowApi('/api/requests/'+encodeURIComponent(id)+'/disbursements',{method:'POST',body:{reference_number:reference,amount_nle:Number(amount)}});
    alert(`Disbursement recorded. Total disbursed: NLe ${result.financials.disbursed}. Approved: NLe ${result.financials.approved}.`);
    await loadWorkflowQueues();
  }catch(error){alert(error.message)}
}
let requestIdempotencyKey='';
let attachedConcept=null;
function submissionKey(){
  if(!requestIdempotencyKey)requestIdempotencyKey=(crypto.randomUUID?.()||`desk-${Date.now()}-retry`);
  return requestIdempotencyKey;
}
function conceptValue(id){return document.getElementById(id)?.value.trim()||''}
cnAttach=function(){
  const concept={
    background:conceptValue('cnbackground'),problem_statement:conceptValue('cnproblem'),goal:conceptValue('cngoal'),
    specific_objectives:conceptValue('cnobjectives'),methodology:conceptValue('cnmethodology'),target_participants:conceptValue('cnparticipants'),
    expected_outputs:conceptValue('cnoutputs'),expected_outcomes:conceptValue('cnoutcomes'),implementation_arrangements:conceptValue('cnarrangements'),
    monitoring:conceptValue('cnmonitoring'),risks:conceptValue('cnrisks'),conclusion:conceptValue('cnconclusion')
  };
  if(!conceptValue('cntitle')&&!Object.values(concept).some(Boolean)){alert('Enter the concept note before attaching it.');return}
  attachedConcept=concept;
  const state=document.getElementById('conceptAttachState');
  if(state)state.textContent=`Concept note attached${conceptValue('cntitle')?`: ${conceptValue('cntitle')}`:''}. It will be stored when you save or submit the request.`;
  alert('Concept note attached. Save or submit the request to store it.');
  show('new');
  choose('online');
};
function budgetLine(row){
  const unit=typeof budgetNumber==='function'?budgetNumber(row.cells[3].textContent):Number(row.cells[3].textContent);
  const days=typeof budgetNumber==='function'?budgetNumber(row.cells[4].textContent):Number(row.cells[4].textContent);
  const unitCost=typeof budgetNumber==='function'?budgetNumber(row.cells[5].textContent):Number(row.cells[5].textContent);
  const total=typeof budgetRowTotal==='function'?budgetRowTotal(row):unit*days*unitCost;
  return {
    description:`${row.cells[1].textContent.trim()}: ${row.cells[2].textContent.trim()}`.replace(/^:\s*|:\s*$/g,''),
    quantity:Number.isFinite(unit)&&Number.isFinite(days)?unit*days:NaN,
    unit_cost:unitCost,
    total
  };
}
submitReq=async function(status){
  const mode=status==='Draft'?'Draft':'Submitted';
  if(typeof updateBudgetSummary==='function'&&updateBudgetSummary()==null){alert('Check the budget lines before saving.');return}
  const lines=[...document.getElementById('budget').rows].slice(1).map(budgetLine).filter(line=>line.description&&Number.isFinite(line.quantity)&&Number.isFinite(line.unit_cost)&&Number.isFinite(line.total)&&line.quantity>=0&&line.unit_cost>=0);
  const purpose=document.getElementById('purpose').value.trim();
  if(!purpose||!document.getElementById('rentity').value.trim()){alert('Enter the purpose and the implementing entity.');return}
  const idempotencyKey=submissionKey();
  try{
    const saved=await workflowApi('/api/requests',{method:'POST',body:{
      title:(conceptValue('cntitle')||purpose).slice(0,180),details:purpose,status:mode,request_type:document.getElementById('rtype').value,
      implementing_entity:document.getElementById('rentity').value.trim(),location:document.getElementById('rlocation').value.trim(),
      activity_code:document.getElementById('ractivity').value.trim(),target_output:document.getElementById('routput').value.trim(),
      deliverable:document.getElementById('rdeliverable').value.trim(),timeline:document.getElementById('rtimeline').value.trim(),
      estimated_completion:document.getElementById('rcompletion').value,procurement_method:document.getElementById('rprocurement')?.value||'',
      amount_nle:updateBudgetSummary()||0,budget_lines:lines,concept_note:attachedConcept,idempotency_key:idempotencyKey
    }});
    requestIdempotencyKey='';
    attachedConcept=null;
    const state=document.getElementById('conceptAttachState');
    if(state)state.textContent='';
    const repeat=saved.idempotent?' This matched the previous submission, so no second record was created.':'';
    alert(mode==='Draft'?`Draft saved as ${saved.request_number}.${repeat}`:`Submitted. The permanent reference is ${saved.request_number}.${repeat}`);
    show('requests');
  }catch(error){alert(error.message)}
};
async function loadServerAlerts(){
  const box=document.getElementById('alertsList');
  if(!box)return;
  try{
    const rows=await workflowApi('/api/notifications');
    const badge=document.getElementById('alertCount');
    if(badge)badge.textContent=String(rows.filter(item=>!item.read_at).length);
    box.innerHTML=rows.length?rows.map(item=>`<div class="card" style="min-height:auto;margin:10px 0"><div style="display:flex;justify-content:space-between;gap:10px"><div><span class="badge info">${esc(item.type)}</span> <b style="margin-left:7px">${esc(item.request_id||'')}</b></div><span class="small">${esc((item.created_at||'').replace('T',' ').slice(0,16))}</span></div><p style="margin:10px 0 4px">${esc(item.message)}</p></div>`).join(''):'<p class="small">No alerts yet.</p>';
  }catch(error){box.innerHTML=`<p class="small">${esc(error.message)}</p>`}
}
const workflowShow=show;
show=function(view){
  const result=workflowShow(view);
  if(view==='dashboard'&&document.getElementById('dashboard')?.classList.contains('active'))loadDashboard();
  if(['requests','secretary','approval','ihpau'].includes(view)&&document.getElementById(view)?.classList.contains('active'))loadWorkflowQueues();
  if(view==='alerts'&&document.getElementById('alerts')?.classList.contains('active'))loadServerAlerts();
  return result;
};
window.loadDashboard=loadDashboard;
