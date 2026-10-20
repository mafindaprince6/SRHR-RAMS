window.RoleBoards=window.RoleBoards||{};
window.RoleBoards['Chairman']=async function renderChairmanDashboard(root){
  const kit=window.RoleKit;
  root.innerHTML='<p class="small">Loading decisions…</p>';
  const [queue,dash]=await Promise.all([
    kit.api('/api/queues?desk=chairman'),
    kit.api('/api/dashboard')
  ]);
  const rows=queue.records||[];
  const amount=rows.reduce((sum,row)=>sum+(Number(row.amount_nle)||0),0);
  const actions=`<div class="roleHeroActions"><button class="btn light" type="button" onclick="show('approval')"><svg class="ico"><use href="#i-stamp"></use></svg> Open approval desk</button></div>`;
  const body=rows.map(row=>`<tr><td>${kit.esc(row.request_number)}</td><td>${kit.esc(row.title)}</td><td>${kit.esc(row.implementing_entity)}</td><td>${kit.money(row.amount_nle)}</td><td>${row.waiting_hours==null?'—':kit.esc(row.waiting_hours+'h')}</td></tr>`).join('');
  root.innerHTML=`
    ${kit.hero('CHAIRMAN','Decisions waiting for you','Approve, query, or reject requests the Project Secretary has cleared. You do not file requests or concept notes.',actions)}
    ${kit.stats([
      {label:'AWAITING YOU',value:rows.length,accent:true},
      {label:'AMOUNT WAITING',value:kit.money(amount)},
      {label:'APPROVED',value:dash.approved??0},
      {label:'CLOSED',value:dash.closed??0}
    ])}
    <h2>Cleared to the Chairman</h2>
    ${kit.table(['Reference','Activity','Directorate','Amount','Waiting'],body?[body]:[],'No request is waiting for a decision.')}
  `;
};
