window.RoleBoards=window.RoleBoards||{};
window.RoleBoards['Directorate User']=async function renderDirectorateDashboard(root){
  const kit=window.RoleKit;
  root.innerHTML='<p class="small">Loading your requests…</p>';
  const queue=await kit.api('/api/queues?desk=directorate');
  const rows=queue.records||[];
  const drafts=rows.filter(row=>row.status==='Draft').length;
  const returned=rows.filter(row=>row.status==='Query Raised').length;
  const moving=rows.filter(row=>row.status!=='Draft'&&row.status!=='Closed'&&row.status!=='Query Raised').length;
  const closed=rows.filter(row=>row.status==='Closed').length;
  const actions=`<div class="roleHeroActions"><button class="btn light" type="button" onclick="show('new')"><svg class="ico"><use href="#i-plus"></use></svg> File a request</button><button class="btn light" type="button" onclick="show('concept')"><svg class="ico"><use href="#i-file"></use></svg> Concept note</button><button class="btn light" type="button" onclick="show('awp')"><svg class="ico"><use href="#i-book"></use></svg> Annual work plan</button><button class="btn secondary" type="button" onclick="show('requests')">My requests</button></div>`;
  const body=rows.slice(0,8).map(row=>`<tr><td>${kit.esc(row.request_number)}</td><td>${kit.esc(row.title)}</td><td>${kit.esc(row.implementing_entity)}</td><td>${kit.money(row.amount_nle)}</td><td>${kit.badge(row)}</td></tr>`).join('');
  root.innerHTML=`
    ${kit.hero('DIRECTORATE WORKSPACE','Your requests and concept notes','File a request, attach a concept note, and follow only the records your directorate owns.',actions)}
    ${kit.stats([
      {label:'DRAFTS',value:drafts,accent:true},
      {label:'RETURNED TO YOU',value:returned},
      {label:'IN REVIEW',value:moving},
      {label:'CLOSED',value:closed}
    ])}
    <h2>Your records</h2>
    ${kit.table(['Reference','Activity','Directorate','Amount','Status'],body?[body]:[],'No requests yet. File a request to start one.')}
  `;
};
