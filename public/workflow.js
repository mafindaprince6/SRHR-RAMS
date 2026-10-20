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
function queueWaitLabel(row){
  const h=row.waiting_hours;
  if(h==null)return '';
  if(h<1)return '<span class="small">Waiting &lt;1h</span>';
  if(h<48)return `<span class="small">${h}h waiting</span>`;
  return `<span class="small warn">${Math.floor(h/24)}d waiting</span>`;
}
async function loadDeskQueue(desk,bodyId,cells){
  const body=document.getElementById(bodyId);
  if(!body)return;
  try{
    const data=await workflowApi('/api/queues?desk='+encodeURIComponent(desk));
    renderQueue(bodyId,data.records||[],cells);
  }catch(error){
    body.innerHTML=`<tr><td colspan="5" class="small">${esc(error.message)}</td></tr>`;
  }
}
async function loadWorkflowQueues(){
  await loadDeskQueue('secretary','secretaryQueue',row=>`<td>${esc(row.request_number)}</td><td>${esc(row.implementing_entity)}</td><td>${esc(row.request_type)}</td><td>${moneyText(row.amount_nle)}<div>${queueWaitLabel(row)}</div></td><td><button class="btn" type="button" onclick="deskAct('${esc(row.id)}','clear')">Clear</button> <button class="btn secondary" type="button" onclick="deskAct('${esc(row.id)}','query',true)">Return</button></td>`);
  await loadDeskQueue('chairman','approvalQueue',row=>`<td>${esc(row.request_number)}</td><td>${esc(row.title)}</td><td>${esc(row.implementing_entity)}</td><td>${moneyText(row.amount_nle)}<div>${queueWaitLabel(row)}</div></td><td><button class="btn" type="button" onclick="deskAct('${esc(row.id)}','approve',false,'${esc(row.amount_nle)}')">Approve</button> <button class="btn secondary" type="button" onclick="deskAct('${esc(row.id)}','query',true)">Query</button> <button class="btn danger" type="button" onclick="deskAct('${esc(row.id)}','reject',true)">Reject</button></td>`);
  await loadDeskQueue('ihpau','ihpauQueue',row=>`<td>${esc(row.request_number)}</td><td>${esc(row.request_type)}</td><td>${esc(row.status)}</td><td>${moneyText(row.amount_nle)}<div>${queueWaitLabel(row)}</div></td><td><button class="btn" type="button" onclick="deskFinance('${esc(row.id)}')">Update</button> <button class="btn secondary" type="button" onclick="deskDisburse('${esc(row.id)}')">Disburse</button> <button class="btn secondary" type="button" onclick="deskReceipt('${esc(row.id)}')">Record receipt</button> <button class="btn secondary" type="button" onclick="deskAct('${esc(row.id)}','verify_receipts',true)">Verify receipts</button> <button class="btn secondary" type="button" onclick="deskAct('${esc(row.id)}','query',true)">Query</button> <button class="btn" type="button" onclick="deskAct('${esc(row.id)}','close')">Close</button></td>`);
  await loadRequestTrackingList();
}
async function loadRequestTrackingList(){
  const mine=document.getElementById('myRequestRows');
  if(!mine)return;
  const role=document.getElementById('role')?.value||'';
  const title=document.getElementById('requestsPanelTitle');
  if(title){
    title.textContent=role==='Project Secretary'||role==='Administrator'?'All Requests':'My Requests';
  }
  try{
    let rows=[];
    if(role==='Directorate User'){
      const data=await workflowApi('/api/queues?desk=directorate');
      rows=data.records||[];
    }else if(role==='Project Secretary'||role==='Administrator'){
      rows=await workflowApi('/api/requests');
    }else{
      mine.innerHTML='<tr><td colspan="4" class="small">Open Request Tracking from a directorate or secretary account.</td></tr>';
      return;
    }
    mine.innerHTML=rows.length?rows.map(row=>`<tr><td><button class="btn secondary" type="button" onclick="openRequestDetail('${esc(row.id)}')">${esc(row.request_number)}</button></td><td>${esc(row.title)}</td><td>${esc(row.status)}${row.needs_action?' <span class="badge warn">Action needed</span>':''}</td><td>${row.status==='Draft'||row.status==='Query Raised'?`<button class="btn secondary" type="button" onclick="resumeDraft('${esc(row.id)}')">Edit</button> `:''}${row.status==='Query Raised'&&row.current_stage==='Directorate'?`<button class="btn" type="button" onclick="deskAct('${esc(row.id)}','submit')">Resubmit</button> `:''}${['Draft','Submitted','Query Raised'].includes(row.status)?`<button class="btn secondary" type="button" onclick="deskAct('${esc(row.id)}','withdraw',true)">Withdraw</button>`:''}</td></tr>`).join(''):'<tr><td colspan="4" class="small">No requests in your scope yet.</td></tr>';
  }catch(error){
    mine.innerHTML=`<tr><td colspan="4" class="small">${esc(error.message)}</td></tr>`;
  }
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
let activeDraftId=null;
let formDirty=false;
let autosaveTimer=null;
function submissionKey(){
  if(!requestIdempotencyKey)requestIdempotencyKey=(crypto.randomUUID?.()||`desk-${Date.now()}-retry`);
  return requestIdempotencyKey;
}
function setDraftBanner(text){
  const el=document.getElementById('draftEditBanner');
  if(!el)return;
  if(text){el.textContent=text;el.hidden=false}else{el.hidden=true;el.textContent=''}
}
function markFormDirty(){
  formDirty=true;
  setDraftBanner(activeDraftId?'Editing draft — unsaved changes will be autosaved.':'New request — save a draft to keep your work.');
}
function buildRequestPayload(status){
  const lines=[...document.getElementById('budget').rows].slice(1).map(budgetLine).filter(line=>line.description&&Number.isFinite(line.quantity)&&Number.isFinite(line.unit_cost)&&Number.isFinite(line.total)&&line.quantity>=0&&line.unit_cost>=0);
  const purpose=document.getElementById('purpose').value.trim();
  return {
    title:(conceptValue('cntitle')||purpose).slice(0,180),details:purpose,status,funding_source:document.getElementById('rfunding')?.value?.trim()||'',
    request_type:document.getElementById('rtype').value,implementing_entity:document.getElementById('rentity').value.trim(),
    location:document.getElementById('rlocation').value.trim(),activity_code:document.getElementById('ractivity').value.trim(),
    target_output:document.getElementById('routput').value.trim(),deliverable:document.getElementById('rdeliverable').value.trim(),
    timeline:document.getElementById('rtimeline').value.trim(),estimated_completion:document.getElementById('rcompletion').value,
    procurement_method:document.getElementById('rprocurement')?.value||'',amount_nle:typeof updateBudgetSummary==='function'?updateBudgetSummary()||0:0,
    budget_lines:lines,concept_note:attachedConcept
  };
}
async function refreshReadiness(){
  const panel=document.getElementById('submissionReadiness');
  const list=document.getElementById('readinessList');
  if(!panel||!list)return;
  try{
    const data=activeDraftId?await workflowApi('/api/requests/'+encodeURIComponent(activeDraftId)+'/readiness'):{ready:false,items:[]};
    panel.hidden=false;
    list.innerHTML=(data.items||[]).map(item=>`<li>${item.ok?'✓':'○'} ${esc(item.label)} — <span class="small">${esc(item.message)}</span></li>`).join('')||'<li class="small">Save a draft to run the checklist.</li>';
  }catch(error){
    panel.hidden=false;
    list.innerHTML=`<li class="small">${esc(error.message)}</li>`;
  }
}
async function autosaveDraft(){
  if(!activeDraftId||!formDirty)return;
  try{
    await workflowApi('/api/requests/'+encodeURIComponent(activeDraftId),{method:'PATCH',body:buildRequestPayload('Draft')});
    formDirty=false;
    setDraftBanner('Draft autosaved.');
  }catch{/* quiet autosave */}
}
function startAutosave(){
  clearInterval(autosaveTimer);
  autosaveTimer=setInterval(autosaveDraft,45000);
}
async function resumeDraft(id){
  try{
    const data=await workflowApi('/api/archive/'+encodeURIComponent(id));
    activeDraftId=data.request.id;
    requestIdempotencyKey='';
    show('new');choose('online');
    document.getElementById('rtype').value=data.request.request_type||'Operational';
    document.getElementById('rentity').value=data.request.implementing_entity||'';
    document.getElementById('purpose').value=data.request.details||'';
    document.getElementById('rlocation').value=data.request.location||'';
    document.getElementById('ractivity').value=data.request.activity_code||'';
    document.getElementById('routput').value=data.request.target_output||'';
    document.getElementById('rdeliverable').value=data.request.deliverable||'';
    document.getElementById('rtimeline').value=data.request.timeline||'';
    document.getElementById('rcompletion').value=(data.request.estimated_completion||'').slice(0,10);
    if(data.concept_note)attachedConcept=data.concept_note;
    setDraftBanner(`Editing ${data.request.request_number}. Use Save draft or Submit when ready.`);
    await refreshReadiness();
    startAutosave();
  }catch(error){alert(error.message)}
}
async function openRequestDetail(id){
  const box=document.getElementById('requestDetailPanel');
  if(!box)return;
  box.hidden=false;
  box.innerHTML='<p class="small">Loading request…</p>';
  try{
    const data=await workflowApi('/api/archive/'+encodeURIComponent(id));
    const r=data.request;
    const fin=data.financials||{};
    const events=(data.events||[]).map(e=>`<div class="event"><b>${esc(e.action)}</b><div class="small">${esc(e.actor_name||'System')} · ${esc(e.to_status||'')}</div><div>${esc(e.note||'')}</div></div>`).join('')||'<p class="small">No workflow events yet.</p>';
    let approvalLink='';
    if(r.approved_at){
      try{
        const ar=await workflowApi('/api/requests/'+encodeURIComponent(id)+'/approval-record');
        if(ar.preview_path)approvalLink=`<a class="btn secondary" href="${esc(ar.preview_path)}" target="_blank" rel="noopener">View approval record</a>`;
      }catch{approvalLink=''}
    }
    box.innerHTML=`<div class="panel"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><h3 style="margin:0">${esc(r.request_number)}</h3><p class="small">${esc(r.title)}</p></div>${approvalLink}</div>
    <p><span class="badge info">${esc(r.status)}</span> · ${esc(r.current_stage||'')}</p>
    <p class="small">Requested ${esc(typeof moneyText==='function'?moneyText(r.amount_nle):r.amount_nle)} · Approved ${r.approved_amount_nle==null?'—':esc(typeof moneyText==='function'?moneyText(r.approved_amount_nle):r.approved_amount_nle)} · Disbursed ${esc(typeof moneyText==='function'?moneyText(fin.disbursed):fin.disbursed||0)}</p>
    <div class="timeline">${events}</div>
    <button type="button" class="btn secondary" onclick="document.getElementById('requestDetailPanel').hidden=true">Close</button></div>`;
  }catch(error){box.innerHTML=`<p class="small">${esc(error.message)}</p>`}
}
async function loadRegister(){
  const body=document.getElementById('registerRows');
  if(!body)return;
  body.innerHTML='<tr><td colspan="8" class="small">Loading register…</td></tr>';
  try{
    const data=await workflowApi('/api/register');
    const rows=data.records||[];
    body.innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.implementing_entity)}</td><td>${esc(r.requesting_authority||'')}</td><td>${esc(r.approving_authority||'')}</td><td>${esc(r.request_type)}</td><td>${esc(r.details||r.title||'')}</td><td>${esc(r.activity_code||'')}</td><td>${moneyText(r.amount_nle)}</td><td>${esc(r.status)} / ${esc(r.current_stage||'')}</td></tr>`).join(''):'<tr><td colspan="8" class="small">No submitted requests yet.</td></tr>';
  }catch(error){body.innerHTML=`<tr><td colspan="8" class="small">${esc(error.message)}</td></tr>`}
}
async function exportRegisterCsv(){
  try{
    const response=await fetch('/api/register/export',{credentials:'include'});
    if(!response.ok)throw new Error('Export failed');
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download='SRHR-RAMS-Request-Register.csv';link.click();
    URL.revokeObjectURL(url);
  }catch(error){alert(error.message)}
}
window.exportRegister=exportRegisterCsv;
window.refreshReadiness=refreshReadiness;
window.resumeDraft=resumeDraft;
window.openRequestDetail=openRequestDetail;
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
  const purpose=document.getElementById('purpose').value.trim();
  if(!purpose||!document.getElementById('rentity').value.trim()){alert('Enter the purpose and the implementing entity.');return}
  const payload=buildRequestPayload(mode);
  try{
    if(mode==='Submitted'&&activeDraftId){
      const readiness=await workflowApi('/api/requests/'+encodeURIComponent(activeDraftId)+'/readiness');
      if(!readiness.ready){await refreshReadiness();alert('Complete the submission checklist before submitting.');return}
      await workflowApi('/api/requests/'+encodeURIComponent(activeDraftId),{method:'PATCH',body:buildRequestPayload('Draft')});
      const submitted=await workflowApi('/api/requests/'+encodeURIComponent(activeDraftId)+'/transition',{method:'POST',body:{action:'submit'}});
      alert(`Submitted. The permanent reference is ${submitted.request_number||activeDraftId}.`);
      activeDraftId=null;formDirty=false;setDraftBanner('');show('requests');return;
    }
    if(activeDraftId){
      const saved=await workflowApi('/api/requests/'+encodeURIComponent(activeDraftId),{method:'PATCH',body:payload});
      formDirty=false;
      alert(`Draft updated (${saved.request.request_number}).`);
      await refreshReadiness();
      return;
    }
    const idempotencyKey=submissionKey();
    const saved=await workflowApi('/api/requests',{method:'POST',body:{...payload,idempotency_key:idempotencyKey}});
    if(mode==='Draft')activeDraftId=saved.id;
    requestIdempotencyKey='';
    if(mode!=='Draft'){attachedConcept=null;activeDraftId=null}
    const state=document.getElementById('conceptAttachState');
    if(state&&mode!=='Draft')state.textContent='';
    const repeat=saved.idempotent?' This matched the previous submission, so no second record was created.':'';
    alert(mode==='Draft'?`Draft saved as ${saved.request_number}.${repeat}`:`Submitted. The permanent reference is ${saved.request_number}.${repeat}`);
    if(mode==='Draft'){await refreshReadiness();startAutosave()}else setDraftBanner('');
    show('requests');
  }catch(error){
    if(error.message.includes('submission_incomplete')||error.message==='submission_incomplete'){await refreshReadiness();alert('Complete the submission checklist before submitting.');return}
    alert(error.message)
  }
};
document.getElementById('onlinebox')?.addEventListener('input',markFormDirty);
window.addEventListener('beforeunload',e=>{if(formDirty){e.preventDefault();e.returnValue=''}});
async function markNotificationRead(id){
  try{
    await workflowApi('/api/notifications/'+encodeURIComponent(id)+'/read',{method:'POST',body:{}});
    await loadServerAlerts();
  }catch(error){alert(error.message)}
}
async function markAllNotificationsRead(){
  try{
    await workflowApi('/api/notifications/read-all',{method:'POST',body:{}});
    await loadServerAlerts();
  }catch(error){alert(error.message)}
}
async function loadServerAlerts(){
  const box=document.getElementById('alertsList');
  if(!box)return;
  try{
    const rows=await workflowApi('/api/notifications');
    const badge=document.getElementById('alertCount');
    const unread=rows.filter(item=>!item.read_at);
    if(badge)badge.textContent=String(unread.length);
    box.innerHTML=rows.length?rows.map(item=>`<div class="card" style="min-height:auto;margin:10px 0;opacity:${item.read_at?'0.72':'1'}"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><span class="badge info">${esc(item.type)}</span> <b style="margin-left:7px">${esc(item.request_id||'')}</b></div><span class="small">${esc((item.created_at||'').replace('T',' ').slice(0,16))}</span></div><p style="margin:10px 0 4px">${esc(item.message)}</p>${item.read_at?'':`<button class="btn secondary" type="button" onclick="markNotificationRead('${String(item.id).replace(/'/g,'')}')">Mark read</button>`}</div>`).join(''):'<p class="small">No alerts yet.</p>';
  }catch(error){box.innerHTML=`<p class="small">${esc(error.message)}</p>`}
}
window.markAllNotificationsRead=markAllNotificationsRead;
const workflowShow=show;
show=function(view){
  const result=workflowShow(view);
  if(view==='dashboard'&&document.getElementById('dashboard')?.classList.contains('active'))loadDashboard();
  if(['requests','secretary','approval','ihpau'].includes(view)&&document.getElementById(view)?.classList.contains('active'))loadWorkflowQueues();
  if(view==='alerts'&&document.getElementById('alerts')?.classList.contains('active'))loadServerAlerts();
  if(view==='register'&&document.getElementById('register')?.classList.contains('active'))loadRegister();
  if(view==='new'&&document.getElementById('new')?.classList.contains('active'))refreshReadiness();
  if(view==='ihpau'&&document.getElementById('ihpau')?.classList.contains('active'))loadFinanceDesk();
  return result;
};
async function loadFinanceDesk(){
  const history=document.getElementById('usdRateHistory');
  if(history){
    try{
      const data=await workflowApi('/api/finance/usd-rate/history');
      const rows=data.history||[];
      history.innerHTML=rows.length?`<p><b>Rate history</b></p><ul>${rows.slice(0,8).map(row=>`<li>1 USD = NLe ${esc(row.rate)} · ${esc((row.effective_at||'').slice(0,16))} · ${esc(row.changed_by_name||'')}</li>`).join('')}</ul>`:'<p>No rate changes are recorded yet.</p>';
    }catch(error){history.textContent=error.message}
  }
  const box=document.getElementById('receiptVerifyQueue');
  if(!box)return;
  try{
    const data=await workflowApi('/api/finance/receipts?status=Pending');
    const rows=data.receipts||[];
    box.innerHTML=rows.length?`<p><b>Receipts awaiting verification</b></p>${rows.map(row=>`<div class="card" style="min-height:auto;margin:8px 0"><b>${esc(row.request_number)}</b> · ${esc(row.reference_number)} · ${moneyText(row.amount)}<div style="margin-top:8px"><button class="btn" type="button" onclick="decideReceipt('${esc(row.id)}','Verified')">Verify</button> <button class="btn secondary" type="button" onclick="decideReceipt('${esc(row.id)}','Rejected')">Reject</button></div></div>`).join('')}`:'<p>No receipts are waiting for verification.</p>';
  }catch(error){box.textContent=error.message}
}
async function decideReceipt(id,decision){
  const note=decision==='Rejected'?prompt('Reason for rejecting this receipt:'):'';
  if(decision==='Rejected'&&!note)return;
  try{
    await workflowApi('/api/receipts/'+encodeURIComponent(id)+'/decision',{method:'POST',body:{decision,note}});
    await loadFinanceDesk();
    await loadWorkflowQueues();
  }catch(error){alert(error.message)}
}
window.loadFinanceDesk=loadFinanceDesk;
window.loadDashboard=loadDashboard;
