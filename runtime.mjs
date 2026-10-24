import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const dataDir=path.resolve(process.env.ZALO_READONLY_DATA_DIR??path.join(process.env.XDG_DATA_HOME??path.join(os.homedir(),'.local','share'),'zalo-readonly-mcp'));
export async function rpc(method,args={}) {
  const c=JSON.parse(fs.readFileSync(path.join(dataDir,'connection.json'),'utf8'));
  const r=await fetch(`http://127.0.0.1:${c.port}/rpc`,{method:'POST',headers:{Authorization:`Bearer ${c.secret}`,'Content-Type':'application/json'},body:JSON.stringify({method,args}),signal:AbortSignal.timeout(20000)});
  const result=await r.json();if(!result.ok)throw new Error(result.error);return result.result;
}
export async function ensureDaemon(){
  try{return await rpc('status');}catch{}
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  const log=fs.openSync(path.join(dataDir,'daemon.log'),'a',0o600);
  const child=spawn(process.execPath,[fileURLToPath(new URL('./daemon.mjs',import.meta.url))],{env:process.env,stdio:['ignore',log,log],detached:true});
  child.on('error',()=>{});child.unref();fs.closeSync(log);
  for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));try{return await rpc('status');}catch{}}
  throw new Error('DAEMON_START_FAILED_CHECK_LOG_AND_LOCK');
}
