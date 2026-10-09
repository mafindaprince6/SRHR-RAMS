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
        const setting={rate,updated_at:new Date().toISOString(),updated_by:u.name};
        await env.DB.prepare(
          `INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`
        ).bind('usd_nle_rate',JSON.stringify(setting),setting.updated_at).run();
        await audit(env,u,'USD_RATE_UPDATED','',`1 USD = NLe ${rate}`);
        return J(setting);
      }
      return J({error:'method_not_allowed'},405,{allow:'GET, PUT'});
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
       REQUEST LIST
       ========================= */

    if(
      p==='/api/requests' &&
      req.method==='GET'
    ){

      let q=
        'SELECT * FROM requests';

      let a=[];


      if(
        u.role===
        'Directorate User'
      ){

        q+=
          ' WHERE created_by=?';

        a=[u.id];

      }


      q+=
        ' ORDER BY created_at DESC LIMIT 300';


      let st=
        env.DB.prepare(q);


      if(a.length){

        st=
          st.bind(...a);

      }


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


      const id=
        crypto.randomUUID();


      const now=
        new Date()
        .toISOString();


      const seq=
        String(
          Date.now()
        ).slice(-6);


      const num=
        `SRHR-${new Date().getUTCFullYear()}-${seq}`;


      await env.DB.prepare(
        `
        INSERT INTO requests(
          id,
          request_number,
          title,
          request_type,
          implementing_entity,
          requesting_authority,
          details,
          objective,
          activity_code,
          amount_nle,
          amount_usd,
          location,
          target_output,
          deliverable,
          timeline,
          procurement_method,
          estimated_completion,
          disbursement_year,
          status,
          current_stage,
          comments,
          created_by,
          created_at,
          updated_at
        )
        VALUES(
          ?,?,?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,?,?
        )
        `
      )
      .bind(

        id,

        num,

        b.title,

        b.request_type||
          'Operational',

        b.implementing_entity,

        b.requesting_authority||
          u.name,

        b.details||'',

        b.objective||'',

        b.activity_code||'',

        Number(
          b.amount_nle||0
        ),

        Number(
          b.amount_usd||0
        ),

        b.location||'',

        b.target_output||'',

        b.deliverable||'',

        b.timeline||'',

        b.procurement_method||'',

        b.estimated_completion||'',

        b.disbursement_year||
          String(
            new Date()
            .getUTCFullYear()
          ),

        'Submitted',

        'Project Secretary',

        b.comments||'',

        u.id,

        now,

        now

      )
      .run();


      await audit(
        env,
        u,
        'REQUEST_SUBMITTED',
        id,
        num
      );


      await note(
        env,
        'Project Secretary',
        num,
        'New request',
        `${num} submitted by ${u.name}`
      );


      return J(
        {
          ok:true,
          id,
          request_number:num
        },
        201
      );

    }


    /* =========================
       REQUEST TRANSITIONS
       ========================= */

    const tm=
      p.match(
        /^\/api\/requests\/([^/]+)\/transition$/
      );


    if(
      tm &&
      req.method==='POST'
    ){

      const b=
        await req.json()
        .catch(()=>({}));


      const r=
        await env.DB.prepare(
          `
          SELECT *
          FROM requests
          WHERE
            id=?
            OR request_number=?
          `
        )
        .bind(
          tm[1],
          tm[1]
        )
        .first();


      if(!r){

        return J(
          {
            error:'not_found'
          },
          404
        );

      }


      const maps={

        clear:{

          roles:[
            'Project Secretary',
            'Administrator'
          ],

          status:
            'Awaiting Approval',

          stage:
            'Chairman',

          to:
            'Chairman'

        },


        approve:{

          roles:[
            'Chairman',
            'Administrator'
          ],

          status:
            'Approved',

          stage:
            'IHPAU / Finance',

          to:
            'IHPAU'

        },


        query:{

          roles:[
            'Project Secretary',
            'Chairman',
            'IHPAU',
            'Administrator'
          ],

          status:
            'Query Raised',

          stage:
            'Directorate',

          to:
            'Directorate User'

        },


        finance:{

          roles:[
            'IHPAU',
            'Administrator'
          ],

          status:
            b.status||
            'Payment Processing',

          stage:
            'IHPAU / Finance',

          to:
            'Directorate User'

        },


        close:{

          roles:[
            'IHPAU',
            'Administrator'
          ],

          status:
            'Closed',

          stage:
            'Closed',

          to:
            'Directorate User'

        }

      };


      const x=
        maps[b.action];


      if(
        !x ||
        !x.roles.includes(
          u.role
        )
      ){

        return J(
          {
            error:'forbidden'
          },
          403
        );

      }


      await env.DB.prepare(
        `
        UPDATE requests
        SET
          status=?,
          current_stage=?,
          comments=?,
          updated_at=?
        WHERE id=?
        `
      )
      .bind(

        x.status,

        x.stage,

        b.note||
          r.comments||
          '',

        new Date()
          .toISOString(),

        r.id

      )
      .run();


      await audit(

        env,

        u,

        'REQUEST_'+
          String(
            b.action
          ).toUpperCase(),

        r.id,

        b.note||''

      );


      await note(

        env,

        x.to,

        r.request_number,

        x.status,

        b.note||
          `${r.request_number}: ${x.status}`

      );


      return J({

        ok:true,

        status:
          x.status,

        current_stage:
          x.stage

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

      const row=
        await env.DB.prepare(
          `
          SELECT

            COUNT(*) total,

            SUM(
              CASE
                WHEN status='Approved'
                THEN 1
                ELSE 0
              END
            ) approved,

            SUM(
              CASE
                WHEN status='Closed'
                THEN 1
                ELSE 0
              END
            ) closed,

            COALESCE(
              SUM(amount_nle),
              0
            ) requested

          FROM requests
          `
        )
        .first();


      return J(row);

    }


    /* =========================
       STATIC FRONTEND
       ========================= */

    return env.ASSETS.fetch(req);

  }

};
