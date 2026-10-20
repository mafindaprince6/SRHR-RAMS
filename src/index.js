const J=(d,s=200,h={})=>new Response(JSON.stringify(d),{
  status:s,
  headers:{
    'content-type':'application/json',
    'cache-control':'no-store',
    ...h
  }
});

const enc=new TextEncoder();

const b64=a=>
  btoa(String.fromCharCode(...new Uint8Array(a)));

const unb64=s=>
  Uint8Array.from(atob(s),c=>c.charCodeAt(0));


async function digest(s){
  return b64(
    await crypto.subtle.digest(
      'SHA-256',
      enc.encode(s)
    )
  );
}


async function verify(password,stored){
  try{
    const p=String(stored).trim().split('$');

    if(
      p.length!==4 ||
      p[0]!=='pbkdf2_sha256'
    ){
      return false;
    }

    const iterations=Number(p[1]);

    // Cloudflare Workers currently rejects PBKDF2
    // iteration counts above 100000.
    if(
      !Number.isInteger(iterations) ||
      iterations<1 ||
      iterations>100000
    ){
      return false;
    }

    const salt=unb64(p[2]);
    const expected=unb64(p[3]);

    const key=await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      {
        name:'PBKDF2'
      },
      false,
      ['deriveBits']
    );

    const actual=new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name:'PBKDF2',
          hash:'SHA-256',
          salt,
          iterations
        },
        key,
        expected.length*8
      )
    );

    if(actual.length!==expected.length){
      return false;
    }

    let diff=0;

    for(let i=0;i<actual.length;i++){
      diff|=actual[i]^expected[i];
    }

    return diff===0;

  }catch(e){
    return false;
  }
}


async function hashPassword(password){

  const salt=
    crypto.getRandomValues(
      new Uint8Array(16)
    );

  // IMPORTANT:
  // Cloudflare Worker limit discovered from runtime logs.
  const iterations=100000;

  const key=await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    {
      name:'PBKDF2'
    },
    false,
    ['deriveBits']
  );

  const bits=
    await crypto.subtle.deriveBits(
      {
        name:'PBKDF2',
        hash:'SHA-256',
        salt,
        iterations
      },
      key,
      256
    );

  return (
    `pbkdf2_sha256$${iterations}$`+
    `${b64(salt)}$${b64(bits)}`
  );
}


function ck(req){

  const o={};

  for(
    const x of
    (req.headers.get('cookie')||'').split(';')
  ){

    const i=x.indexOf('=');

    if(i>0){

      o[x.slice(0,i).trim()]=
        decodeURIComponent(
          x.slice(i+1).trim()
        );

    }
  }

  return o;
}


async function me(req,env){

  const t=ck(req).srhr_session;

  if(!t){
    return null;
  }

  return env.DB.prepare(
    `
    SELECT
      u.id,
      u.name,
      u.username,
      u.role,
      u.entity,
      u.active,
      u.must_change

    FROM sessions s

    JOIN users u
      ON u.id=s.user_id

    WHERE
      s.token_hash=?
      AND s.expires_at>datetime('now')
      AND u.active=1
    `
  )
  .bind(
    await digest(t)
  )
  .first();
}


async function audit(
  env,
  u,
  action,
  rid='',
  details=''
){

  await env.DB.prepare(
    `
    INSERT INTO audit_log(
      id,
      actor_user_id,
      action,
      request_id,
      details,
      created_at
    )
    VALUES(?,?,?,?,?,?)
    `
  )
  .bind(
    crypto.randomUUID(),
    u?.id||null,
    action,
    rid,
    details,
    new Date().toISOString()
  )
  .run()
  .catch(()=>{});
}


async function note(
  env,
  role,
  rid,
  type,
  message
){

  await env.DB.prepare(
    `
    INSERT INTO notifications(
      id,
      recipient_role,
      request_id,
      type,
      message,
      created_at
    )
    VALUES(?,?,?,?,?,?)
    `
  )
  .bind(
    crypto.randomUUID(),
    role,
    rid,
    type,
    message,
    new Date().toISOString()
  )
  .run()
  .catch(()=>{});
}


const allowed=(u,roles)=>
  roles.includes(u.role);

const DOCUMENT_CATEGORIES=new Set(['concept_note','request_form','budget','approval','receipt','invoice','report','deliverable','scan','other']);
const MAX_DOCUMENT_BYTES=10*1024*1024;
const DOCUMENT_TYPES={
  pdf:{mime:'application/pdf',magic:[[0x25,0x50,0x44,0x46]]},
  png:{mime:'image/png',magic:[[0x89,0x50,0x4e,0x47]]},
  jpg:{mime:'image/jpeg',magic:[[0xff,0xd8,0xff]]},
  jpeg:{mime:'image/jpeg',magic:[[0xff,0xd8,0xff]]},
  tif:{mime:'image/tiff',magic:[[0x49,0x49,0x2a,0x00],[0x4d,0x4d,0x00,0x2a]]},
  tiff:{mime:'image/tiff',magic:[[0x49,0x49,0x2a,0x00],[0x4d,0x4d,0x00,0x2a]]},
  docx:{mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',magic:[[0x50,0x4b,0x03,0x04]],office:'word/'},
  xlsx:{mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',magic:[[0x50,0x4b,0x03,0x04]],office:'xl/'},
  doc:{mime:'application/msword',magic:[[0xd0,0xcf,0x11,0xe0]]},
  xls:{mime:'application/vnd.ms-excel',magic:[[0xd0,0xcf,0x11,0xe0]]}
};
const ARCHIVE_SORTS={created_at:'created_at',updated_at:'updated_at',request_number:'request_number',title:'title',amount:'amount_nle',status:'status'};

function likeTerm(value){
  return `%${String(value).replace(/[\\%_]/g,ch=>`\\${ch}`)}%`;
}
function dayStart(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)?`${value}T00:00:00.000Z`:value}
function dayEnd(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)?`${value}T23:59:59.999Z`:value}
function sha256Hex(bytes){
  return crypto.subtle.digest('SHA-256',bytes).then(buf=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''));
}
function safeFileName(name){
  const base=String(name||'document').split(/[/\\]/).pop();
  return base.replace(/[^A-Za-z0-9._ -]/g,'_').slice(0,180)||'document';
}
function matchesMagic(bytes,magics){
  return magics.some(magic=>magic.every((b,i)=>bytes[i]===b));
}

async function archiveReady(env){
  try{
    await env.DB.prepare('SELECT last_seq FROM request_numbers LIMIT 1').first();
    return true;
  }catch{return false}
}

async function allocateRequestNumber(env){
  const year=new Date().getUTCFullYear();
  const row=await env.DB.prepare(
    `INSERT INTO request_numbers(year, last_seq) VALUES(?, 1)
     ON CONFLICT(year) DO UPDATE SET last_seq=last_seq+1
     RETURNING last_seq`
  ).bind(year).first();
  return `SRHR-${year}-${String(row.last_seq).padStart(6,'0')}`;
}

async function currentUsdRate(env){
  const row=await env.DB.prepare('SELECT value FROM system_settings WHERE key=?').bind('usd_nle_rate').first();
  if(!row)return null;
  try{
    const rate=JSON.parse(row.value).rate;
    return typeof rate==='number'&&Number.isFinite(rate)&&rate>0?rate:null;
  }catch{return null}
}

function archiveScope(u){
  if(u.role==='Administrator')return {sql:'1=1',args:[]};
  if(u.role==='Directorate User'){
    return {sql:"(created_by=? OR (implementing_entity=? AND status='Draft'))",args:[u.id,u.entity||'']};
  }
  return {sql:"status!='Draft'",args:[]};
}

const QUEUE_DESKS=new Set(['secretary','chairman','ihpau','directorate']);
const QUEUE_LIST_COLUMNS='id,request_number,title,request_type,implementing_entity,amount_nle,status,current_stage,submitted_at,updated_at,created_at';

function queueAccess(u,desk){
  if(!QUEUE_DESKS.has(desk))return false;
  if(u.role==='Administrator')return true;
  const roleByDesk={
    secretary:'Project Secretary',
    chairman:'Chairman',
    ihpau:'IHPAU',
    directorate:'Directorate User'
  };
  return roleByDesk[desk]===u.role;
}

function queueFilter(desk,u){
  const scope=archiveScope(u);
  const where=[scope.sql];
  const args=[...scope.args];
  if(desk==='secretary'){
    where.push('status=?','current_stage=?');
    args.push('Submitted','Project Secretary');
  }else if(desk==='chairman'){
    where.push('status=?','current_stage=?');
    args.push('Awaiting Approval','Chairman');
  }else if(desk==='ihpau'){
    where.push('current_stage=?','status!=?');
    args.push('IHPAU / Finance','Closed');
  }else if(desk!=='directorate'){
    return null;
  }
  return {where:where.join(' AND '),args};
}

function queueWaitingHours(iso){
  if(!iso)return null;
  const ms=Date.now()-Date.parse(iso);
  if(Number.isNaN(ms)||ms<0)return 0;
  return Math.floor(ms/3600000);
}

async function fetchQueueRecords(env,u,desk,limit=200){
  const filter=queueFilter(desk,u);
  if(!filter)return null;
  let st=env.DB.prepare(
    `SELECT ${QUEUE_LIST_COLUMNS} FROM requests WHERE ${filter.where} ORDER BY COALESCE(submitted_at,updated_at) ASC LIMIT ?`
  );
  st=st.bind(...filter.args,limit);
  const {results}=await st.all();
  return results.map(row=>({
    ...row,
    waiting_hours:queueWaitingHours(row.submitted_at||row.updated_at),
    needs_action:desk==='directorate'&&(row.status==='Draft'||(row.status==='Query Raised'&&row.current_stage==='Directorate'))
  }));
}

async function countQueue(env,u,desk){
  const filter=queueFilter(desk,u);
  if(!filter)return 0;
  let st=env.DB.prepare(`SELECT COUNT(*) AS n FROM requests WHERE ${filter.where}`);
  if(filter.args.length)st=st.bind(...filter.args);
  return Number((await st.first())?.n||0);
}

async function queueCountsForUser(env,u){
  const counts={};
  for(const desk of QUEUE_DESKS){
    if(!queueAccess(u,desk))continue;
    counts[desk]=await countQueue(env,u,desk);
  }
  if(u.role==='Directorate User'||u.role==='Administrator'){
    const scope=archiveScope(u);
    let st=env.DB.prepare(
      `SELECT COUNT(*) AS n FROM requests WHERE ${scope.sql} AND ((status='Query Raised' AND current_stage='Directorate') OR status='Draft')`
    );
    if(scope.args.length)st=st.bind(...scope.args);
    counts.directorate_action=Number((await st.first())?.n||0);
  }
  return counts;
}

function archiveWhere(url,u){
  const scope=archiveScope(u);
  const where=[scope.sql];
  const args=[...scope.args];
  const q=(url.searchParams.get('q')||'').trim();
  if(q){
    const term=likeTerm(q);
    where.push("(request_number LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR IFNULL(details,'') LIKE ? ESCAPE '\\' OR IFNULL(objective,'') LIKE ? ESCAPE '\\' OR IFNULL(activity_code,'') LIKE ? ESCAPE '\\')");
    args.push(term,term,term,term,term);
  }
  for(const [param,column] of [['entity','implementing_entity'],['category','request_type'],['fiscal_year','fiscal_year'],['status','status'],['funding_source','funding_source'],['archival_status','archival_status']]){
    const value=url.searchParams.get(param);
    if(value){where.push(`${column}=?`);args.push(value)}
  }
  const programme=(url.searchParams.get('programme')||'').trim();
  if(programme){where.push("IFNULL(activity_code,'') LIKE ? ESCAPE '\\'");args.push(likeTerm(programme))}
  const officer=(url.searchParams.get('officer')||'').trim();
  if(officer){where.push("IFNULL(requesting_authority,'') LIKE ? ESCAPE '\\'");args.push(likeTerm(officer))}
  for(const [param,column,op] of [['amount_min','amount_nle','>='],['amount_max','amount_nle','<='],['approved_min','approved_amount_nle','>='],['approved_max','approved_amount_nle','<=']]){
    const raw=url.searchParams.get(param);
    if(raw==null||raw==='')continue;
    const n=Number(raw);
    if(!Number.isFinite(n))return {error:`${param} must be a number`};
    where.push(`${column}${op}?`);args.push(n);
  }
  const submittedFrom=url.searchParams.get('submitted_from');
  const submittedTo=url.searchParams.get('submitted_to');
  if(submittedFrom){where.push('COALESCE(submitted_at,created_at)>=?');args.push(dayStart(submittedFrom))}
  if(submittedTo){where.push('COALESCE(submitted_at,created_at)<=?');args.push(dayEnd(submittedTo))}
  const approvedFrom=url.searchParams.get('approved_from');
  const approvedTo=url.searchParams.get('approved_to');
  if(approvedFrom){where.push('approved_at>=?');args.push(dayStart(approvedFrom))}
  if(approvedTo){where.push('approved_at<=?');args.push(dayEnd(approvedTo))}
  return {where:where.join(' AND '),args};
}

