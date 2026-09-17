import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setDurableSnapshotWriter } from './durable-snapshot.js';

const FILES=['accounts.json','sessions.json','social.json','profiles.json'];
function cfg(env=process.env){
  const url=(env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=env.SUPABASE_SERVICE_ROLE_KEY||'';
  return url&&key?{url,key,table:env.HAMU_DB_TABLE||'hamu_state'}:null;
}
async function request(c,method,path,body){
  const r=await fetch(`${c.url}/rest/v1/${c.table}${path}`,{method,headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok) throw new Error(`Managed PostgreSQL snapshot request failed (${r.status}).`);
  return r;
}
export class PostgresSnapshot {
  constructor({dataDir,env=process.env}={}){this.dataDir=dataDir;this.config=cfg(env);this.enabled=!!this.config;this.queue=Promise.resolve();}
  async ensureSchema(){
    // Table creation is supplied in deployment/POSTGRES-SCHEMA.sql because PostgREST
    // intentionally does not expose arbitrary SQL execution from the public API.
    if(!this.enabled)return;
    const r=await fetch(`${this.config.url}/rest/v1/${this.config.table}?select=name&limit=1`,{headers:{apikey:this.config.key,Authorization:`Bearer ${this.config.key}`}});
    if(!r.ok)throw new Error(`Managed PostgreSQL table '${this.config.table}' is missing or inaccessible. Run deployment/POSTGRES-SCHEMA.sql first.`);
  }
  async hydrate(){
    if(!this.enabled)return false;
    await this.ensureSchema();
    const r=await fetch(`${this.config.url}/rest/v1/${this.config.table}?select=name,payload&name=in.(${FILES.map(x=>encodeURIComponent(x)).join(',')})`,{headers:{apikey:this.config.key,Authorization:`Bearer ${this.config.key}`}});
    if(!r.ok)throw new Error(`Could not read managed PostgreSQL account state (${r.status}).`);
    const rows=await r.json();
    let restored=false;
    await mkdir(this.dataDir,{recursive:true,mode:0o700});
    for(const row of rows){if(!FILES.includes(row.name)||row.payload==null)continue;const file=join(this.dataDir,row.name);try{await stat(file);continue;}catch(e){if(e.code!=='ENOENT')throw e;}await writeFile(file,JSON.stringify(row.payload)+'\n',{mode:0o600});restored=true;}
    return restored;
  }
  async write(name,value){
    if(!this.enabled)return;
    if(!FILES.includes(name))return;
    this.queue=this.queue.then(()=>request(this.config,'POST',`?on_conflict=name`,{name,payload:value,updated_at:new Date().toISOString()}));
    // PostgREST upsert requires Prefer resolution.
    try{await this.queue;}catch(error){this.queue=Promise.resolve();throw error;}
  }

  async seedFromLocal(){
    if(!this.enabled)return;
    for(const name of FILES){try{const value=JSON.parse(await readFile(join(this.dataDir,name),'utf8'));await this.write(name,value);}catch(e){if(e.code!=='ENOENT')throw e;}}
  }
  async backup(){return this.queue;}
  attach(){if(this.enabled)setDurableSnapshotWriter((name,value)=>this.write(name,value));}
  detach(){setDurableSnapshotWriter(null);}
}
