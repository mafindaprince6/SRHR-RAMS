import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;

// Shared storage with independent user sessions exercises the actual API handler.
export function fixture(){
  const state={setting:null,audits:[]};
  function env(role){
    return {DB:{prepare(sql){let args=[];return {
      bind(...values){args=values;return this;},
      async first(){
        if(sql.includes('FROM sessions')) return {id:1,name:role,role,active:1};
        if(sql.includes('FROM system_settings')) return state.setting ? {value:JSON.stringify(state.setting)} : null;
        throw Error('Unexpected SELECT');
      },
      async run(){
        if(sql.includes('INSERT INTO system_settings')) state.setting=JSON.parse(args[1]);
        else if(sql.includes('INSERT INTO audit_log')) state.audits.push(args);
        else throw Error('Unexpected write');
        return {success:true};
      }
    };}},ASSETS:{fetch(){return new Response('missing',{status:404});}}};
  }
  async function call(role,method='GET',body,authenticated=true){
    return worker.fetch(new Request('https://srhr.test/api/finance/usd-rate',{
      method,headers:authenticated ? {cookie:'srhr_session=test','content-type':'application/json'} : {},
      ...(body===undefined ? {} : {body:JSON.stringify(body)})
    }),env(role));
  }
  return {state,call,env,worker};
}

