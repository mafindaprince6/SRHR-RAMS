window.RoleBoards=window.RoleBoards||{};
window.RoleBoards['IHPAU']=async function renderIhpauDashboard(root){
  const kit=window.RoleKit;
  root.innerHTML='<p class="small">Loading the finance overview…</p>';
  const [queue,dash]=await Promise.all([
    kit.api('/api/queues?desk=ihpau'),
    kit.api('/api/dashboard')
  ]);
  const rows=queue.records||[];
  const amount=rows.reduce((sum,row)=>sum+(Number(row.amount_nle)||0),0);
  const actions=`<div class="roleHeroActions" id="dashHeroIhpau"><button class="btn light" type="button" onclick="show('ihpau')"><svg class="ico"><use href="#i-briefcase"></use></svg> Open IHPAU desk</button><button class="btn secondary" type="button" onclick="show('awp')">Annual work plan</button><button class="btn secondary" type="button" onclick="show('register')">Live register</button></div>`;
  const body=rows.map(row=>`<tr><td>${kit.esc(row.request_number)}</td><td>${kit.esc(row.title)}</td><td>${kit.esc(row.status)}</td><td>${kit.money(row.amount_nle)}</td><td>${kit.badge(row)}</td></tr>`).join('');
  root.innerHTML=`
    ${kit.hero('IHPAU FINANCE','Funds, receipts, and closure','Disburse approved funds, check receipts, and close records when the money is accounted for. IHPAU does not file requests.',actions)}
    ${kit.stats([
      {label:'ON YOUR DESK',value:rows.length,accent:true},
      {label:'VALUE ON DESK',value:kit.money(amount)},
      {label:'STILL WITH CHAIRMAN',value:dash.awaiting_approval??0},
      {label:'CLOSED',value:dash.closed??0}
    ])}
    <h2>Finance pipeline</h2>
    ${kit.table(['Reference','Activity','Finance status','Amount','Stage'],body?[body]:[],'No open request is with IHPAU.')}
  `;
};
