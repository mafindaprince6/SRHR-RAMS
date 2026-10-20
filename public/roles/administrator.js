window.RoleBoards=window.RoleBoards||{};
window.RoleBoards['Administrator']=async function renderAdministratorDashboard(root){
  const kit=window.RoleKit;
  root.innerHTML='<p class="small">Loading the control overview…</p>';
  const dash=await kit.api('/api/dashboard');
  const rows=dash.recent||[];
  const actions=`<div class="roleHeroActions"><button class="btn light" type="button" onclick="show('admin')">Control centre</button><button class="btn secondary" type="button" onclick="show('admin');adminTool('governance')">Permissions & health</button><button class="btn secondary" type="button" onclick="show('archive')">Archive</button></div>`;
  const body=rows.map(row=>`<tr><td>${kit.esc(row.request_number)}</td><td>${kit.esc(row.title)}</td><td>${kit.esc(row.request_type)}</td><td>${kit.money(row.amount_nle)}</td><td>${kit.badge(row)}</td></tr>`).join('');
  root.innerHTML=`
    ${kit.hero('ADMINISTRATION','System overview','Watch every desk, accounts, and permissions. Filing a request or a concept note stays with the Directorate.',actions)}
    ${kit.stats([
      {label:'ALL RECORDS',value:dash.total??0,accent:true},
      {label:'AWAITING CHAIRMAN',value:dash.awaiting_approval??0},
      {label:'AT IHPAU',value:dash.at_ihpau??0},
      {label:'CLOSED',value:dash.closed??0}
    ])}
    <h2>Latest movement</h2>
    ${kit.table(['Reference','Activity','Type','Amount','Status'],body?[body]:[],'No records are stored yet.')}
  `;
};
