let archivePage=1;
let archiveSort='updated_at';
let archiveDir='desc';
let archiveDetailData=null;
let archiveGeneration=0;

const ARCHIVE_SORTS={updated:['updated_at','desc'],reference:['request_number','asc'],amount:['amount','desc'],title:['title','asc']};
const DOC_LABELS={concept_note:'Concept note',request_form:'Request form',budget:'Budget',approval:'Approval',receipt:'Receipt',invoice:'Invoice',report:'Report',deliverable:'Deliverable',scan:'Scanned record',other:'Other'};
const EVENT_LABELS={DRAFT_SAVED:'Saved as a draft',SUBMITTED:'Submitted',SUBMIT:'Submitted',RESUBMIT:'Sent back after a query',CLEAR:'Cleared to the Chairman',QUERY:'Returned with a question',APPROVE:'Approved',REJECT:'Rejected',WITHDRAW:'Withdrawn',FINANCE:'Finance update',VERIFY_RECEIPTS:'Receipts checked',CLOSE:'Closed'};

function archiveParams(){
  const params=new URLSearchParams(new FormData(document.getElementById('archiveSearch')));
  for(const [key,value] of [...params.entries()])if(!String(value).trim())params.delete(key);
  const chosen=ARCHIVE_SORTS[document.getElementById('archiveSort')?.value]||ARCHIVE_SORTS.updated;
  archiveSort=chosen[0];
  archiveDir=chosen[1];
  params.set('page',String(archivePage));
  params.set('page_size','25');
  params.set('sort',archiveSort);
  params.set('dir',archiveDir);
  return params;
}

async function archiveApi(path,options={}){
  const headers={...(options.headers||{})};
  if(options.body&&!(options.body instanceof FormData))headers['content-type']='application/json';
  const response=await fetch(path,{credentials:'include',...options,headers});
  const type=response.headers.get('content-type')||'';
  if(type.includes('text/csv')||type.includes('application/pdf')||type.startsWith('image/')||type.includes('octet-stream')||response.headers.get('content-disposition')){
    if(!response.ok)throw new Error('The file could not be downloaded.');
    return response;
  }
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.message||data.error||`HTTP ${response.status}`);
  return data;
}

function archiveBadge(status){
  const warn=/draft|query|reject|withdraw|cancel/i.test(status||'');
  const info=/submit|approv|payment|ihpau|closed/i.test(status||'');
  return `<span class="badge ${warn?'warn':info?'info':''}">${esc(status||'—')}</span>`;
}
function archiveMoney(value){
  const amount=Number(value);
  return Number.isFinite(amount)?`NLe ${amount.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—';
}
function archiveWhen(value){
  if(!value)return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return String(value).slice(0,10);
  return date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}
function docLabel(doc){return DOC_LABELS[doc.category||doc.kind]||doc.category||doc.kind||'Document'}
function eventLabel(action){return EVENT_LABELS[action]||String(action||'Update').replaceAll('_',' ')}

function renderArchiveRows(data){
  const results=document.getElementById('archiveResults');
  const state=document.getElementById('archiveState');
  const pager=document.getElementById('archivePager');
  if(!data.records.length){
    results.innerHTML='<p class="small">No records match this search. Try the reference number, or clear a filter.</p>';
    state.textContent='0 records';
  }else{
    state.textContent=`${data.total} record${data.total===1?'':'s'}`;
    results.innerHTML=data.records.map(row=>`<button type="button" class="archiveResult" data-archive-id="${esc(row.id)}">
      <span class="archiveResultTop"><span class="archiveRef">${esc(row.request_number)}</span>${archiveBadge(row.status)}</span>
      <span class="archiveTitle">${esc(row.title)}</span>
      <span class="small">${esc(row.implementing_entity||'No directorate')} · ${archiveMoney(row.amount_nle)}${row.updated_at?` · ${esc(archiveWhen(row.updated_at))}`:''}</span>
    </button>`).join('');
  }
  const pages=Math.max(1,Math.ceil((data.total||0)/(data.page_size||25)));
  pager.hidden=pages<=1;
  document.getElementById('archivePage').textContent=`Page ${data.page} of ${pages}`;
  document.getElementById('archivePrev').disabled=data.page<=1;
  document.getElementById('archiveNext').disabled=data.page>=pages;
}

async function loadArchive(){
  const generation=++archiveGeneration;
  const state=document.getElementById('archiveState');
  state.textContent='Searching…';
  document.getElementById('archiveResults').textContent='';
  try{
    const data=await archiveApi('/api/archive?'+archiveParams().toString());
    if(generation!==archiveGeneration)return;
    renderArchiveRows(data);
  }catch(error){
    if(generation!==archiveGeneration)return;
    document.getElementById('archiveResults').innerHTML='<p class="small">The archive could not be loaded. Check that you are signed in, then try again.</p>';
    state.textContent=error.message==='unauthorized'?'Sign in to search the archive.':error.message;
  }
}

function uploadForm(){
  const options=Object.entries(DOC_LABELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
  return `<form id="archiveUpload" class="archiveTools noPrint"><div class="field"><label for="archiveDocCategory">Document type</label><select id="archiveDocCategory" name="category">${options}</select></div><div class="field"><label for="archiveDocFile">File</label><input id="archiveDocFile" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.doc,.docx,.xls,.xlsx" required></div><button class="btn" type="submit">Add document</button></form><p id="archiveUploadState" class="small" role="status"></p>`;
}

