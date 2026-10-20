window.RoleBoards=window.RoleBoards||{};
window.RoleBoards['Project Secretary']=async function renderSecretaryDashboard(root){
  const kit=window.RoleKit;
  root.innerHTML='<p class="small">Loading the clearance desk…</p>';
  const [queue,dash]=await Promise.all([
    kit.api('/api/queues?desk=secretary'),
    kit.api('/api/dashboard')
  ]);
  const rows=queue.records||[];
  const oldest=rows.reduce((max,row)=>Math.max(max,Number(row.waiting_hours)||0),0);
  const actions=`<div class="roleHeroActions"><button class="btn light" type="button" onclick="show('secretary')"><svg class="ico"><use href="#i-inbox"></use></svg> Open clearance desk</button></div>`;
  const body=rows.map(row=>`<tr><td>${kit.esc(row.request_number)}</td><td>${kit.esc(row.implementing_entity)}</td><td>${kit.esc(row.request_type)}</td><td>${kit.money(row.amount_nle)}</td><td>${row.waiting_hours==null?'—':kit.esc(row.waiting_hours+'h')}</td></tr>`).join('');
  root.innerHTML=`
    ${kit.hero('PROJECT SECRETARY','Clearance desk','Review submitted requests. Clear them to the Chairman, or return them with a reason. This desk does not file new requests.',actions)}
    ${kit.stats([
      {label:'WAITING TO CLEAR',value:rows.length,accent:true},
      {label:'OLDEST WAIT',value:oldest?oldest+'h':'—'},
      {label:'WITH THE CHAIRMAN',value:dash.awaiting_approval??0},
      {label:'ALREADY AT IHPAU',value:dash.at_ihpau??0}
    ])}
    <h2>Submitted to you</h2>
    ${kit.table(['Reference','Directorate','Type','Amount','Waiting'],body?[body]:[],'Nothing is waiting for clearance.')}
  `;
};