async function saveBudgetAndConcept(env,id,b,now){
  if(Array.isArray(b.budget_lines)){
    for(const line of b.budget_lines){
      if(!line||!String(line.description||'').trim())continue;
      const quantity=Number(line.quantity??1),unit=Number(line.unit_cost??0);
      if(!Number.isFinite(quantity)||!Number.isFinite(unit)||quantity<0||unit<0)continue;
      const total=line.total==null||line.total===''?Math.round(quantity*unit*100)/100:Number(line.total);
      if(!Number.isFinite(total)||total<0)continue;
      await env.DB.prepare('INSERT INTO budget_lines(request_id,description,quantity,unit_cost,total) VALUES(?,?,?,?,?)').bind(id,String(line.description).trim(),quantity,unit,total).run();
    }
  }
  const concept=b.concept_note;
  if(!concept||typeof concept!=='object')return;
  await env.DB.prepare(`INSERT INTO concept_notes(id,request_id,background,problem_statement,goal,specific_objectives,methodology,target_participants,expected_outputs,expected_outcomes,implementation_arrangements,monitoring,risks,conclusion,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),id,concept.background||'',concept.problem_statement||'',concept.goal||'',concept.specific_objectives||'',concept.methodology||'',concept.target_participants||'',concept.expected_outputs||'',concept.expected_outcomes||'',concept.implementation_arrangements||'',concept.monitoring||'',concept.risks||'',concept.conclusion||'',now,now).run();
}

const DEFAULT_SUBMISSION_REQUIREMENTS={
  min_details_length:10,
  min_budget_lines:1,
  min_budget_total:0.01,
  require_concept_note:true,
  concept_min_fields:['background','goal'],
  require_deliverable:true,
  require_timeline:true,
  require_activity_code:false,
  require_funding_source:false,
  enforce_on_direct_submit:false
};

async function submissionRequirements(env){
  const row=await env.DB.prepare('SELECT value FROM system_settings WHERE key=?').bind('submission_requirements').first();
  if(!row)return {...DEFAULT_SUBMISSION_REQUIREMENTS};
  try{return {...DEFAULT_SUBMISSION_REQUIREMENTS,...JSON.parse(row.value)};}catch{return {...DEFAULT_SUBMISSION_REQUIREMENTS};}
}

async function documentsInlineReady(env){
  try{
    await env.DB.prepare('SELECT inline_body FROM documents LIMIT 1').first();
    return true;
  }catch{return false}
}

async function replaceBudgetLines(env,requestId,lines,now){
  await env.DB.prepare('DELETE FROM budget_lines WHERE request_id=?').bind(requestId).run();
  if(Array.isArray(lines)&&lines.length){
    await saveBudgetAndConcept(env,requestId,{budget_lines:lines},now);
  }
}

async function replaceConceptNote(env,requestId,concept,now){
  if(!concept||typeof concept!=='object')return;
  const fields=['background','problem_statement','goal','specific_objectives','methodology','target_participants','expected_outputs','expected_outcomes','implementation_arrangements','monitoring','risks','conclusion'];
  const values=fields.map(f=>concept[f]||'');
  const existing=await env.DB.prepare('SELECT id FROM concept_notes WHERE request_id=?').bind(requestId).first();
  if(existing){
    await env.DB.prepare(`UPDATE concept_notes SET ${fields.map(f=>`${f}=?`).join(',')},updated_at=? WHERE request_id=?`).bind(...values,now,requestId).run();
  }else{
    await env.DB.prepare(`INSERT INTO concept_notes(id,request_id,${fields.join(',')},created_at,updated_at) VALUES(?,?,${fields.map(()=>'?').join(',')},?,?)`).bind(crypto.randomUUID(),requestId,...values,now,now).run();
  }
}

async function assessSubmissionReadiness(env,request){
  const rules=await submissionRequirements(env);
  const items=[];
  const add=(key,label,ok,message)=>items.push({key,label,ok,message:message||(ok?'Complete':'Missing or incomplete')});
  add('title','Request title',!!String(request.title||'').trim());
  const details=String(request.details||'').trim();
  add('details','Purpose / justification',details.length>=(rules.min_details_length||0),details.length?'':'Enter the purpose of the activity');
  add('entity','Implementing entity',!!String(request.implementing_entity||'').trim());
  if(rules.require_activity_code){
    add('activity_code','AWP / activity code',!!String(request.activity_code||'').trim());
  }
  if(rules.require_funding_source){
    add('funding_source','Funding source',!!String(request.funding_source||'').trim());
  }
  if(rules.require_deliverable){
    add('deliverable','Expected deliverable',!!String(request.deliverable||'').trim());
  }
  if(rules.require_timeline){
    add('timeline','Implementation timeline',!!String(request.timeline||'').trim());
  }
  const budget=await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS sum FROM budget_lines WHERE request_id=?').bind(request.id).first();
  const lineCount=Number(budget?.n||0);
  const budgetTotal=Number(budget?.sum||0);
  add('budget_lines','Budget lines',lineCount>=(rules.min_budget_lines||0),`At least ${rules.min_budget_lines} budget line(s) required`);
  add('budget_total','Budget total',budgetTotal>=(rules.min_budget_total||0),`Total must be at least NLe ${rules.min_budget_total}`);
  const concept=await env.DB.prepare('SELECT * FROM concept_notes WHERE request_id=?').bind(request.id).first();
  if(rules.require_concept_note){
    const ok=!!concept;
    add('concept_note','Concept note attached',ok);
    if(concept&&Array.isArray(rules.concept_min_fields)){
      for(const field of rules.concept_min_fields){
        add(`concept_${field}`,`Concept note: ${field}`,!!String(concept[field]||'').trim());
      }
    }
  }
  const ready=items.every(i=>i.ok);
  return {ready,items,rules};
}

async function assessPayloadReadiness(env,b){
  const rules=await submissionRequirements(env);
  const items=[];
  const add=(key,label,ok,message)=>items.push({key,label,ok,message:message||(ok?'Complete':'Missing or incomplete')});
  add('title','Request title',!!String(b.title||'').trim());
  const details=String(b.details||'').trim();
  add('details','Purpose / justification',details.length>=(rules.min_details_length||0));
  add('entity','Implementing entity',!!String(b.implementing_entity||'').trim());
  if(rules.require_activity_code)add('activity_code','AWP / activity code',!!String(b.activity_code||'').trim());
  if(rules.require_funding_source)add('funding_source','Funding source',!!String(b.funding_source||'').trim());
  if(rules.require_deliverable)add('deliverable','Expected deliverable',!!String(b.deliverable||'').trim());
  if(rules.require_timeline)add('timeline','Implementation timeline',!!String(b.timeline||'').trim());
  const lines=Array.isArray(b.budget_lines)?b.budget_lines.filter(l=>l&&String(l.description||'').trim()):[];
  const budgetTotal=lines.reduce((sum,l)=>sum+(Number(l.total)||0),0);
  add('budget_lines','Budget lines',lines.length>=(rules.min_budget_lines||0));
  add('budget_total','Budget total',budgetTotal>=(rules.min_budget_total||0));
  const concept=b.concept_note;
  if(rules.require_concept_note){
    add('concept_note','Concept note attached',!!concept&&typeof concept==='object');
    if(concept&&Array.isArray(rules.concept_min_fields)){
      for(const field of rules.concept_min_fields){
        add(`concept_${field}`,`Concept note: ${field}`,!!String(concept[field]||'').trim());
      }
    }
  }
  return {ready:items.every(i=>i.ok),items,rules};
}

function buildApprovalRecordHtml(request,approver,approvedAmount,note,version){
  const esc=(s)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(request.request_number)} Approval</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;margin:32px;color:#0e2438;max-width:820px}h1{font-size:1.35rem}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #c9d6e0;padding:8px;text-align:left}th{background:#eef4fa}</style></head><body>
<h1>SRHR-RAMS — Chairman approval record</h1>
<p><strong>Reference:</strong> ${esc(request.request_number)}<br>
<strong>Title:</strong> ${esc(request.title)}<br>
<strong>Directorate / entity:</strong> ${esc(request.implementing_entity)}<br>
<strong>Requested amount:</strong> NLe ${esc(Number(request.amount_nle||0).toFixed(2))}<br>
<strong>Approved amount:</strong> NLe ${esc(Number(approvedAmount).toFixed(2))}<br>
<strong>Approver:</strong> ${esc(approver)}<br>
<strong>Decision time (UTC):</strong> ${esc(new Date().toISOString())}<br>
<strong>Request version:</strong> ${esc(version)}</p>
${note?`<p><strong>Comments / reason:</strong> ${esc(note)}</p>`:''}
<p class="small">This record was generated by SRHR-RAMS and should be read together with the submitted request, budget, and concept note archived with the same reference.</p>
</body></html>`;
}

async function storeApprovalRecord(env,u,request,approvedAmount,note){
  if(!await archiveReady(env))return;
  const html=buildApprovalRecordHtml(request,u.name,approvedAmount,note,Number(request.version||1));
  const documentId=crypto.randomUUID();
  const fileName=`${request.request_number}-approval.html`;
  const now=new Date().toISOString();
  const versionRow=await env.DB.prepare('SELECT COALESCE(MAX(version),0) AS v FROM documents WHERE request_id=? AND category=?').bind(request.id,'approval').first();
  const version=Number(versionRow?.v||0)+1;
  if(env.DOCUMENTS){
    const storageKey=`requests/${request.id}/${documentId}`;
    const bytes=new TextEncoder().encode(html);
    const checksum=await sha256Hex(bytes);
    await env.DOCUMENTS.put(storageKey,bytes,{httpMetadata:{contentType:'text/html;charset=utf-8'}});
    await env.DB.prepare('INSERT INTO documents(id,request_id,kind,file_name,storage_key,mime_type,uploaded_by,created_at,category,version,checksum_sha256,size_bytes,inline_body) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(documentId,request.id,'approval',fileName,storageKey,'text/html',u.id,now,'approval',version,checksum,bytes.length,null).run();
  }else if(await documentsInlineReady(env)){
    await env.DB.prepare('INSERT INTO documents(id,request_id,kind,file_name,storage_key,mime_type,uploaded_by,created_at,category,version,checksum_sha256,size_bytes,inline_body) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(documentId,request.id,'approval',fileName,null,'text/html',u.id,now,'approval',version,null,html.length,html).run();
  }
  await audit(env,u,'APPROVAL_RECORD_STORED',request.id,fileName);
}

async function updateExistingRequest(env,u,request,b){
  if(!allowed(u,['Directorate User','Administrator'])){
    return {error:'forbidden',status:403};
  }
  if(u.role==='Directorate User'&&!ownsRequest(request,u)){
    return {error:'forbidden',message:'Only the officer who created this request can edit it.',status:403};
  }
  const editable=(request.status==='Draft'&&request.current_stage==='Directorate')||(request.status==='Query Raised'&&request.current_stage==='Directorate');
  if(!editable){
    return {error:'not_editable',message:'Only a draft or a request returned to the Directorate can be edited.',status:409};
  }
  const amountNle=b.amount_nle==null?Number(request.amount_nle||0):Number(b.amount_nle);
  if(!Number.isFinite(amountNle)||amountNle<0){
    return {error:'invalid_amount',status:400};
  }
  const now=new Date().toISOString();
  const rate=await currentUsdRate(env);
  const amountUsd=rate?Math.round((amountNle/rate)*100)/100:Number(request.amount_usd||0);
  await env.DB.prepare(`UPDATE requests SET title=?,request_type=?,implementing_entity=?,details=?,objective=?,activity_code=?,amount_nle=?,amount_usd=?,location=?,target_output=?,deliverable=?,timeline=?,procurement_method=?,estimated_completion=?,funding_source=?,fiscal_year=?,comments=?,updated_at=? WHERE id=?`).bind(
    String(b.title||request.title).trim(),
    b.request_type==='Procurement'?'Procurement':'Operational',
    String(b.implementing_entity||request.implementing_entity).trim(),
    b.details??request.details??'',
    b.objective??request.objective??'',
    b.activity_code??request.activity_code??'',
    amountNle,
    amountUsd,
    b.location??request.location??'',
    b.target_output??request.target_output??'',
    b.deliverable??request.deliverable??'',
    b.timeline??request.timeline??'',
    b.procurement_method??request.procurement_method??'',
    b.estimated_completion??request.estimated_completion??'',
    b.funding_source??request.funding_source??'',
    b.fiscal_year??request.fiscal_year??'',
    b.comments??request.comments??'',
    now,
    request.id
  ).run();
  if(Array.isArray(b.budget_lines)){
    await replaceBudgetLines(env,request.id,b.budget_lines,now);
  }
  if(b.concept_note){
    await replaceConceptNote(env,request.id,b.concept_note,now);
  }
  if(await archiveReady(env)){
    await env.DB.prepare('INSERT INTO request_events(id,request_id,actor_user_id,action,from_status,to_status,from_stage,to_stage,note,request_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),request.id,u.id,'DRAFT_SAVED',request.status,request.status,request.current_stage,request.current_stage,'Draft updated',Number(request.version||1),now).run();
  }
  await audit(env,u,'REQUEST_DRAFT_UPDATED',request.id,request.request_number);
  const refreshed=await env.DB.prepare('SELECT * FROM requests WHERE id=?').bind(request.id).first();
  return {ok:true,request:refreshed};
}

async function persistNewRequest(env,u,b,id,now){
  const amountNle=Number(b.amount_nle||0);
  const explicitUsd=b.amount_usd==null||b.amount_usd===''?null:Number(b.amount_usd);
  if(!Number.isFinite(amountNle)||amountNle<0||(explicitUsd!=null&&(!Number.isFinite(explicitUsd)||explicitUsd<0))){
    return {error:'Amounts must be zero or a positive number.',status:400};
  }
  const ready=await archiveReady(env);
  const year=new Date().getUTCFullYear();
  const requestType=b.request_type==='Procurement'?'Procurement':'Operational';
  const status=b.status==='Draft'?'Draft':'Submitted';
  const stage=status==='Draft'?'Directorate':'Project Secretary';
  const num=ready?await allocateRequestNumber(env):`SRHR-${year}-${String(Date.now()).slice(-6)}`;
  const rate=ready?await currentUsdRate(env):null;
  const amountUsd=explicitUsd==null?(rate?Math.round((amountNle/rate)*100)/100:0):explicitUsd;
  const common=[id,num,b.title,requestType,b.implementing_entity,b.requesting_authority||u.name,b.details||'',b.objective||'',b.activity_code||'',amountNle,amountUsd,b.location||'',b.target_output||'',b.deliverable||'',b.timeline||'',b.procurement_method||'',b.estimated_completion||'',b.disbursement_year||String(year),status,stage,b.comments||'',u.id,now,now];
  if(ready){
    const extra=[b.funding_source||'',b.fiscal_year||String(year),null,rate,rate?now:null,'active',b.classification||null,b.retention_category||null,0,null,status==='Draft'?null:now,null,1];
    const values=[...common,...extra];
    await env.DB.prepare(`INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,objective,activity_code,amount_nle,amount_usd,location,target_output,deliverable,timeline,procurement_method,estimated_completion,disbursement_year,status,current_stage,comments,created_by,created_at,updated_at,funding_source,fiscal_year,approved_amount_nle,rate_snapshot,rate_snapshot_at,archival_status,classification,retention_category,legal_hold,closed_at,submitted_at,approved_at,version) VALUES(${values.map(()=>'?').join(',')})`).bind(...values).run();
    await env.DB.prepare('INSERT INTO request_events(id,request_id,actor_user_id,action,from_status,to_status,from_stage,to_stage,note,request_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,u.id,status==='Draft'?'DRAFT_SAVED':'SUBMITTED',null,status,null,stage,b.comments||'',1,now).run();
  }else{
    await env.DB.prepare(`INSERT INTO requests(id,request_number,title,request_type,implementing_entity,requesting_authority,details,objective,activity_code,amount_nle,amount_usd,location,target_output,deliverable,timeline,procurement_method,estimated_completion,disbursement_year,status,current_stage,comments,created_by,created_at,updated_at) VALUES(${common.map(()=>'?').join(',')})`).bind(...common).run();
  }
  await saveBudgetAndConcept(env,id,b,now);
  return {num,status,stage};
}

async function visibleRequest(env,u,idOrNumber){
  const scope=archiveScope(u);
  return env.DB.prepare(`SELECT * FROM requests WHERE (id=? OR request_number=?) AND ${scope.sql}`).bind(idOrNumber,idOrNumber,...scope.args).first();
}

function csvCell(value){return `"${String(value??'').replaceAll('"','""')}"`}

async function handleArchive(req,env,u,p,url){
  const archiveList=p==='/api/archive';
  const archiveExport=p==='/api/archive/export';
  const archiveDetail=p.match(/^\/api\/archive\/([^/]+)$/);
  const documentPost=p.match(/^\/api\/requests\/([^/]+)\/documents$/);
  const documentGet=p.match(/^\/api\/documents\/([^/]+)$/);
  if(!archiveList&&!archiveExport&&!archiveDetail&&!documentPost&&!documentGet)return null;
  if(!await archiveReady(env)){
    return J({error:'migration_required',message:'Apply migrations/001_archive.sql before using the archive.'},503);
  }
  if((archiveList||archiveExport||archiveDetail||documentGet)&&req.method!=='GET')return J({error:'method_not_allowed'},405);
  if(documentPost&&req.method!=='POST')return J({error:'method_not_allowed'},405);

  if(archiveList||archiveExport){
    const filters=archiveWhere(url,u);
    if(filters.error)return J({error:filters.error},400);
    const sort=ARCHIVE_SORTS[url.searchParams.get('sort')]||'created_at';
    const dir=url.searchParams.get('dir')==='asc'?'ASC':'DESC';
    const totalRow=await env.DB.prepare(`SELECT COUNT(*) AS n FROM requests WHERE ${filters.where}`).bind(...filters.args).first();
    const total=Number(totalRow?.n||0);
    if(archiveExport){
      const rows=await env.DB.prepare(`SELECT request_number,title,request_type,implementing_entity,requesting_authority,fiscal_year,funding_source,status,current_stage,archival_status,amount_nle,approved_amount_nle,rate_snapshot,created_at,submitted_at,approved_at FROM requests WHERE ${filters.where} ORDER BY ${sort} ${dir} LIMIT 5000`).bind(...filters.args).all();
      const header=['request_number','title','request_type','implementing_entity','requesting_authority','fiscal_year','funding_source','status','current_stage','archival_status','amount_nle','approved_amount_nle','rate_snapshot','created_at','submitted_at','approved_at'];
      const csv=[header.join(','),...rows.results.map(row=>header.map(key=>csvCell(row[key])).join(','))].join('\n');
      return new Response(csv,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="srhr-archive.csv"','cache-control':'no-store','x-total-count':String(total)}});
    }
    let page=Number(url.searchParams.get('page')||1);
    let pageSize=Number(url.searchParams.get('page_size')||25);
    if(!Number.isInteger(page)||page<1)page=1;
    if(page>10000)page=10000;
    if(!Number.isInteger(pageSize)||pageSize<1)pageSize=25;
    if(pageSize>100)pageSize=100;
    const records=await env.DB.prepare(`SELECT id,request_number,title,request_type,implementing_entity,requesting_authority,activity_code,amount_nle,approved_amount_nle,status,current_stage,fiscal_year,funding_source,archival_status,created_at,submitted_at,approved_at,updated_at FROM requests WHERE ${filters.where} ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`).bind(...filters.args,pageSize,(page-1)*pageSize).all();
    return J({records:records.results,total,page,page_size:pageSize});
  }

  if(archiveDetail){
    const request=await visibleRequest(env,u,decodeURIComponent(archiveDetail[1]));
    if(!request)return J({error:'not_found'},404);
    const queries=[
      env.DB.prepare('SELECT id,description,quantity,unit_cost,total FROM budget_lines WHERE request_id=? ORDER BY id').bind(request.id).all(),
      env.DB.prepare('SELECT * FROM concept_notes WHERE request_id=?').bind(request.id).first(),
      env.DB.prepare('SELECT id,request_id,kind,category,file_name,mime_type,size_bytes,checksum_sha256,version,uploaded_by,created_at,superseded_at FROM documents WHERE request_id=? ORDER BY created_at').bind(request.id).all(),
      env.DB.prepare('SELECT id,reference_number,amount,verification_status,comments,created_at,verified_at FROM receipts WHERE request_id=? ORDER BY created_at').bind(request.id).all(),
      env.DB.prepare('SELECT e.id,e.action,e.from_status,e.to_status,e.from_stage,e.to_stage,e.note,e.request_version,e.created_at,u.name AS actor_name FROM request_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.request_id=? ORDER BY e.created_at').bind(request.id).all(),
      env.DB.prepare('SELECT a.id,a.action,a.details,a.created_at,u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.request_id=? ORDER BY a.created_at').bind(request.id).all()
    ];
    if(await financeReady(env)){
      queries.push(env.DB.prepare(`SELECT d.id,d.reference_number,d.amount_nle,d.rate_snapshot,d.created_at,u.name AS recorded_by FROM disbursements d LEFT JOIN users u ON u.id=d.recorded_by WHERE d.request_id=? AND d.voided_at IS NULL ORDER BY d.created_at`).bind(request.id).all());
    }
    const results=await Promise.all(queries);
    const [budget,concept,documents,receipts,events,auditRows,disbursements]=results;
    const financials=await requestFinancials(env,request);
    return J({
      request,
      budget_lines:budget.results,
      concept_note:concept,
      documents:documents.results,
      receipts:receipts.results,
      disbursements:disbursements?.results||[],
      financials,
      events:events.results,
      audit:auditRows.results
    });
  }

  if(documentGet){
    const scope=archiveScope(u);
    const inlineSelect=await documentsInlineReady(env)?',d.inline_body':'';
    const doc=await env.DB.prepare(`SELECT d.id,d.file_name,d.mime_type,d.storage_key,d.request_id${inlineSelect} FROM documents d JOIN requests r ON r.id=d.request_id WHERE d.id=? AND ${scope.sql}`).bind(documentGet[1],...scope.args).first();
    if(!doc)return J({error:'not_found'},404);
    if(doc.inline_body){
      const preview=url.searchParams.get('preview')==='1';
      return new Response(doc.inline_body,{headers:{'content-type':doc.mime_type||'text/html;charset=utf-8','content-disposition':`${preview?'inline':'attachment'}; filename="${safeFileName(doc.file_name).replaceAll('"','')}"`,'x-content-type-options':'nosniff','cache-control':'no-store'}});
    }
    if(!env.DOCUMENTS)return J({error:'storage_unconfigured',message:'Document storage is not configured. Add a private R2 binding named DOCUMENTS.'},503);
    const object=await env.DOCUMENTS.get(doc.storage_key);
    if(!object)return J({error:'storage_missing',message:'The document metadata exists, but the stored file could not be read.'},502);
    return new Response(object.body||object,{headers:{'content-type':doc.mime_type||'application/octet-stream','content-disposition':`attachment; filename="${safeFileName(doc.file_name).replaceAll('"','')}"`,'x-content-type-options':'nosniff','cache-control':'no-store'}});
  }

  const request=await visibleRequest(env,u,decodeURIComponent(documentPost[1]));
  if(!request)return J({error:'not_found'},404);
  if(!env.DOCUMENTS)return J({error:'storage_unconfigured',message:'Document storage is not configured. Add a private R2 binding named DOCUMENTS.'},503);
  const form=await req.formData().catch(()=>null);
  const file=form?.get('file');
  const category=String(form?.get('category')||'');
  if(!DOCUMENT_CATEGORIES.has(category))return J({error:'invalid_category'},400);
  if(!file||typeof file==='string'||!file.arrayBuffer)return J({error:'file_required'},400);
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!bytes.length)return J({error:'empty_file'},400);
  if(bytes.length>MAX_DOCUMENT_BYTES)return J({error:'file_too_large',message:'Documents must be 10 MB or smaller.'},413);
  const fileName=safeFileName(file.name);
  const ext=(fileName.split('.').pop()||'').toLowerCase();
  const type=DOCUMENT_TYPES[ext];
  if(!type||!matchesMagic(bytes,type.magic))return J({error:'file_type_rejected',message:'The file type is not allowed or does not match its contents.'},400);
  if(type.office&&!new TextDecoder('latin1').decode(bytes.subarray(0,Math.min(bytes.length,8000))).includes(type.office)){
    return J({error:'file_type_rejected',message:'The file type is not allowed or does not match its contents.'},400);
  }
  const checksum=await sha256Hex(bytes);
  const duplicate=await env.DB.prepare('SELECT id FROM documents WHERE request_id=? AND checksum_sha256=? AND superseded_at IS NULL').bind(request.id,checksum).first();
  if(duplicate)return J({error:'duplicate_document',existing_id:duplicate.id},409);
  const versionRow=await env.DB.prepare('SELECT COALESCE(MAX(version),0) AS v FROM documents WHERE request_id=? AND category=?').bind(request.id,category).first();
  const version=Number(versionRow?.v||0)+1;
  const replaces=String(form.get('replaces')||'');
  let replaced=null;
  if(replaces){
    replaced=await env.DB.prepare('SELECT id FROM documents WHERE id=? AND request_id=? AND superseded_at IS NULL').bind(replaces,request.id).first();
    if(!replaced)return J({error:'version_not_found'},404);
  }
  const storageKey=`requests/${request.id}/${crypto.randomUUID()}`;
  const documentId=crypto.randomUUID();
  try{
    await env.DOCUMENTS.put(storageKey,bytes,{httpMetadata:{contentType:type.mime},customMetadata:{checksum,request_id:request.id}});
    await env.DB.prepare('INSERT INTO documents(id,request_id,kind,file_name,storage_key,mime_type,uploaded_by,created_at,category,version,checksum_sha256,size_bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(documentId,request.id,category,fileName,storageKey,type.mime,u.id,new Date().toISOString(),category,version,checksum,bytes.length).run();
    if(replaced){
      await env.DB.prepare('UPDATE documents SET superseded_at=?,superseded_by=? WHERE id=?').bind(new Date().toISOString(),documentId,replaced.id).run();
    }
  }catch{
    if(env.DOCUMENTS.delete)await env.DOCUMENTS.delete(storageKey).catch(()=>{});
    return J({error:'storage_failed',message:'The document could not be stored. No archive record was kept.'},502);
  }
  await audit(env,u,'DOCUMENT_UPLOADED',request.id,`${fileName}; ${category}; v${version}; ${checksum}`);
  return J({ok:true,id:documentId,version,checksum_sha256:checksum,file_name:fileName,mime_type:type.mime,size_bytes:bytes.length},201);
}

const FINANCE_STATUSES=new Set(['Payment Processing','Procurement Processing','Procurement Completed','Awaiting Receipts','Liquidation Review']);

function money2(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.round((n+Number.EPSILON)*100)/100:0;
}
async function financeReady(env){
  try{
    await env.DB.prepare('SELECT id FROM disbursements LIMIT 1').first();
    return true;
  }catch{return false}
}
async function approvedBudget(request){
  const explicit=request.approved_amount_nle;
  if(explicit!=null&&explicit!=='')return money2(explicit);
  return money2(request.amount_nle||0);
}
async function requestFinancials(env,request){
  const approved=await approvedBudget(request);
  const pendingRow=await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM receipts WHERE request_id=? AND IFNULL(verification_status,'Pending')='Pending'`).bind(request.id).first();
  const verifiedRow=await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM receipts WHERE request_id=? AND verification_status='Verified'`).bind(request.id).first();
  const pending=Number(pendingRow?.n||0);
  const verifiedReceipts=money2(verifiedRow?.total||0);
  let disbursed=0;
  if(await financeReady(env)){
    const disbRow=await env.DB.prepare(`SELECT COALESCE(SUM(amount_nle),0) AS total FROM disbursements WHERE request_id=? AND voided_at IS NULL`).bind(request.id).first();
    disbursed=money2(disbRow?.total||0);
  }
  const outstanding=money2(Math.max(0,approved-verifiedReceipts));
  const unspent=money2(Math.max(0,approved-disbursed));
  const balanced=approved<=0||(disbursed===approved&&verifiedReceipts===disbursed&&pending===0);
  return {
    approved,
    disbursed,
    verified_receipts:verifiedReceipts,
    pending_receipts:pending,
    outstanding,
    unspent,
    reported_expenditure:verifiedReceipts,
    balanced,
    definitions:{
      approved:'Chairman approved amount, or the requested amount if none was recorded.',
      disbursed:'Sum of disbursements that have not been voided.',
      verified_receipts:'Receipts marked Verified. Pending or rejected receipts are not counted.',
      outstanding:'Approved amount minus verified receipts (never below zero).',
      unspent:'Approved amount minus disbursements (never below zero).'
    }
  };
}
async function rateHistoryReady(env){
  try{
    await env.DB.prepare('SELECT id FROM usd_rate_history LIMIT 1').first();
    return true;
  }catch{return false}
}
async function recordUsdRate(env,u,rate,source){
  const setting={rate,updated_at:new Date().toISOString(),updated_by:u.name,source:source||'IHPAU desk'};
  await env.DB.prepare(
    `INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`
  ).bind('usd_nle_rate',JSON.stringify(setting),setting.updated_at).run();
  if(await rateHistoryReady(env)){
    await env.DB.prepare('INSERT INTO usd_rate_history(id,rate,effective_at,source,changed_by,changed_by_name,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),rate,setting.updated_at,setting.source,u.id,u.name,setting.updated_at).run();
  }
  await audit(env,u,'USD_RATE_UPDATED','',`1 USD = NLe ${rate}`);
  return setting;
}
async function closureChecklist(env,request){
  const items=[];
  const add=(key,label,ok,message)=>items.push({key,label,ok,message});
  add('legal_hold','Legal hold',Number(request.legal_hold)!==1,Number(request.legal_hold)===1?'A legal hold is in place.':'No legal hold.');
  const blocked=await assertCanCloseFinancially(env,request);
  add('financials','Financial reconciliation',!blocked,blocked?.message||'Disbursements and verified receipts match the approved amount.');
  let deliverableOk=true;
  let deliverableMessage='No deliverables are recorded.';
  try{
    const row=await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN status!='Verified' THEN 1 ELSE 0 END) AS open FROM deliverables WHERE request_id=?`).bind(request.id).first();
    if(Number(row?.n||0)>0){
      deliverableOk=Number(row.open||0)===0;
      deliverableMessage=deliverableOk?'All recorded deliverables are verified.':'A recorded deliverable is still pending.';
    }
  }catch{/* table optional */}
  add('deliverables','Deliverables',deliverableOk,deliverableMessage);
  return {ready:items.every(i=>i.ok),items,financials:await requestFinancials(env,request)};
}
async function assertCanCloseFinancially(env,request){
  const pending=await env.DB.prepare(`SELECT COUNT(*) AS n FROM receipts WHERE request_id=? AND IFNULL(verification_status,'Pending')!='Verified'`).bind(request.id).first();
  if(Number(pending?.n||0)>0){
    return {error:'liquidation_outstanding',message:'Pending receipts must be verified before this request can be closed.',status:409};
  }
  if(!await financeReady(env))return null;
  const finance=await requestFinancials(env,request);
  if(finance.approved<=0)return null;
  if(finance.disbursed<=0){
    return {error:'disbursement_required',message:'Record the disbursement before closing a funded request.',status:409};
  }
  if(finance.disbursed!==finance.approved){
    return {error:'disbursement_mismatch',message:`Disbursements total NLe ${finance.disbursed}, but the approved amount is NLe ${finance.approved}.`,status:409};
  }
  if(finance.verified_receipts!==finance.disbursed){
    return {error:'liquidation_mismatch',message:`Verified receipts total NLe ${finance.verified_receipts}, but disbursements total NLe ${finance.disbursed}.`,status:409};
  }
  return null;
}

const ARCHIVAL_STATUSES=new Set(['active','archived','restricted']);

async function retentionReady(env){
  try{
    await env.DB.prepare('SELECT category FROM retention_policies LIMIT 1').first();
    return true;
  }catch{return false}
}
async function resolveRetentionCategory(env,request){
  const existing=String(request.retention_category||'').trim();
  if(existing)return existing;
  if(request.request_type==='Procurement')return 'procurement';
  return 'operational';
}
async function computeRetentionUntil(env,category,fromIso){
  let row=await env.DB.prepare('SELECT retention_years FROM retention_policies WHERE category=?').bind(category).first();
  if(!row)row=await env.DB.prepare('SELECT retention_years FROM retention_policies WHERE category=?').bind('default').first();
  const years=Number(row?.retention_years||5);
  const d=new Date(fromIso);
  if(Number.isNaN(d.getTime()))return null;
  d.setUTCFullYear(d.getUTCFullYear()+years);
  return d.toISOString().slice(0,10);
}
async function applyRetentionSchedule(env,requestId,closedAt){
  if(!await retentionReady(env))return;
  const request=await env.DB.prepare('SELECT id,request_type,retention_category FROM requests WHERE id=?').bind(requestId).first();
  if(!request)return;
  const category=await resolveRetentionCategory(env,request);
  const until=await computeRetentionUntil(env,category,closedAt);
  await env.DB.prepare('UPDATE requests SET retention_category=COALESCE(retention_category,?),retention_until=? WHERE id=?').bind(category,until,requestId).run();
}

async function applyRecordControl(env,u,request,body){
  if(!await retentionReady(env)){
    return {error:'migration_required',message:'Apply migrations/004_retention.sql before changing record controls.',status:503};
  }
  const action=String(body.action||'').trim();
  const note=String(body.note||'').trim();
  if(!note)return {error:'reason_required',message:'A written reason is required for record control changes.',status:400};
  const now=new Date().toISOString();
  const sets=['updated_at=?'];
  const args=[now];
  let eventAction='';
  if(action==='legal_hold'){
    if(Number(request.legal_hold)===1)return {already:true,legal_hold:1};
    sets.push('legal_hold=?','legal_hold_reason=?','legal_hold_at=?','legal_hold_by=?');
    args.push(1,note,now,u.id);
    eventAction='LEGAL_HOLD';
  }else if(action==='release_legal_hold'){
    if(Number(request.legal_hold)!==1)return {error:'not_on_hold',message:'This record is not on a legal hold.',status:409};
    sets.push('legal_hold=?','legal_hold_reason=?','legal_hold_at=?','legal_hold_by=?');
    args.push(0,'',null,null);
    eventAction='LEGAL_HOLD_RELEASED';
  }else if(action==='update_record'){
    const archival=body.archival_status==null?null:String(body.archival_status).trim();
    const classification=body.classification==null?null:String(body.classification).trim();
    const retentionCategory=body.retention_category==null?null:String(body.retention_category).trim();
    if(archival&&!ARCHIVAL_STATUSES.has(archival))return {error:'invalid_archival_status',message:'Archival status must be active, archived, or restricted.',status:400};
    if(retentionCategory){
      const policy=await env.DB.prepare('SELECT category FROM retention_policies WHERE category=?').bind(retentionCategory).first();
      if(!policy)return {error:'invalid_retention_category',message:'Choose a retention category from the approved list.',status:400};
      sets.push('retention_category=?');args.push(retentionCategory);
      if(request.closed_at){
        const until=await computeRetentionUntil(env,retentionCategory,request.closed_at);
        sets.push('retention_until=?');args.push(until);
      }
    }
    if(classification!==null){sets.push('classification=?');args.push(classification||null)}
    if(archival){sets.push('archival_status=?');args.push(archival)}
    if(sets.length===1)return {error:'nothing_to_update',message:'Provide archival status, classification, or retention category to update.',status:400};
    eventAction='RECORD_METADATA';
  }else{
    return {error:'invalid_action',message:'Use legal_hold, release_legal_hold, or update_record.',status:400};
  }
  args.push(request.id);
  await env.DB.prepare(`UPDATE requests SET ${sets.join(',')} WHERE id=?`).bind(...args).run();
  if(await archiveReady(env)&&eventAction){
    await env.DB.prepare('INSERT INTO request_events(id,request_id,actor_user_id,action,from_status,to_status,from_stage,to_stage,note,request_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),request.id,u.id,eventAction,request.status,request.status,request.current_stage,request.current_stage,note,Number(request.version||1),now).run();
  }
  await audit(env,u,'RECORD_'+eventAction,request.id,note);
  const refreshed=await env.DB.prepare('SELECT legal_hold,legal_hold_reason,legal_hold_at,retention_category,retention_until,archival_status,classification FROM requests WHERE id=?').bind(request.id).first();
  return {ok:true,request:refreshed};
}

function reportScope(u){
  return archiveScope(u);
}
async function buildManagementReport(env,u,url){
  const scope=reportScope(u);
  const where=[scope.sql];
  const args=[...scope.args];
  const fiscal=url.searchParams.get('fiscal_year');
  if(fiscal){where.push('fiscal_year=?');args.push(fiscal)}
  const clause=where.join(' AND ');
  const summary=await env.DB.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='Closed' THEN 1 ELSE 0 END) AS closed,
      SUM(CASE WHEN status!='Closed' AND status!='Withdrawn' AND status!='Rejected' THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN legal_hold=1 THEN 1 ELSE 0 END) AS legal_holds,
      SUM(CASE WHEN retention_until IS NOT NULL AND retention_until<=date('now') AND IFNULL(archival_status,'active')='active' AND legal_hold=0 THEN 1 ELSE 0 END) AS retention_due,
      COALESCE(SUM(amount_nle),0) AS requested,
      COALESCE(SUM(approved_amount_nle),0) AS approved
    FROM requests WHERE ${clause}`).bind(...args).first();
  const byStatus=await env.DB.prepare(`
    SELECT status,COUNT(*) AS count,COALESCE(SUM(amount_nle),0) AS amount_nle
    FROM requests WHERE ${clause} GROUP BY status ORDER BY count DESC`).bind(...args).all();
  const byEntity=await env.DB.prepare(`
    SELECT implementing_entity,COUNT(*) AS count,COALESCE(SUM(amount_nle),0) AS requested,COALESCE(SUM(approved_amount_nle),0) AS approved
    FROM requests WHERE ${clause} GROUP BY implementing_entity ORDER BY count DESC LIMIT 50`).bind(...args).all();
  let retentionReview={results:[]};
  if(await retentionReady(env)){
    retentionReview=await env.DB.prepare(`
      SELECT request_number,title,implementing_entity,retention_category,retention_until,archival_status,legal_hold,closed_at
      FROM requests WHERE ${clause} AND retention_until IS NOT NULL AND retention_until<=date('now') AND IFNULL(archival_status,'active')='active' AND legal_hold=0
      ORDER BY retention_until LIMIT 100`).bind(...args).all();
  }
  return {
    generated_at:new Date().toISOString(),
    filters:{fiscal_year:fiscal||null},
    summary,
    by_status:byStatus.results,
    by_entity:byEntity.results,
    retention_review:retentionReview.results
  };
}
async function exportManagementCsv(env,u,url){
  const header=['request_number','title','implementing_entity','status','amount_nle','approved_amount_nle','fiscal_year','legal_hold','retention_until','archival_status'];
  const scope=reportScope(u);
  const where=[scope.sql];
  const args=[...scope.args];
  const fiscal=url.searchParams.get('fiscal_year');
  if(fiscal){where.push('fiscal_year=?');args.push(fiscal)}
  const rows=await env.DB.prepare(`SELECT request_number,title,implementing_entity,status,amount_nle,approved_amount_nle,fiscal_year,legal_hold,retention_until,archival_status FROM requests WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 5000`).bind(...args).all();
  const csv=[header.join(','),...rows.results.map(row=>header.map(key=>csvCell(row[key])).join(','))].join('\n');
  return new Response(csv,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="srhr-management-report.csv"','cache-control':'no-store'}});
}

async function runAuditIntegrity(env){
  const issues=[];
  if(!await archiveReady(env)){
    return {ok:true,issues:[],note:'Archive migration not applied; workflow integrity checks were skipped.'};
  }
  const closedMissing=await env.DB.prepare(`
    SELECT r.id,r.request_number FROM requests r
    WHERE r.status='Closed' AND NOT EXISTS(
      SELECT 1 FROM request_events e WHERE e.request_id=r.id AND e.action='CLOSE'
    ) LIMIT 50`).all();
  for(const row of closedMissing.results){
    issues.push({code:'missing_close_event',message:'Closed request has no CLOSE workflow event.',request_id:row.id,request_number:row.request_number});
  }
  const submittedMissing=await env.DB.prepare(`
    SELECT r.id,r.request_number FROM requests r
    WHERE r.submitted_at IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM request_events e WHERE e.request_id=r.id
    ) LIMIT 50`).all();
  for(const row of submittedMissing.results){
    issues.push({code:'missing_workflow_history',message:'Submitted request has no workflow events.',request_id:row.id,request_number:row.request_number});
  }
  if(await retentionReady(env)){
    const holdMissing=await env.DB.prepare(`
      SELECT r.id,r.request_number FROM requests r
      WHERE r.legal_hold=1 AND NOT EXISTS(
        SELECT 1 FROM audit_log a WHERE a.request_id=r.id AND a.action='RECORD_LEGAL_HOLD'
      ) LIMIT 50`).all();
    for(const row of holdMissing.results){
      issues.push({code:'hold_without_audit',message:'Legal hold is set but no RECORD_LEGAL_HOLD audit entry exists.',request_id:row.id,request_number:row.request_number});
    }
  }
  const orphanAudit=await env.DB.prepare(`
    SELECT a.id,a.request_id,a.action FROM audit_log a
    WHERE a.request_id IS NOT NULL AND a.request_id!='' AND NOT EXISTS(SELECT 1 FROM requests r WHERE r.id=a.request_id)
    LIMIT 50`).all();
  for(const row of orphanAudit.results){
    issues.push({code:'orphan_audit',message:'Audit entry references a request that no longer exists.',audit_id:row.id,request_id:row.request_id,action:row.action});
  }
  return {ok:issues.length===0,checked_at:new Date().toISOString(),issues};
}

function transitionRole(user,roles,note){
  if(roles.includes(user.role))return true;
  if(user.role==='Administrator')return note?true:'reason';
  return false;
}
function ownsRequest(request,user){
  return String(request.created_by)===String(user.id);
}

function resolveTransition(request,user,body){
  const action=String(body.action||'');
  const note=String(body.note||'').trim();
  const status=request.status;
  const stage=request.current_stage;
  const fail=(message,code)=> ({error:code===403?'forbidden':'invalid_transition',message,status:code});
  const role=(roles)=>{
    const allowed=transitionRole(user,roles,note);
    if(allowed==='reason')return fail('An administrator override requires a reason.',400);
    if(!allowed)return fail('Your role cannot take this action.',403);
    return null;
  };
  if(action==='submit'){
    const denied=role(['Directorate User']); if(denied)return denied;
    if(!ownsRequest(request,user)&&user.role!=='Administrator')return fail('Only the officer who created this request can submit it.',403);
    if(status==='Submitted'&&stage==='Project Secretary')return {already:true,status,stage};
    if(!(status==='Draft'||(status==='Query Raised'&&stage==='Directorate')))return fail('Only a draft or a returned request can be submitted.',409);
    return {status:'Submitted',stage:'Project Secretary',notify:'Project Secretary',bumpVersion:status==='Query Raised',event:status==='Query Raised'?'RESUBMIT':'SUBMIT'};
  }
  if(action==='withdraw'){
    const denied=role(['Directorate User']); if(denied)return denied;
    if(!ownsRequest(request,user)&&user.role!=='Administrator')return fail('Only the officer who created this request can withdraw it.',403);
    if(!note)return fail('A reason is required to withdraw a request.',400);
    if(!['Draft','Submitted','Query Raised'].includes(status))return fail('This request has moved too far to be withdrawn.',409);
    if(status==='Withdrawn')return {already:true,status,stage};
    return {status:'Withdrawn',stage:'Withdrawn',notify:'Project Secretary',event:'WITHDRAW'};
  }
  if(action==='clear'){
    const denied=role(['Project Secretary']); if(denied)return denied;
    if(status==='Awaiting Approval'&&stage==='Chairman')return {already:true,status,stage};
    if(!(status==='Submitted'&&stage==='Project Secretary'))return fail('Only a request at the Project Secretary can be cleared.',409);
    return {status:'Awaiting Approval',stage:'Chairman',notify:'Chairman',event:'CLEAR'};
  }
  if(action==='query'){
    const desk=stage==='Project Secretary'?['Project Secretary']:stage==='Chairman'?['Chairman']:stage==='IHPAU / Finance'?['IHPAU']:[];
    const denied=role(desk); if(denied)return denied;
    if(!note)return fail('A query requires a reason.',400);
    if(status==='Query Raised'&&stage==='Directorate')return {already:true,status,stage};
    const atDesk=(stage==='Project Secretary'&&status==='Submitted')||(stage==='Chairman'&&status==='Awaiting Approval')||(stage==='IHPAU / Finance'&&(status==='Approved'||FINANCE_STATUSES.has(status)));
    if(!atDesk)return fail('A query can only be raised from the desk currently holding the request.',409);
    return {status:'Query Raised',stage:'Directorate',notify:'Directorate User',event:'QUERY'};
  }
  if(action==='approve'){
    const denied=role(['Chairman']); if(denied)return denied;
    if(ownsRequest(request,user))return fail('You cannot approve a request you created.',403);
    if(status==='Approved'&&stage==='IHPAU / Finance')return {already:true,status,stage};
    if(!(status==='Awaiting Approval'&&stage==='Chairman'))return fail('Only a request awaiting the Chairman can be approved.',409);
    const approved=body.approved_amount_nle==null||body.approved_amount_nle===''?Number(request.amount_nle||0):Number(body.approved_amount_nle);
    if(!Number.isFinite(approved)||approved<0)return fail('The approved amount must be zero or a positive number.',400);
    return {status:'Approved',stage:'IHPAU / Finance',notify:'IHPAU',event:'APPROVE',approvedAmount:approved};
  }
  if(action==='reject'){
    const denied=role(['Chairman']); if(denied)return denied;
    if(!note)return fail('A rejection requires a reason.',400);
    if(status==='Rejected')return {already:true,status,stage};
    if(!(status==='Awaiting Approval'&&stage==='Chairman'))return fail('Only a request awaiting the Chairman can be rejected.',409);
    return {status:'Rejected',stage:'Rejected',notify:'Directorate User',event:'REJECT'};
  }
  if(action==='finance'){
    const denied=role(['IHPAU']); if(denied)return denied;
    const next=String(body.status||'');
    if(!FINANCE_STATUSES.has(next))return fail('Choose a finance status from the approved list.',400);
    if(!(stage==='IHPAU / Finance'&&(status==='Approved'||FINANCE_STATUSES.has(status))))return fail('Finance can update only a request that has reached IHPAU.',409);
    if(status===next)return {already:true,status,stage};
    return {status:next,stage:'IHPAU / Finance',notify:'Directorate User',event:'FINANCE'};
  }
  if(action==='verify_receipts'){
    const denied=role(['IHPAU']); if(denied)return denied;
    if(!note)return fail('Receipt verification requires a reason.',400);
    if(stage!=='IHPAU / Finance')return fail('Receipts can be verified only while IHPAU holds the request.',409);
    return {status,stage,notify:'Directorate User',event:'VERIFY_RECEIPTS',verifyReceipts:true};
  }
  if(action==='close'){
    const denied=role(['IHPAU']); if(denied)return denied;
    if(status==='Closed'&&stage==='Closed')return {already:true,status,stage};
    if(!(stage==='IHPAU / Finance'&&(status==='Approved'||FINANCE_STATUSES.has(status))))return fail('Only an IHPAU request that is still open can be closed.',409);
    if(Number(request.legal_hold)===1)return fail('This record is under a legal hold and cannot be closed.',409);
    return {status:'Closed',stage:'Closed',notify:'Directorate User',event:'CLOSE',close:true};
  }
  return fail('That action is not part of the workflow.',400);
}

async function applyTransition(env,u,request,body){
  const next=resolveTransition(request,u,body);
  if(next.error||next.already)return next;
  const permission={
    submit:'submit_requests',withdraw:'submit_requests',clear:'review_requests',query:'raise_query',
    approve:'approve_requests',reject:'approve_requests',finance:'disburse_funds',
    verify_receipts:'verify_receipts',close:'close_requests'
  }[body.action];
  if(permission&&!(await hasPermission(env,u,permission))){
    return {error:'forbidden',message:'Your account does not have permission for this action.',status:403};
  }
  if(body.action==='submit'&&!next.already){
    const readiness=await assessSubmissionReadiness(env,request);
    if(!readiness.ready){
      return {error:'submission_incomplete',message:'Complete all required items before submitting.',status:400,readiness};
    }
  }
  if(next.close){
    const checklist=await closureChecklist(env,request);
    if(!checklist.ready){
      const failed=checklist.items.find(item=>!item.ok);
      return {error:'closure_blocked',message:failed?.message||'Closure requirements are not met.',status:409,checklist};
    }
  }
  if(next.verifyReceipts){
    const pending=await env.DB.prepare(`SELECT COUNT(*) AS n FROM receipts WHERE request_id=? AND IFNULL(verification_status,'Pending')!='Verified'`).bind(request.id).first();
    if(Number(pending?.n||0)===0)return {error:'nothing_to_verify',message:'There are no pending receipts to verify.',status:400};
  }
  const now=new Date().toISOString();
  const reason=String(body.note||'').trim();
  const ready=await archiveReady(env);
  const sets=['status=?','current_stage=?','comments=?','updated_at=?'];
  const args=[next.status,next.stage,reason||request.comments||'',now];
  if(next.event==='APPROVE'){sets.push('approving_authority=?');args.push(u.name)}
  if(ready&&next.approvedAmount!=null){sets.push('approved_amount_nle=?','approved_at=?');args.push(next.approvedAmount,now)}
  if(ready&&(next.event==='SUBMIT'||next.event==='RESUBMIT')){sets.push('submitted_at=COALESCE(submitted_at,?)');args.push(now)}
  if(ready&&next.close){sets.push('closed_at=?');args.push(now)}
  if(ready&&next.bumpVersion)sets.push('version=COALESCE(version,1)+1');
  args.push(request.id);
  await env.DB.prepare(`UPDATE requests SET ${sets.join(',')} WHERE id=?`).bind(...args).run();
  if(next.verifyReceipts){
    await env.DB.prepare(`UPDATE receipts SET verification_status='Verified',verified_at=? WHERE request_id=? AND IFNULL(verification_status,'Pending')!='Verified'`).bind(now,request.id).run();
  }
  if(ready&&next.close){
    await applyRetentionSchedule(env,request.id,now);
  }
  if(ready){
    await env.DB.prepare('INSERT INTO request_events(id,request_id,actor_user_id,action,from_status,to_status,from_stage,to_stage,note,request_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),request.id,u.id,next.event,request.status,next.status,request.current_stage,next.stage,reason,Number(request.version||1)+(next.bumpVersion?1:0),now).run();
  }
  const approvedDetail=next.approvedAmount==null?'':`; approved_amount_nle ${next.approvedAmount}; version ${Number(request.version||1)}`;
  await audit(env,u,'REQUEST_'+next.event,request.id,`${request.status}/${request.current_stage} > ${next.status}/${next.stage}${approvedDetail}${reason?`; ${reason}`:''}`);
  await note(env,next.notify,request.request_number,next.status,reason||`${request.request_number}: ${next.status}`);
  if(ready&&next.event==='APPROVE'){
    const refreshed=await env.DB.prepare('SELECT * FROM requests WHERE id=?').bind(request.id).first();
    await storeApprovalRecord(env,u,refreshed,next.approvedAmount,reason);
  }
  return {ok:true,status:next.status,current_stage:next.stage,request_number:request.request_number};
}

function idempotencyKey(req,body){
  const raw=String(req.headers.get('Idempotency-Key')||body?.idempotency_key||'').trim();
  if(!raw)return {key:''};
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(raw))return {error:'invalid_idempotency_key',message:'Use 8 to 80 letters, numbers, hyphens or underscores for the idempotency key.'};
  return {key:raw};
}

async function idempotencyReady(env){
  try{
    await env.DB.prepare('SELECT key FROM idempotency_keys LIMIT 1').first();
    return true;
  }catch{return false}
}

async function reserveIdempotency(env,u,key,id,now){
  if(!await idempotencyReady(env)){
    return {error:'migration_required',message:'Apply migrations/002_workflow.sql before retrying a submission.',status:503};
  }
  try{
    await env.DB.prepare('INSERT INTO idempotency_keys(user_id,key,request_id,created_at) VALUES(?,?,?,?)').bind(u.id,key,id,now).run();
    return {reserved:true};
  }catch{
    const row=await env.DB.prepare('SELECT request_id FROM idempotency_keys WHERE user_id=? AND key=?').bind(u.id,key).first();
    const existing=row&&await env.DB.prepare('SELECT id,request_number,status FROM requests WHERE id=?').bind(row.request_id).first();
    if(!existing)return {error:'idempotency_pending',message:'This submission is already being saved. Wait a moment and use the same key again.',status:409};
    return {existing};
  }
}

async function releaseIdempotency(env,u,key,id){
  await env.DB.prepare('DELETE FROM idempotency_keys WHERE user_id=? AND key=? AND request_id=?').bind(u.id,key,id).run().catch(()=>{});
}



export default {

  async fetch(req,env){

    const url=new URL(req.url);
    const p=url.pathname;


    /* =========================
       HEALTH
       ========================= */

    if(p==='/api/health'){

      return J({
        ok:true,
        service:'SRHR-RAMS v12',
        database:!!env.DB
      });
    }

    /* =========================
       LOGIN
       ========================= */

    if(
      p==='/api/auth/login' &&
      req.method==='POST'
    ){

      const b=
        await req.json()
        .catch(()=>({}));


      const username=
        String(
          b.username||''
        ).trim();


      const password=
        String(
          b.password||''
        );


      const u=
        await env.DB.prepare(
          `
          SELECT *
          FROM users
          WHERE
            lower(username)=lower(?)
            AND active=1
          LIMIT 1
          `
        )
        .bind(username)
        .first();


      if(
        !u ||
        !await verify(
          password,
          u.password_hash
        )
      ){

        return J(
          {
            error:
              'invalid_credentials'
          },
          401
        );

      }


      const token=
        crypto.randomUUID()+
        crypto.randomUUID();


      const exp=
        new Date(
          Date.now()+
          8*3600e3
        ).toISOString();


      await env.DB.prepare(
        `
        INSERT INTO sessions(
          token_hash,
          user_id,
          expires_at
        )
        VALUES(?,?,?)
        `
      )
      .bind(
        await digest(token),
        u.id,
        exp
      )
      .run();


      await audit(
        env,
        u,
        'LOGIN'
      );


      return J(
        {

          user:{

            id:u.id,

            name:u.name,

            username:
              u.username,

            role:u.role,

            entity:u.entity,

            mustChange:
              !!u.must_change

          }

        },
        200,
        {

          'set-cookie':
            `srhr_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`

        }
      );

    }


    /* =========================
       LOGOUT
       ========================= */

    if(
      p==='/api/auth/logout' &&
      req.method==='POST'
    ){

      const t=
        ck(req).srhr_session;


      if(t){

        await env.DB.prepare(
          `
          DELETE FROM sessions
          WHERE token_hash=?
          `
        )
        .bind(
          await digest(t)
        )
        .run();

      }


      return J(
        {
          ok:true
        },
        200,
        {

          'set-cookie':
            'srhr_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'

        }
      );

    }



    /* =========================
       AUTHENTICATED USER
       ========================= */

    const u=
      await me(req,env);


    if(
      p.startsWith('/api/') &&
      !u
    ){

      return J(
        {
          error:'unauthorized'
        },
        401
      );

    }


    if(
      p==='/api/auth/me'
    ){

      return J({
        user:u
      });

    }


    // Shared finance rate. Existing system_settings table needs no migration.
    if(p==='/api/finance/usd-rate'){
      if(req.method==='GET'){
        const row=await env.DB.prepare(
          'SELECT value FROM system_settings WHERE key=?'
        ).bind('usd_nle_rate').first();
        return J(row ? JSON.parse(row.value) : {rate:null,updated_at:null,updated_by:null});
      }
      if(req.method==='PUT'){
        if(!allowed(u,['IHPAU','Administrator'])) return J({error:'forbidden'},403);
        const body=await req.json().catch(()=>null);
        const rate=body?.rate;
        if(typeof rate!=='number' || !Number.isFinite(rate) || rate<=0){
          return J({error:'Enter a positive NLe amount for 1 USD.'},400);
        }
        const setting=await recordUsdRate(env,u,rate,body?.source);
        return J(setting);
      }
      return J({error:'method_not_allowed'},405,{allow:'GET, PUT'});
    }

    if(p==='/api/finance/usd-rate/history'&&req.method==='GET'){
      if(!await rateHistoryReady(env))return J({history:[]});
      const {results}=await env.DB.prepare('SELECT id,rate,effective_at,source,changed_by_name,created_at FROM usd_rate_history ORDER BY effective_at DESC LIMIT 50').all();
      return J({history:results});
    }

    if(p==='/api/finance/receipts'&&req.method==='GET'){
      if(!['IHPAU','Administrator'].includes(u.role))return J({error:'forbidden'},403);
      const status=url.searchParams.get('status')||'Pending';
      const {results}=await env.DB.prepare(
        `SELECT r.id,r.request_id,r.reference_number,r.amount,r.verification_status,r.comments,r.created_at,q.request_number,q.title
         FROM receipts r JOIN requests q ON q.id=r.request_id
         WHERE r.verification_status=? AND q.current_stage='IHPAU / Finance'
         ORDER BY r.created_at ASC LIMIT 200`
      ).bind(status).all();
      return J({receipts:results});
    }

    /* =========================
       CHANGE PASSWORD
       ========================= */

    if(
      p==='/api/auth/password' &&
      req.method==='POST'
    ){

      const b=
        await req.json()
        .catch(()=>({}));


      if(
        String(
          b.password||''
        ).length<10
      ){

        return J(
          {
            error:
              'Password must be at least 10 characters.'
          },
          400
        );

      }


      const newHash=
        await hashPassword(
          b.password
        );


      await env.DB.prepare(
        `
        UPDATE users
        SET
          password_hash=?,
          must_change=0
        WHERE id=?
        `
      )
      .bind(
        newHash,
        u.id
      )
      .run();


      await env.DB.prepare(
        `
        DELETE FROM sessions
        WHERE user_id=?
        `
      )
      .bind(u.id)
      .run();


      await audit(
        env,
        u,
        'PASSWORD_CHANGED'
      );


      return J({
        ok:true
      });

    }


    /* =========================
       ENTITIES
       ========================= */

    if(
      p==='/api/entities' &&
      req.method==='GET'
    ){

      return J(
        (
          await env.DB.prepare(
            `
            SELECT *
            FROM entities
            WHERE active=1
            ORDER BY name
            `
          )
          .all()
        ).results
      );

    }


    /* =========================
       ROLE QUEUES (server-filtered)
       ========================= */

    if(p==='/api/queues'&&req.method==='GET'){
      const desk=String(url.searchParams.get('desk')||'').trim().toLowerCase();
      if(!QUEUE_DESKS.has(desk)){
        return J({error:'invalid_desk',message:'Use desk=secretary, chairman, ihpau, or directorate.'},400);
      }
      if(!queueAccess(u,desk)){
        return J({error:'forbidden',message:'You cannot view this desk queue.'},403);
      }
      const records=await fetchQueueRecords(env,u,desk);
      return J({desk,total:records.length,records});
    }


    /* =========================
       REQUEST LIST
       ========================= */

    if(
      p==='/api/requests' &&
      req.method==='GET'
    ){

      const scope=archiveScope(u);
      let q=`SELECT * FROM requests WHERE ${scope.sql} ORDER BY created_at DESC LIMIT 300`;
      let st=env.DB.prepare(q);
      if(scope.args.length)st=st.bind(...scope.args);


      return J(
        (
          await st.all()
        ).results
      );

    }


    /* =========================
       CREATE REQUEST
       ========================= */

    if(
      p==='/api/requests' &&
      req.method==='POST'
    ){

      if(
        !allowed(
          u,
          [
            'Directorate User',
            'Administrator'
          ]
        )
      ){

        return J(
          {
            error:'forbidden'
          },
          403
        );

      }


      const b=
        await req.json()
        .catch(()=>({}));


      if(
        !b.title ||
        !b.implementing_entity
      ){

        return J(
          {
            error:
              'Title and implementing entity are required.'
          },
          400
        );

      }

      if(b.status==='Submitted'){
        const rules=await submissionRequirements(env);
        if(rules.enforce_on_direct_submit){
          const readiness=await assessPayloadReadiness(env,b);
          if(!readiness.ready){
            return J({error:'submission_incomplete',message:'Complete all required items before submitting.',readiness},400);
          }
        }
      }


      const keyCheck=idempotencyKey(req,b);
      if(keyCheck.error)return J({error:keyCheck.error,message:keyCheck.message},400);
      const id=crypto.randomUUID();
      const now=new Date().toISOString();
      if(keyCheck.key){
        const reserved=await reserveIdempotency(env,u,keyCheck.key,id,now);
        if(reserved.existing){
          return J({ok:true,id:reserved.existing.id,request_number:reserved.existing.request_number,status:reserved.existing.status,idempotent:true});
        }
        if(reserved.error)return J({error:reserved.error,message:reserved.message},reserved.status||409);
      }
      let saved;
      try{
        saved=await persistNewRequest(env,u,b,id,now);
      }catch(error){
        if(keyCheck.key)await releaseIdempotency(env,u,keyCheck.key,id);
        throw error;
      }
      if(saved.error){
        if(keyCheck.key)await releaseIdempotency(env,u,keyCheck.key,id);
        return J({error:saved.error},saved.status);
      }

      await audit(
        env,
        u,
        saved.status==='Draft'?'REQUEST_DRAFT':'REQUEST_SUBMITTED',
        id,
        saved.num
      );

      if(saved.status!=='Draft'){
        await note(
          env,
          'Project Secretary',
          saved.num,
          'New request',
          `${saved.num} submitted by ${u.name}`
        );
      }

      return J(
        {
          ok:true,
          id,
          request_number:saved.num,
          status:saved.status
        },
        201
      );

    }


    const readinessRoute=p.match(/^\/api\/requests\/([^/]+)\/readiness$/);
    if(readinessRoute&&req.method==='GET'){
      const request=await visibleRequest(env,u,decodeURIComponent(readinessRoute[1]));
      if(!request)return J({error:'not_found'},404);
      return J(await assessSubmissionReadiness(env,request));
    }

    const approvalRecordRoute=p.match(/^\/api\/requests\/([^/]+)\/approval-record$/);
    if(approvalRecordRoute&&req.method==='GET'){
      const request=await visibleRequest(env,u,decodeURIComponent(approvalRecordRoute[1]));
      if(!request)return J({error:'not_found'},404);
      if(!request.approved_at&&!request.approved_amount_nle){
        return J({error:'not_approved',message:'This request has not been approved yet.'},409);
      }
      const doc=await env.DB.prepare(`SELECT id FROM documents WHERE request_id=? AND category='approval' AND superseded_at IS NULL ORDER BY version DESC LIMIT 1`).bind(request.id).first();
      if(doc){
        return J({document_id:doc.id,download_path:`/api/documents/${doc.id}`,preview_path:`/api/documents/${doc.id}?preview=1`});
      }
      const html=buildApprovalRecordHtml(request,request.approving_authority||'Chairman',request.approved_amount_nle??request.amount_nle,'',Number(request.version||1));
      return new Response(html,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}});
    }

    const requestPatch=p.match(/^\/api\/requests\/([^/]+)$/);
    if(requestPatch&&req.method==='PATCH'){
      const request=await visibleRequest(env,u,decodeURIComponent(requestPatch[1]));
      if(!request)return J({error:'not_found'},404);
      const b=await req.json().catch(()=>({}));
      const result=await updateExistingRequest(env,u,request,b);
      if(result.error)return J({error:result.error,message:result.message||result.error},result.status||400);
      return J(result);
    }

    if(p==='/api/register'&&req.method==='GET'){
      if(!allowed(u,['Project Secretary','IHPAU','Chairman','Administrator'])){
        return J({error:'forbidden'},403);
      }
      const scope=archiveScope(u);
      let st=env.DB.prepare(
        `SELECT request_number,title,implementing_entity,requesting_authority,approving_authority,request_type,details,activity_code,amount_nle,approved_amount_nle,status,current_stage,submitted_at,approved_at
         FROM requests WHERE ${scope.sql} AND status!='Draft'
         ORDER BY COALESCE(submitted_at,created_at) DESC LIMIT 500`
      );
      if(scope.args.length)st=st.bind(...scope.args);
      return J({records:(await st.all()).results});
    }

    if(p==='/api/register/export'&&req.method==='GET'){
      if(!allowed(u,['Project Secretary','IHPAU','Chairman','Administrator'])){
        return J({error:'forbidden'},403);
      }
      const scope=archiveScope(u);
      let st=env.DB.prepare(
        `SELECT request_number,title,implementing_entity,requesting_authority,approving_authority,request_type,details,activity_code,amount_nle,status,current_stage,submitted_at
         FROM requests WHERE ${scope.sql} AND status!='Draft'
         ORDER BY COALESCE(submitted_at,created_at) DESC LIMIT 5000`
      );
      if(scope.args.length)st=st.bind(...scope.args);
      const rows=(await st.all()).results;
      const header=['request_number','title','implementing_entity','requesting_authority','approving_authority','request_type','activity_code','amount_nle','status','current_stage','submitted_at'];
      const csv=[header.join(','),...rows.map(row=>header.map(key=>csvCell(row[key])).join(','))].join('\n');
      return new Response(csv,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="srhr-register.csv"','cache-control':'no-store'}});
    }

    /* =========================
       REQUEST TRANSITIONS
       ========================= */

    const tm=
      p.match(
        /^\/api\/requests\/([^/]+)\/transition$/
      );


    if(tm && req.method==='POST'){
      const b=await req.json().catch(()=>({}));
      const r=await visibleRequest(env,u,decodeURIComponent(tm[1]));
      if(!r)return J({error:'not_found'},404);
      const result=await applyTransition(env,u,r,b);
      if(result.error)return J({error:result.error,message:result.message||result.error},result.status||400);
      return J(result);
    }

    const receiptPost=p.match(/^\/api\/requests\/([^/]+)\/receipts$/);
    if(receiptPost && req.method==='POST'){
      const request=await visibleRequest(env,u,decodeURIComponent(receiptPost[1]));
      if(!request)return J({error:'not_found'},404);
      if(!['IHPAU','Administrator'].includes(u.role))return J({error:'forbidden'},403);
      if(request.current_stage!=='IHPAU / Finance')return J({error:'invalid_transition',message:'Receipts can be recorded only while IHPAU holds the request.'},409);
      const b=await req.json().catch(()=>({}));
      const amount=money2(b.amount);
      const reference=String(b.reference_number||'').trim();
      if(!reference||!Number.isFinite(Number(b.amount))||amount<0)return J({error:'A receipt reference and a zero-or-positive amount are required.'},400);
      const id=crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO receipts(id,request_id,reference_number,amount,submitted_by,verification_status,comments,created_at) VALUES(?,?,?,?,?,'Pending',?,?)`).bind(id,request.id,reference,amount,u.id,String(b.comments||''),new Date().toISOString()).run();
      await audit(env,u,'RECEIPT_RECORDED',request.id,`${reference}; ${amount}`);
      return J({ok:true,id,verification_status:'Pending'},201);
    }

    const disbursementPost=p.match(/^\/api\/requests\/([^/]+)\/disbursements$/);
    if(disbursementPost && req.method==='POST'){
      if(!await financeReady(env)){
        return J({error:'migration_required',message:'Apply migrations/003_finance.sql before recording disbursements.'},503);
      }
      const request=await visibleRequest(env,u,decodeURIComponent(disbursementPost[1]));
      if(!request)return J({error:'not_found'},404);
      if(!['IHPAU','Administrator'].includes(u.role))return J({error:'forbidden'},403);
      if(request.current_stage!=='IHPAU / Finance')return J({error:'invalid_transition',message:'Disbursements can be recorded only while IHPAU holds the request.'},409);
      if(!(request.status==='Approved'||FINANCE_STATUSES.has(request.status))){
        return J({error:'invalid_transition',message:'Disbursements can be recorded only after approval.'},409);
      }
      const b=await req.json().catch(()=>({}));
      const amount=money2(b.amount_nle??b.amount);
      const reference=String(b.reference_number||'').trim();
      if(!reference||!Number.isFinite(Number(b.amount_nle??b.amount))||amount<=0){
        return J({error:'A disbursement reference and a positive amount are required.'},400);
      }
      const approved=await approvedBudget(request);
      const finance=await requestFinancials(env,request);
      if(finance.disbursed+amount>approved+0.001){
        return J({error:'disbursement_exceeds_approved',message:`This disbursement would exceed the approved amount of NLe ${approved}.`},409);
      }
      const duplicate=await env.DB.prepare(`SELECT id FROM disbursements WHERE request_id=? AND reference_number=? AND voided_at IS NULL`).bind(request.id,reference).first();
      if(duplicate)return J({error:'duplicate_disbursement',message:'That disbursement reference is already recorded for this request.'},409);
      const payKey=String(b.idempotency_key||'').trim();
      if(payKey){
        try{
          const existing=await env.DB.prepare('SELECT disbursement_id FROM disbursement_keys WHERE user_id=? AND key=?').bind(u.id,payKey).first();
          if(existing){
            const prior=await env.DB.prepare('SELECT id,reference_number,amount_nle,rate_snapshot FROM disbursements WHERE id=?').bind(existing.disbursement_id).first();
            if(prior)return J({ok:true,id:prior.id,reference_number:prior.reference_number,amount_nle:prior.amount_nle,rate_snapshot:prior.rate_snapshot,idempotent:true,financials:await requestFinancials(env,request)});
          }
        }catch{/* keys table optional */}
      }
      const now=new Date().toISOString();
      const rate=request.rate_snapshot??await currentUsdRate(env);
      const id=crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO disbursements(id,request_id,reference_number,amount_nle,rate_snapshot,rate_snapshot_at,recorded_by,comments,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,request.id,reference,amount,rate,rate?now:null,u.id,String(b.comments||''),now).run();
      if(payKey){
        await env.DB.prepare('INSERT INTO disbursement_keys(user_id,key,disbursement_id,created_at) VALUES(?,?,?,?)').bind(u.id,payKey,id,now).run().catch(()=>{});
      }
      await audit(env,u,'DISBURSEMENT_RECORDED',request.id,`${reference}; NLe ${amount}; rate ${rate??'n/a'}`);
      const updated=await requestFinancials(env,request);
      return J({ok:true,id,reference_number:reference,amount_nle:amount,rate_snapshot:rate,financials:updated},201);
    }

    const receiptDecision=p.match(/^\/api\/receipts\/([^/]+)\/decision$/);
    if(receiptDecision&&req.method==='POST'){
      if(!['IHPAU','Administrator'].includes(u.role))return J({error:'forbidden'},403);
      const receipt=await env.DB.prepare('SELECT * FROM receipts WHERE id=?').bind(decodeURIComponent(receiptDecision[1])).first();
      if(!receipt)return J({error:'not_found'},404);
      const request=await visibleRequest(env,u,receipt.request_id);
      if(!request)return J({error:'not_found'},404);
      const b=await req.json().catch(()=>({}));
      const decision=b.decision==='Verified'?'Verified':b.decision==='Rejected'?'Rejected':'';
      if(!decision)return J({error:'invalid_decision',message:'Use decision Verified or Rejected.'},400);
      const note=String(b.note||'').trim();
      if(decision==='Rejected'&&!note)return J({error:'reason_required',message:'A reason is required to reject a receipt.'},400);
      const now=new Date().toISOString();
      await env.DB.prepare('UPDATE receipts SET verification_status=?,comments=?,verified_at=? WHERE id=?').bind(decision,note||receipt.comments||'',decision==='Verified'?now:null,receipt.id).run();
      await audit(env,u,decision==='Verified'?'RECEIPT_VERIFIED':'RECEIPT_REJECTED',request.id,`${receipt.reference_number}; ${note}`);
      return J({ok:true,id:receipt.id,verification_status:decision,financials:await requestFinancials(env,request)});
    }

    const disbursementVoid=p.match(/^\/api\/requests\/([^/]+)\/disbursements\/([^/]+)\/void$/);
    if(disbursementVoid&&req.method==='POST'){
      if(!['IHPAU','Administrator'].includes(u.role))return J({error:'forbidden'},403);
      const request=await visibleRequest(env,u,decodeURIComponent(disbursementVoid[1]));
      if(!request)return J({error:'not_found'},404);
      const b=await req.json().catch(()=>({}));
      const reason=String(b.reason||'').trim();
      if(!reason)return J({error:'reason_required',message:'A reason is required to void a disbursement.'},400);
      const row=await env.DB.prepare('SELECT id,voided_at,reference_number,amount_nle FROM disbursements WHERE id=? AND request_id=?').bind(decodeURIComponent(disbursementVoid[2]),request.id).first();
      if(!row)return J({error:'not_found'},404);
      if(row.voided_at)return J({already:true,id:row.id});
      const now=new Date().toISOString();
      await env.DB.prepare('UPDATE disbursements SET voided_at=?,void_reason=? WHERE id=?').bind(now,reason,row.id).run();
      await audit(env,u,'DISBURSEMENT_VOIDED',request.id,`${row.reference_number}; NLe ${row.amount_nle}; ${reason}`);
      return J({ok:true,id:row.id,financials:await requestFinancials(env,request)});
    }

    const closureRoute=p.match(/^\/api\/requests\/([^/]+)\/closure-checklist$/);
    if(closureRoute&&req.method==='GET'){
      const request=await visibleRequest(env,u,decodeURIComponent(closureRoute[1]));
      if(!request)return J({error:'not_found'},404);
      return J(await closureChecklist(env,request));
    }

    const dossierRoute=p.match(/^\/api\/requests\/([^/]+)\/financial-dossier$/);
    if(dossierRoute&&req.method==='GET'){
      if(!['IHPAU','Administrator','Chairman','Project Secretary'].includes(u.role))return J({error:'forbidden'},403);
      const request=await visibleRequest(env,u,decodeURIComponent(dossierRoute[1]));
      if(!request)return J({error:'not_found'},404);
      const financials=await requestFinancials(env,request);
      const disbursements=await financeReady(env)?(await env.DB.prepare('SELECT reference_number,amount_nle,rate_snapshot,voided_at,void_reason,created_at FROM disbursements WHERE request_id=? ORDER BY created_at').bind(request.id).all()).results:[];
      const receipts=(await env.DB.prepare('SELECT reference_number,amount,verification_status,comments,created_at,verified_at FROM receipts WHERE request_id=? ORDER BY created_at').bind(request.id).all()).results;
      return J({
        request_number:request.request_number,
        title:request.title,
        status:request.status,
        rate_snapshot:request.rate_snapshot,
        financials,
        disbursements,
        receipts,
        generated_at:new Date().toISOString()
      });
    }


    /* =========================
       NOTIFICATIONS
       ========================= */

    if(
      p==='/api/notifications' &&
      req.method==='GET'
    ){

      const {results}=
        await env.DB.prepare(
          `
          SELECT *
          FROM notifications
          WHERE
            recipient_role=?
            OR recipient_user_id=?
          ORDER BY created_at DESC
          LIMIT 100
          `
        )
        .bind(
          u.role,
          u.id
        )
        .all();


      return J(results);

    }

    const notificationRead=p.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if(notificationRead&&req.method==='POST'){
      const id=decodeURIComponent(notificationRead[1]);
      const row=await env.DB.prepare('SELECT id,recipient_role,recipient_user_id FROM notifications WHERE id=?').bind(id).first();
      if(!row)return J({error:'not_found'},404);
      const mine=row.recipient_user_id!=null
        ?Number(row.recipient_user_id)===Number(u.id)
        :row.recipient_role===u.role;
      if(!mine&&u.role!=='Administrator')return J({error:'forbidden'},403);
      const now=new Date().toISOString();
      await env.DB.prepare('UPDATE notifications SET read_at=? WHERE id=? AND read_at IS NULL').bind(now,id).run();
      return J({ok:true,read_at:now});
    }

    if(p==='/api/notifications/read-all'&&req.method==='POST'){
      const now=new Date().toISOString();
      await env.DB.prepare(
        `UPDATE notifications SET read_at=?
         WHERE read_at IS NULL AND (recipient_user_id=? OR recipient_role=?)`
      ).bind(now,u.id,u.role).run();
      return J({ok:true,read_at:now});
    }


    /* =========================
       ADMIN USERS
       ========================= */

    if(
      p==='/api/admin/users' &&
      req.method==='GET'
    ){

      if(
        u.role!==
        'Administrator'
      ){

        return J(
          {
            error:'forbidden'
          },
          403
        );

      }


      return J(
        (
          await env.DB.prepare(
            `
            SELECT
              id,
              name,
              username,
              role,
              entity,
              active,
              must_change,
              created_at
            FROM users
            ORDER BY id
            `
          )
          .all()
        ).results
      );

    }


    if(
      p==='/api/admin/users' &&
      req.method==='POST'
    ){

      if(
        u.role!==
        'Administrator'
      ){

        return J(
          {
            error:'forbidden'
          },
          403
        );

      }


      const b=
        await req.json()
        .catch(()=>({}));


      if(
        !b.name ||
        !b.username ||
        !b.password ||
        !b.role
      ){

        return J(
          {
            error:
              'missing_fields'
          },
          400
        );

      }


      const passwordHash=
        await hashPassword(
          b.password
        );


      await env.DB.prepare(
        `
        INSERT INTO users(
          name,
          username,
          password_hash,
          role,
          entity,
          active,
          must_change
        )
        VALUES(
          ?,?,?,?,?,1,1
        )
        `
      )
      .bind(

        b.name,

        b.username,

        passwordHash,

        b.role,

        b.entity||''

      )
      .run();


      await audit(

        env,

        u,

        'USER_CREATED',

        '',

        b.username

      );


      return J(
        {
          ok:true
        },
        201
      );

    }



    /* =========================
       SUPREME ADMIN — USER CONTROL
       ========================= */

    const userCtl=p.match(/^\/api\/admin\/users\/([^/]+)$/);

    if(userCtl && req.method==='PATCH'){
      if(u.role!=='Administrator') return J({error:'forbidden'},403);

      const b=await req.json().catch(()=>({}));
      const target=await env.DB.prepare(
        `SELECT id,name,username,role,active FROM users WHERE id=?`
      ).bind(userCtl[1]).first();

      if(!target) return J({error:'not_found'},404);

      if(b.role){
        const roles=['Directorate User','Project Secretary','Chairman','IHPAU','Administrator'];
        if(!roles.includes(b.role)) return J({error:'invalid_role'},400);
        await env.DB.prepare(`UPDATE users SET role=? WHERE id=?`).bind(b.role,target.id).run();
      }

      if(typeof b.active==='boolean'){
        await env.DB.prepare(`UPDATE users SET active=? WHERE id=?`).bind(b.active?1:0,target.id).run();
        if(!b.active) await env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(target.id).run();
      }

      let temporaryPassword=null;
      if(b.reset_password===true){
        temporaryPassword='Reset@'+String(Math.floor(100000+Math.random()*900000));
        const ph=await hashPassword(temporaryPassword);
        await env.DB.prepare(
          `UPDATE users SET password_hash=?,must_change=1 WHERE id=?`
        ).bind(ph,target.id).run();
        await env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(target.id).run();
      }

      await audit(env,u,'ADMIN_USER_CONTROL',target.id,
        `${target.username}; role=${b.role||target.role}; active=${typeof b.active==='boolean'?b.active:target.active}; reset=${b.reset_password===true}`);

      return J({ok:true,temporary_password:temporaryPassword});
    }



    /* =========================
       ADMIN — RESET CORE CREDENTIALS
       ========================= */

    if(
      p==='/api/admin/reset-core-credentials' &&
      req.method==='POST'
    ){
      if(u.role!=='Administrator'){
        return J({error:'forbidden'},403);
      }

      const accounts=[
        ['directorate','Directorate User','directorate@123'],
        ['secretary','Project Secretary','secretary@123'],
        ['chairman','Chairman','chairman@123'],
        ['finance','IHPAU','finance@123'],
        ['admin','Administrator','admin@123']
      ];

      const updated=[];

      for(const [username,role,password] of accounts){
        const ph=await hashPassword(password);

        const result=await env.DB.prepare(
          `UPDATE users
           SET password_hash=?,
               role=?,
               active=1,
               must_change=0
           WHERE lower(username)=lower(?)`
        )
        .bind(ph,role,username)
        .run();

        await env.DB.prepare(
          `DELETE FROM sessions
           WHERE user_id IN (
             SELECT id FROM users
             WHERE lower(username)=lower(?)
           )`
        )
        .bind(username)
        .run();

        updated.push({
          username,
          role,
          changed:Number(result?.meta?.changes||0)
        });
      }

      await audit(
        env,
        u,
        'CORE_CREDENTIALS_RESET',
        '',
        'Reset five core accounts to approved default credentials.'
      );

      return J({
        ok:true,
        updated,
        credentials:{
          directorate:'directorate@123',
          secretary:'secretary@123',
          chairman:'chairman@123',
          finance:'finance@123',
          admin:'admin@123'
        }
      });
    }


    if(p==='/api/admin/retention-policies'&&req.method==='GET'){
      if(u.role!=='Administrator')return J({error:'forbidden'},403);
      if(!await retentionReady(env))return J({error:'migration_required',message:'Apply migrations/004_retention.sql first.'},503);
      const {results}=await env.DB.prepare('SELECT category,retention_years,description FROM retention_policies ORDER BY category').all();
      return J({policies:results});
    }

    const recordControl=p.match(/^\/api\/admin\/records\/([^/]+)\/control$/);
    if(recordControl&&req.method==='POST'){
      if(u.role!=='Administrator')return J({error:'forbidden'},403);
      const request=await visibleRequest(env,u,decodeURIComponent(recordControl[1]));
      if(!request)return J({error:'not_found'},404);
      const b=await req.json().catch(()=>({}));
      const result=await applyRecordControl(env,u,request,b);
      if(result.error)return J({error:result.error,message:result.message||result.error},result.status||400);
      return J(result);
    }

    if(p==='/api/reports/management/export'&&req.method==='GET'){
      if(!allowed(u,['Administrator','IHPAU','Chairman','Project Secretary']))return J({error:'forbidden'},403);
      return exportManagementCsv(env,u,url);
    }

    if(p==='/api/reports/management'&&req.method==='GET'){
      if(!allowed(u,['Administrator','IHPAU','Chairman','Project Secretary']))return J({error:'forbidden'},403);
      return J(await buildManagementReport(env,u,url));
    }

    if(p==='/api/admin/audit/integrity'&&req.method==='GET'){
      if(u.role!=='Administrator')return J({error:'forbidden'},403);
      return J(await runAuditIntegrity(env));
    }

    /* =========================
       ADMIN AUDIT
       ========================= */

    if(
      p==='/api/admin/audit' &&
      req.method==='GET'
    ){

      if(
        u.role!==
        'Administrator'
      ){

        return J(
          {
            error:'forbidden'
          },
          403
        );

      }


      return J(
        (
          await env.DB.prepare(
            `
            SELECT
              a.*,
              u.name actor
            FROM audit_log a
            LEFT JOIN users u
              ON u.id=a.actor_user_id
            ORDER BY a.created_at DESC
            LIMIT 300
            `
          )
          .all()
        ).results
      );

    }


    /* =========================
       DASHBOARD
       ========================= */

    if(
      p==='/api/dashboard' &&
      req.method==='GET'
    ){

      const scope=archiveScope(u);
      let dash=env.DB.prepare(
          `
          SELECT
            COUNT(*) total,
            SUM(CASE WHEN status='Approved' THEN 1 ELSE 0 END) approved,
            SUM(CASE WHEN status='Awaiting Approval' THEN 1 ELSE 0 END) awaiting_approval,
            SUM(CASE WHEN current_stage='IHPAU / Finance' AND status!='Closed' THEN 1 ELSE 0 END) at_ihpau,
            SUM(CASE WHEN status='Closed' THEN 1 ELSE 0 END) closed,
            COALESCE(SUM(amount_nle),0) requested
          FROM requests
          WHERE ${scope.sql}
          `
        );
      if(scope.args.length)dash=dash.bind(...scope.args);
      const row=await dash.first();
      let recent=env.DB.prepare(
        `SELECT request_number,request_type,title,amount_nle,status,current_stage FROM requests WHERE ${scope.sql} ORDER BY updated_at DESC LIMIT 5`
      );
      if(scope.args.length)recent=recent.bind(...scope.args);
      const recentRows=await recent.all();
      const queue_counts=await queueCountsForUser(env,u);
      const pending_action=
        u.role==='Project Secretary'?queue_counts.secretary:
        u.role==='Chairman'?queue_counts.chairman:
        u.role==='IHPAU'?queue_counts.ihpau:
        u.role==='Directorate User'?queue_counts.directorate_action:
        null;
      return J({...row,recent:recentRows.results,queue_counts,pending_action});

    }


    const archiveResponse=await handleArchive(req,env,u,p,url);
    if(archiveResponse)return archiveResponse;

    /* =========================
       STATIC FRONTEND
       ========================= */

    return env.ASSETS.fetch(req);

  }

};
