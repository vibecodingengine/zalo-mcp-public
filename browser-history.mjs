import fs from 'node:fs';
import path from 'node:path';
import {browserQuery} from './browser-query.mjs';

export function localEndpoint(value) {
  let u;try{u=new URL(value);}catch{throw new Error('INVALID_BROWSER_ENDPOINT');}
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('BROWSER_ENDPOINT_MUST_BE_LOOPBACK');
  return u.origin;
}
export function targetSocket(target,endpoint) {
  let page,ws;try{page=new URL(target.url);ws=new URL(target.webSocketDebuggerUrl);}catch{throw new Error('INVALID_BROWSER_TARGET');}
  if(target.type!=='page'||page.origin!=='https://chat.zalo.me'||page.pathname!=='/')throw new Error('WRONG_BROWSER_TARGET');
  const base=new URL(endpoint);
  if(ws.protocol!=='ws:'||ws.hostname!=='127.0.0.1'||ws.port!==base.port||ws.username||ws.password||ws.search||ws.hash||!/^\/devtools\/page\/[\w-]+$/.test(ws.pathname))throw new Error('UNSAFE_BROWSER_SOCKET');
  return ws.href;
}
async function targets(endpoint) {
  try {
    const response=await fetch(`${endpoint}/json/list`,{redirect:'error',signal:AbortSignal.timeout(3000)});
    if(!response.ok)throw new Error();
    let size=0,parts=[];for await(const part of response.body){size+=part.length;if(size>262144)throw new Error();parts.push(part);}
    const list=JSON.parse(Buffer.concat(parts).toString());if(!Array.isArray(list))throw new Error();return list;
  } catch {throw new Error('BROWSER_DEBUG_ENDPOINT_UNAVAILABLE');}
}
export async function evaluateHistory(socket,input) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(socket);let done=false;
    const finish=(err,result)=>{if(done)return;done=true;clearTimeout(timer);try{ws.close();}catch{}err?reject(err):resolve(result);};
    const timer=setTimeout(()=>finish(new Error('WEB_HISTORY_TIMEOUT')),8000);
    ws.addEventListener('error',()=>finish(new Error('WEB_HISTORY_CONNECTION_FAILED')));
    ws.addEventListener('close',()=>{if(!done)finish(new Error('WEB_HISTORY_CONNECTION_CLOSED'));});
    ws.addEventListener('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{
      expression:`(${browserQuery.toString()})(${JSON.stringify(input)})`,awaitPromise:true,returnByValue:true,
      // Never print page exceptions, URLs or remote objects to logs.
      timeout:7000,objectGroup:'zalo-readonly-history'}})));
    ws.addEventListener('message',event=>{
      try{
        if(typeof event.data!=='string'||event.data.length>4*1024*1024)return finish(new Error('WEB_HISTORY_RESPONSE_TOO_LARGE'));
        const packet=JSON.parse(event.data);if(packet.id!==1)return;
        if(packet.error||packet.result?.exceptionDetails){
          const detail=packet.result?.exceptionDetails?.exception?.description||'';
          const match=detail.match(/^Error: (WEB_[A-Z_]+|WRONG_BROWSER_ORIGIN|INVALID_WEB_[A-Z_]+|INVALID_THREAD_ID|UNKNOWN_WEB_METHOD)(?:\n|$)/);
          return finish(new Error(match?.[1]||'WEB_HISTORY_QUERY_FAILED'));
        }
        const value=packet.result?.result?.value;
        if(!value||value.source!=='browser_local_store'||!/^\d{1,30}$/.test(value.account_id)||value.complete!==false)return finish(new Error('WEB_HISTORY_INVALID_RESPONSE'));
        if(input.account_id&&value.account_id!==input.account_id)return finish(new Error('WEB_ACCOUNT_CHANGED_RECONNECT'));
        finish(null,value);
      }catch{finish(new Error('WEB_HISTORY_INVALID_RESPONSE'));}
    });
  });
}
export class BrowserHistory {
  constructor(dir){this.file=path.join(dir,'browser-history.json');this.config=null;if(fs.existsSync(this.file)){try{const c=JSON.parse(fs.readFileSync(this.file,'utf8'));if(typeof c.target_id==='string'&&/^\d{1,30}$/.test(c.account_id))this.config={endpoint:localEndpoint(c.endpoint),target_id:c.target_id,account_id:c.account_id};}catch{}}}
  async connect({endpoint,target_id}) {
    endpoint=localEndpoint(endpoint);
    const list=(await targets(endpoint)).filter(t=>t.type==='page'&&/^https:\/\/chat\.zalo\.me\/(?:[?#]|$)/.test(t.url));
    const candidates=target_id?list.filter(t=>t.id===target_id):list;
    if(candidates.length!==1)throw new Error(candidates.length?'MULTIPLE_ZALO_TABS_SPECIFY_TARGET_ID':'ZALO_WEB_TAB_NOT_FOUND');
    const target=candidates[0],result=await evaluateHistory(targetSocket(target,endpoint),{method:'status'});
    this.config={endpoint,target_id:target.id,account_id:result.account_id};
    fs.writeFileSync(this.file,JSON.stringify(this.config),{mode:0o600});fs.chmodSync(this.file,0o600);
    return {...result,browser_connected:true};
  }
  disconnect(){this.config=null;try{fs.unlinkSync(this.file);}catch{}return {browser_connected:false};}
  async query(method,args={}) {
    if(!this.config)throw new Error('WEB_NOT_CONNECTED_RUN_WEB_CONNECT');
    const c=this.config,target=(await targets(c.endpoint)).find(t=>t.id===c.target_id);
    if(!target)throw new Error('ZALO_WEB_TAB_CLOSED_RECONNECT');
    return evaluateHistory(targetSocket(target,c.endpoint),{...args,method,account_id:c.account_id});
  }
}
