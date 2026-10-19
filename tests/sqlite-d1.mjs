import {DatabaseSync} from 'node:sqlite';
import {readdir, readFile} from 'node:fs/promises';

export async function tokenHash(token){
  const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export function openDatabase({migrate=true}={}){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  return {db, migrate};
}

export async function applySchema(db, migrate=true){
  const schema=await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  db.exec(schema);
  if(migrate){
    const dir=new URL('../migrations/', import.meta.url);
    const names=(await readdir(dir)).filter(name=>name.endsWith('.sql')).sort();
    for(const name of names)db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
}

export function asD1(db){
  return {prepare(sql){
    const stmt=db.prepare(sql);
    let args=[];
    const api={
      bind(...values){args=values;return api;},
      async first(){return (args.length?stmt.get(...args):stmt.get())??null;},
      async all(){return {results:args.length?stmt.all(...args):stmt.all()};},
      async run(){
        const info=args.length?stmt.run(...args):stmt.run();
        return {success:true, meta:{changes:info.changes}};
      }
    };
    return api;
  }};
}

export async function loadWorker(){
  const source=await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  return (await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
}
