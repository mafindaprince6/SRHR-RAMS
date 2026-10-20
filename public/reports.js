async function reportsApi(path,options={}){
  const headers={...(options.headers||{})};
  if(options.body!==undefined)headers['content-type']='application/json';
  const response=await fetch(path,{...options,headers,credentials:'same-origin',body:options.body===undefined?undefined:JSON.stringify(options.body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.message||data.error||'Request failed');
  return data;
}

function reportMoney(value){
  const n=Number(value);
  return Number.isFinite(n)?`NLe ${n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:'NLe 0.00';
}

async function loadManagementReport(){
  const panel=document.getElementById('reportsPanel');
  if(!panel)return;
  panel.innerHTML='<p class="small">Loading report…</p>';
  try{
    const year=document.getElementById('reportFiscalYear')?.value?.trim()||'';
    const query=year?`?fiscal_year=${encodeURIComponent(year)}`:'';
    const data=await reportsApi('/api/reports/management'+query);
    const s=data.summary||{};
    const turn=data.approval_turnaround||{};
    const money=data.execution||{};
    const deliverables=data.deliverables||{};
    const statusRows=(data.by_status||[]).map(row=>`<tr><td>${esc(row.status)}</td><td>${esc(row.count)}</td><td>${reportMoney(row.amount_nle)}</td></tr>`).join('')||'<tr><td colspan="3" class="small">No data.</td></tr>';
    const entityRows=(data.by_entity||[]).map(row=>`<tr><td>${esc(row.implementing_entity)}</td><td>${esc(row.count)}</td><td>${reportMoney(row.requested)}</td><td>${reportMoney(row.approved)}</td></tr>`).join('')||'<tr><td colspan="4" class="small">No data.</td></tr>';
    const yearRows=(data.by_year||[]).map(row=>`<tr><td>${esc(row.fiscal_year||'Not set')}</td><td>${esc(row.count)}</td><td>${reportMoney(row.requested)}</td><td>${reportMoney(row.approved)}</td></tr>`).join('')||'<tr><td colspan="4" class="small">No data.</td></tr>';
    const retentionRows=(data.retention_review||[]).map(row=>`<tr><td>${esc(row.request_number)}</td><td>${esc(row.title)}</td><td>${esc(row.retention_until)}</td><td>${esc(row.retention_category||'')}</td></tr>`).join('')||'<tr><td colspan="4" class="small">No records are due for retention review.</td></tr>';
    const turnaroundText=turn.decided?`${esc(turn.decided)} approved record${Number(turn.decided)===1?'':'s'}, average ${esc(turn.average_days)} day${Number(turn.average_days)===1?'':'s'} from submission to approval.`:'No approved records in this view yet.';
    const storageNote=data.document_storage?'':' Document storage is not configured, so a missing document means no file is stored on the record.';
    panel.innerHTML=`
      <div class="cards">
        <div class="card"><div class="label">TOTAL RECORDS</div><div class="metric">${esc(s.total||0)}</div></div>
        <div class="card"><div class="label">OPEN</div><div class="metric">${esc(s.open||0)}</div></div>
        <div class="card"><div class="label">CLOSED</div><div class="metric">${esc(s.closed||0)}</div></div>
        <div class="card"><div class="label">ARCHIVED</div><div class="metric">${esc(s.archived||0)}</div></div>
        <div class="card"><div class="label">LEGAL HOLDS</div><div class="metric">${esc(s.legal_holds||0)}</div></div>
        <div class="card"><div class="label">RETENTION DUE</div><div class="metric">${esc(s.retention_due||0)}</div></div>
      </div>
      <div class="cards">
        <div class="card"><div class="label">SECRETARY QUEUE</div><div class="metric">${esc(s.secretary_queue||0)}</div></div>
        <div class="card"><div class="label">CHAIRMAN QUEUE</div><div class="metric">${esc(s.chairman_queue||0)}</div></div>
        <div class="card"><div class="label">IHPAU QUEUE</div><div class="metric">${esc(s.ihpau_queue||0)}</div></div>
        <div class="card"><div class="label">MISSING DOCUMENTS</div><div class="metric">${esc(s.missing_documents||0)}</div></div>
        <div class="card"><div class="label">DELIVERABLES PENDING</div><div class="metric">${esc(deliverables.pending||0)}</div></div>
      </div>
      <p class="small">Report generated ${esc(new Date(data.generated_at).toLocaleString())}. Figures follow the records your role can see.${esc(storageNote)}</p>
      <div class="archiveSection"><h3>Approval turnaround</h3><p>${turnaroundText}</p></div>
      <div class="archiveSection"><h3>Budget execution</h3><p>Approved ${reportMoney(money.approved)}. Disbursed ${reportMoney(money.disbursed)}. Verified receipts ${reportMoney(money.verified_receipts)}.</p><p class="small">Outstanding disbursement: ${esc(money.outstanding_disbursement?.count||0)} open request${Number(money.outstanding_disbursement?.count)===1?'':'s'}, ${reportMoney(money.outstanding_disbursement?.amount)}. Outstanding liquidation: ${esc(money.outstanding_liquidation?.count||0)} open request${Number(money.outstanding_liquidation?.count)===1?'':'s'}, ${reportMoney(money.outstanding_liquidation?.amount)} still short of verified receipts. Deliverables recorded ${esc(deliverables.recorded||0)}, verified ${esc(deliverables.verified||0)}.</p></div>
      <div class="archiveSection"><h3>By status</h3><div class="tableWrap"><table><tr><th>Status</th><th>Count</th><th>Requested</th></tr>${statusRows}</table></div></div>
      <div class="archiveSection"><h3>By implementing entity</h3><div class="tableWrap"><table><tr><th>Entity</th><th>Count</th><th>Requested</th><th>Approved</th></tr>${entityRows}</table></div></div>
      <div class="archiveSection"><h3>By fiscal year</h3><div class="tableWrap"><table><tr><th>Fiscal year</th><th>Count</th><th>Requested</th><th>Approved</th></tr>${yearRows}</table></div></div>
      <div class="archiveSection"><h3>Retention review queue</h3><p class="small">Closed records past retention date, still active, and not on legal hold.</p><div class="tableWrap"><table><tr><th>Reference</th><th>Title</th><th>Until</th><th>Category</th></tr>${retentionRows}</table></div></div>`;
  }catch(error){
    panel.innerHTML=`<p class="small">${esc(error.message)}</p>`;
  }
}

function exportManagementReport(){
  const year=document.getElementById('reportFiscalYear')?.value?.trim()||'';
  const query=year?`?fiscal_year=${encodeURIComponent(year)}`:'';
  window.location.href='/api/reports/management/export'+query;
}

async function runAuditIntegrityCheck(){
  const box=document.getElementById('auditIntegrityState');
  if(!box)return;
  box.textContent='Checking audit integrity…';
  try{
    const data=await reportsApi('/api/admin/audit/integrity');
    if(data.ok){
      box.innerHTML='<span class="ok">No integrity issues detected in the sampled checks.</span>';
      return;
    }
    box.innerHTML=`<span class="missing">${data.issues.length} issue(s) found.</span><ul class="small">${data.issues.map(item=>`<li>${esc(item.code)}: ${esc(item.message)} ${item.request_number?esc(item.request_number):''}</li>`).join('')}</ul>`;
  }catch(error){
    box.textContent=error.message;
  }
}

const reportsShow=typeof show==='function'?show:null;
if(reportsShow){
  show=function(view){
    const result=reportsShow(view);
    if(view==='reports'&&document.getElementById('reports')?.classList.contains('active'))loadManagementReport();
    return result;
  };
}

async function applyRecordControl(){
  const ref=document.getElementById('recordControlRef')?.value?.trim();
  const action=document.getElementById('recordControlAction')?.value;
  const note=document.getElementById('recordControlNote')?.value?.trim();
  const category=document.getElementById('recordControlCategory')?.value?.trim();
  const archival=document.getElementById('recordControlArchival')?.value;
  const state=document.getElementById('recordControlState');
  if(!ref||!note){alert('Reference and reason are required.');return}
  const body={action,note};
  if(action==='update_record'){
    if(category)body.retention_category=category;
    if(archival)body.archival_status=archival;
  }
  state.textContent='Saving…';
  try{
    await reportsApi('/api/admin/records/'+encodeURIComponent(ref)+'/control',{method:'POST',body});
    state.textContent='Record control updated and audited.';
    await loadManagementReport();
  }catch(error){
    state.textContent=error.message;
  }
}