function renderArchiveDetail(){
  const data=archiveDetailData;
  if(!data)return;
  const request=data.request;
  const finance=data.financials||{};
  const budget=data.budget_lines.length?`<table><tr><th>Description</th><th>Qty</th><th>Unit cost</th><th>Total</th></tr>${data.budget_lines.map(line=>`<tr><td>${esc(line.description)}</td><td>${esc(line.quantity)}</td><td>${archiveMoney(line.unit_cost)}</td><td>${archiveMoney(line.total)}</td></tr>`).join('')}</table>`:'<p class="small">No budget lines are stored.</p>';
  const disbursements=(data.disbursements||[]).length?`<table><tr><th>Reference</th><th>Amount</th><th>Rate saved</th></tr>${data.disbursements.map(item=>`<tr><td>${esc(item.reference_number)}</td><td>${archiveMoney(item.amount_nle)}</td><td>${item.rate_snapshot==null?'—':esc(item.rate_snapshot)}</td></tr>`).join('')}</table>`:'<p class="small">No disbursements are recorded.</p>';
  const receipts=(data.receipts||[]).length?`<table><tr><th>Reference</th><th>Amount</th><th>Status</th></tr>${data.receipts.map(item=>`<tr><td>${esc(item.reference_number)}</td><td>${archiveMoney(item.amount)}</td><td>${esc(item.verification_status)}</td></tr>`).join('')}</table>`:'<p class="small">No receipts are recorded.</p>';
  const balanceLine=finance.approved==null?'':`<p class="small">${finance.balanced?'Approved, disbursed, and verified receipts match.':'Outstanding balance: '+archiveMoney(finance.outstanding)+'. Disbursed '+archiveMoney(finance.disbursed)+', verified receipts '+archiveMoney(finance.verified_receipts)+'.'}</p>`;
  const documents=data.documents.length?data.documents.map(doc=>`<div class="docRow"><div><b>${esc(doc.file_name)}</b><div class="small">${esc(docLabel(doc))}${doc.superseded_at?' · replaced':''}</div></div><button type="button" class="btn secondary" data-doc="${esc(doc.id)}" data-mime="${esc(doc.mime_type||'')}" data-name="${esc(doc.file_name)}">Download</button></div>`).join(''):'<p class="small">No documents are attached.</p>';
  const timeline=data.events.length?`<div class="timeline">${data.events.map(event=>`<div class="event"><b>${esc(eventLabel(event.action))}</b><div class="small">${esc(event.actor_name||'System')}${event.created_at?` · ${esc(archiveWhen(event.created_at))}`:''}</div><div>${esc(event.note||'')}</div></div>`).join('')}</div>`:'<p class="small">No decisions are recorded yet.</p>';
  const audit=data.audit.length?`<table><tr><th>When</th><th>Who</th><th>What happened</th></tr>${data.audit.map(item=>`<tr><td>${esc(archiveWhen(item.created_at))}</td><td>${esc(item.actor_name||'System')}</td><td>${esc(item.details||item.action)}</td></tr>`).join('')}</table>`:'<p class="small">No activity is recorded for this request.</p>';
  const box=document.getElementById('archiveDetail');
  box.classList.remove('hide');
  document.getElementById('archiveListPanel')?.classList.add('hide');
  box.innerHTML=`<button type="button" class="btn secondary noPrint archiveBack" id="archiveBack">Back to results</button>
    <div class="archiveHead"><div><div class="archiveRef">${esc(request.request_number)}</div><h2 style="margin:4px 0">${esc(request.title)}</h2><div class="small">${esc(request.implementing_entity||'')} · ${esc(request.current_stage||'')}</div></div><div class="noPrint" style="display:flex;gap:8px;align-items:center">${archiveBadge(request.status)}<button type="button" class="btn secondary" id="archivePrint">Print</button></div></div>
    <div class="archiveAmounts"><div><span class="small">Requested</span><strong>${archiveMoney(request.amount_nle)}</strong></div><div><span class="small">Approved</span><strong>${request.approved_amount_nle==null?'Not approved yet':archiveMoney(request.approved_amount_nle)}</strong></div><div><span class="small">Disbursed</span><strong>${archiveMoney(finance.disbursed||0)}</strong></div><div><span class="small">Verified receipts</span><strong>${archiveMoney(finance.verified_receipts||0)}</strong></div></div>
    ${balanceLine}
    <p>${esc(request.details||'')}</p>
    <p class="small">${[request.requesting_authority&&`Officer: ${request.requesting_authority}`,request.fiscal_year&&`Year: ${request.fiscal_year}`,request.submitted_at&&`Submitted ${archiveWhen(request.submitted_at)}`,request.approved_at&&`Approved ${archiveWhen(request.approved_at)}`].filter(Boolean).map(esc).join(' · ')||''}</p>
    <div class="archiveSection"><h3>Budget</h3>${budget}</div>
    <div class="archiveSection"><h3>Disbursements</h3>${disbursements}</div>
    <div class="archiveSection"><h3>Receipts</h3>${receipts}</div>
    <div class="archiveSection"><h3>Documents</h3>${documents}${uploadForm()}</div>
    <div class="archiveSection"><h3>What happened</h3>${timeline}</div>
    <details class="archiveMore"><summary>Activity log and record keeping</summary>
      <div class="archiveSection">${audit}</div>
      <p class="small">Archive status: ${esc(request.archival_status||'active')}. Legal hold: ${Number(request.legal_hold)?'Yes — '+esc(request.legal_hold_reason||''):'No'}. Retention: ${esc(request.retention_category||'not set')}${request.retention_until?' until '+esc(request.retention_until):''}. Version ${esc(request.version||1)}. ${request.rate_snapshot?`The rate saved with this request is ${esc(request.rate_snapshot)} NLe per 1 USD.`:'No exchange rate was saved with this request.'}</p>
    </details>`;
  box.querySelector('#archiveBack')?.addEventListener('click',closeArchiveDetail);
  box.querySelector('#archivePrint')?.addEventListener('click',()=>{document.body.classList.add('printingArchive');window.print()});
  box.querySelectorAll('[data-doc]').forEach(button=>button.addEventListener('click',()=>downloadArchiveDocument(button)));
  box.querySelector('#archiveUpload')?.addEventListener('submit',uploadArchiveDocument);
  box.focus();
}

