window.RoleKit={
  async api(path){
    const response=await fetch(path,{credentials:'include'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||data.error||`HTTP ${response.status}`);
    return data;
  },
  esc(value){
    return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },
  money(value){
    const amount=Number(value);
    return Number.isFinite(amount)?`NLe ${amount.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—';
  },
  badge(row){
    const status=row.status||'';
    if(status==='Closed')return '<span class="badge">Closed</span>';
    if(status==='Query Raised')return '<span class="badge warn">Returned</span>';
    if(status==='Draft')return '<span class="badge">Draft</span>';
    if(status==='Awaiting Approval')return '<span class="badge warn">Awaiting approval</span>';
    if(row.current_stage==='IHPAU / Finance')return '<span class="badge info">At IHPAU</span>';
    return `<span class="badge">${this.esc(status)}</span>`;
  },
  stats(items){
    return `<div class="roleGrid">${items.map(item=>`<div class="roleStat${item.accent?' accent':''}"><span>${this.esc(item.label)}</span><b>${this.esc(item.value)}</b></div>`).join('')}</div>`;
  },
  table(headers,rows,empty){
    const head=headers.map(label=>`<th>${this.esc(label)}</th>`).join('');
    const body=rows.length?rows.join(''):`<tr><td colspan="${headers.length}" class="small">${this.esc(empty)}</td></tr>`;
    return `<div class="panel"><div class="tableWrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  },
  hero(kicker,title,text,actions=''){
    return `<div class="roleHero"><div class="roleKicker">${this.esc(kicker)}</div><h2>${this.esc(title)}</h2><p>${this.esc(text)}</p>${actions}</div>`;
  }
};
