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
    const statusRows=(data.by_status||[]).map(row=>`<tr><td>${esc(row.status)}</td><td>${esc(row.count)}</td><td>${reportMoney(row.amount_nle)}</td></tr>`).join('')||'<tr><td colspan="3" class="small">No data.</td></tr>';
    const entityRows=(data.by_entity||[]).map(row=>`<tr><td>${esc(row.implementing_entity)}</td><td>${esc(row.count)}</td><td>${reportMoney(row.requested)}</td><td>${reportMoney(row.approved)}</td></tr>`).join('')||'<tr><td colspan="4" class="small">No data.</td></tr>';
    const retentionRows=(data.retention_review||[]).map(row=>`<tr><td>${esc(row.request_number)}</td><td>${esc(row.title)}</td><td>${esc(row.retention_until)}</td><td>${esc(row.retention_category||'')}</td></tr>`).join('')||'<tr><td colspan="4" class="small">No records are due for retention review.</td></tr>';
    panel.innerHTML=`
      <div class="cards">
        <div class="card"><div class="label">TOTAL RECORDS</div><div class="metric">${esc(s.total||0)}</div></div>
        <div class="card"><div class="label">OPEN</div><div class="metric">${esc(s.open||0)}</div></div>
        <div class="card"><div class="label">CLOSED</div><div class="metric">${esc(s.closed||0)}</div></div>
        <div class="card"><div class="label">LEGAL HOLDS</div><div class="metric">${esc(s.legal_holds||0)}</div></div>
        <div class="card"><div class="label">RETENTION DUE</div><div class="metric">${esc(s.retention_due||0)}</div></div>
      </div>
      <p class="small">Report generated ${esc(new Date(data.generated_at).toLocaleString())}. Amounts respect your role visibility.</p>
      <div class="archiveSection"><h3>By status</h3><div class="tableWrap"><table><tr><th>Status</th><th>Count</th><th>Requested</th></tr>${statusRows}</table></div></div>
      <div class="archiveSection"><h3>By implementing entity</h3><div class="tableWrap"><table><tr><th>Entity</th><th>Count</th><th>Requested</th><th>Approved</th></tr>${entityRows}</table></div></div>
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