function closeArchiveDetail(){
  document.getElementById('archiveDetail')?.classList.add('hide');
  document.getElementById('archiveListPanel')?.classList.remove('hide');
  document.getElementById('archiveQ')?.focus();
}

async function openArchive(id){
  const generation=++archiveGeneration;
  document.getElementById('archiveState').textContent='Opening record…';
  try{
    const data=await archiveApi('/api/archive/'+encodeURIComponent(id));
    if(generation!==archiveGeneration)return;
    archiveDetailData=data;
    document.getElementById('archiveState').textContent='Record opened.';
    renderArchiveDetail();
  }catch(error){
    if(generation!==archiveGeneration)return;
    document.getElementById('archiveState').textContent=error.message;
  }
}

async function downloadArchiveDocument(button){
  const state=document.getElementById('archiveUploadState');
  try{
    const response=await archiveApi('/api/documents/'+encodeURIComponent(button.dataset.doc));
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download=button.dataset.name||'document';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(error){if(state)state.textContent=error.message}
}

async function uploadArchiveDocument(event){
  event.preventDefault();
  const state=document.getElementById('archiveUploadState');
  const form=event.currentTarget;
  state.textContent='Adding the document…';
  try{
    await archiveApi('/api/requests/'+encodeURIComponent(archiveDetailData.request.id)+'/documents',{method:'POST',body:new FormData(form)});
    state.textContent='Added.';
    await openArchive(archiveDetailData.request.id);
  }catch(error){state.textContent=error.message}
}

document.getElementById('archiveSearch')?.addEventListener('submit',event=>{event.preventDefault();archivePage=1;loadArchive()});
document.getElementById('archiveStatusFilter')?.addEventListener('change',()=>{archivePage=1;loadArchive()});
document.getElementById('archiveSort')?.addEventListener('change',()=>{archivePage=1;loadArchive()});
document.getElementById('archivePrev')?.addEventListener('click',()=>{if(archivePage>1){archivePage-=1;loadArchive()}});
document.getElementById('archiveNext')?.addEventListener('click',()=>{archivePage+=1;loadArchive()});
document.getElementById('archiveExport')?.addEventListener('click',async()=>{
  const params=archiveParams();params.delete('page');params.delete('page_size');
  try{
    const response=await archiveApi('/api/archive/export?'+params.toString());
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download='srhr-archive.csv';link.click();
    URL.revokeObjectURL(url);
  }catch(error){document.getElementById('archiveState').textContent=error.message}
});
document.getElementById('archiveResults')?.addEventListener('click',event=>{
  const open=event.target.closest('[data-archive-id]');
  if(open)openArchive(open.dataset.archiveId);
});
window.addEventListener('afterprint',()=>document.body.classList.remove('printingArchive'));

const archiveShow=show;
show=function(view){
  const result=archiveShow(view);
  if(view==='archive'&&document.getElementById('archive')?.classList.contains('active')){
    closeArchiveDetail();
    loadArchive();
  }
  return result;
};
