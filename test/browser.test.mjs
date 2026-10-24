import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {WebSocketServer} from 'ws';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {browserQuery} from '../browser-query.mjs';
import {BrowserHistory,localEndpoint,targetSocket} from '../browser-history.mjs';
import {validate} from '../schema.mjs';

async function fixture(){
 const indexedDB=new IDBFactory();let active='10000';const opened=indexedDB.open('zdb_10000',1);
 opened.onupgradeneeded=()=>{const db=opened.result;const m=db.createObjectStore('message',{keyPath:'msgId'});m.createIndex('userId_sendDttm_msgId',['toUid','sendDttm','msgId']);db.createObjectStore('conversation',{keyPath:'userId'});};
 const db=await new Promise((r,j)=>{opened.onsuccess=()=>r(opened.result);opened.onerror=j;});
 const tx=db.transaction(['message','conversation'],'readwrite');
 for(const id of ['10001','10002'])tx.objectStore('conversation').put({userId:id,isGroup:false});
 for(const [id,to,time] of [['1','10001','1700000000000'],['2','10001','1700000000000'],['3','10002','1700000000010']])tx.objectStore('message').put({msgId:id,toUid:to,sendDttm:time,fromUid:'10001',dName:'Synthetic',message:'ciphertext-not-for-output',msgType:1});
 await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=j;});
 let reads=0;
 const messageStore={getAll(range,options){
  reads++;assert.equal(options.index,'userId_sendDttm_msgId');
  return new Promise((resolve,reject)=>{
   const q=db.transaction('message','readonly').objectStore('message').index(options.index).openCursor(IDBKeyRange.bound(range.from,range.to,range.excludeFrom,range.excludeTo),options.direction);
   const rows=[];q.onerror=reject;q.onsuccess=()=>{const c=q.result;if(!c||rows.length===options.limit)return resolve(rows);rows.push({...c.value,message:'Synthetic decoded '+c.value.msgId});c.continue();};
  });
 }};
 const req={m:{},c:{fsN4:{exports:{default:{instance:{Core:{Message:messageStore}}}}}}};
 const chunks=[];chunks.push=chunk=>{const id=chunk[2][0][0];req.m[id]=chunk[1][id];req.c[id]={};req.m[id]({}, {}, req);return Array.prototype.push.call(chunks,chunk);};
 const context=vm.createContext({indexedDB,IDBKeyRange,window:{webpackJsonp:chunks},location:{origin:'https://chat.zalo.me'},localStorage:{getItem:()=>active},input:null});
 const run=async input=>{context.input=input;return JSON.parse(JSON.stringify(await vm.runInContext(`(${browserQuery.toString()})(input)`,context)));};
 return {run,context,chunks,req,reads:()=>reads,changeAccount:()=>{active='10002';},close:()=>db.close()};
}
test('web history reads decoded pre-existing messages; account scope, tie pagination and no writes',async()=>{
 const f=await fixture();try{
  const a=await f.run({method:'history',account_id:'10000',thread_id:'10001',limit:1});
  assert.equal(a.messages[0].message_id,'2');assert.equal(a.messages[0].text,'Synthetic decoded 2');assert.equal(a.has_more,true);assert.equal(a.complete,false);
  const b=await f.run({method:'history',account_id:'10000',thread_id:'10001',limit:1,before:a.next_before});
  assert.equal(b.messages[0].message_id,'1');assert.equal(b.has_more,false);assert.equal(b.next_before,null);
  assert.equal((await f.run({method:'history',thread_id:'unknown',limit:1})).messages.length,0);
  const c=await f.run({method:'conversations',limit:1});assert.equal(c.has_more,true);assert.equal((await f.run({method:'conversations',after:c.next_after,limit:1})).conversations[0].thread_id,'10002');
  assert.equal(f.chunks.length,0);assert.equal(Object.keys(f.req.m).length,0);assert.equal(Object.keys(f.req.c).length,1);
  await assert.rejects(f.run({method:'history',thread_id:'10001',limit:1000}),/INVALID_WEB_LIMIT/);
  f.changeAccount();await assert.rejects(f.run({method:'history',account_id:'10000',thread_id:'10001'}),/WEB_ACCOUNT_CHANGED/);
 }finally{f.close();}
});
test('unsupported browser decoder never returns raw ciphertext; origin guard',async()=>{
 const f=await fixture();try{delete f.req.c.fsN4;await assert.rejects(f.run({method:'history',thread_id:'10001'}),/WEB_READER_VERSION_UNSUPPORTED/);f.context.location.origin='https://example.invalid';await assert.rejects(f.run({method:'status'}),/WRONG_BROWSER_ORIGIN/);}finally{f.close();}
});
test('debug target validation prevents remote endpoints, credentials and target substitution',()=>{
 for(const endpoint of ['http://example.com:9222','http://localhost:9222','https://127.0.0.1:9222','http://127.0.0.1:9222/secret','http://user:pass@127.0.0.1:9222','http://127.0.0.1:9222/?token=x'])assert.throws(()=>localEndpoint(endpoint));
 const endpoint=localEndpoint('http://127.0.0.1:9222');const base={type:'page',url:'https://chat.zalo.me/',webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/page/test'};
 assert.ok(targetSocket(base,endpoint));
 for(const change of [{url:'https://chat.zalo.me.evil.invalid/'},{url:'https://chat.zalo.me/other'},{type:'service_worker'},{webSocketDebuggerUrl:'ws://example.com:9222/devtools/page/test'},{webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/test'}])assert.throws(()=>targetSocket({...base,...change},endpoint));
 for(const method of ['web_eval','web_send','web_cookies'])assert.throws(()=>validate(method,{}));
 assert.throws(()=>validate('web_history',{thread_id:'x',expression:'bad'}));
});
test('real HTTP/WebSocket CDP transport executes fixed reader and persists only binding',async()=>{
 const f=await fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'zalo-web-test-'));let port;let requests=0;
 const server=http.createServer((q,r)=>{assert.equal(q.url,'/json/list');r.setHeader('Content-Type','application/json');r.end(JSON.stringify([{id:'synthetic-tab',type:'page',url:'https://chat.zalo.me/',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/page/synthetic-tab`}]));});
 const ws=new WebSocketServer({server});ws.on('connection',socket=>socket.on('message',async data=>{const packet=JSON.parse(data);requests++;assert.equal(packet.method,'Runtime.evaluate');assert.ok(packet.params.expression.startsWith('(async function browserQuery('));try{const value=await vm.runInContext(packet.params.expression,f.context);socket.send(JSON.stringify({id:packet.id,result:{result:{value}}}));}catch(e){socket.send(JSON.stringify({id:packet.id,result:{exceptionDetails:{exception:{description:`Error: ${e.message}\n`}}}}));}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;
 try{const reader=new BrowserHistory(dir);const status=await reader.connect({endpoint:`http://127.0.0.1:${port}`});assert.equal(status.account_id,'10000');const result=await reader.query('history',{thread_id:'10001',limit:1});assert.equal(result.messages[0].text,'Synthetic decoded 2');
  const binding=JSON.parse(fs.readFileSync(path.join(dir,'browser-history.json')));assert.deepEqual(Object.keys(binding).sort(),['account_id','endpoint','target_id']);assert.equal(fs.statSync(path.join(dir,'browser-history.json')).mode&0o777,0o600);
  f.changeAccount();await assert.rejects(reader.query('status'),/WEB_ACCOUNT_CHANGED/);assert.equal(requests,3);reader.disconnect();assert.equal(fs.existsSync(path.join(dir,'browser-history.json')),false);
 }finally{for(const c of ws.clients)c.terminate();await new Promise(r=>ws.close(r));await new Promise(r=>server.close(r));f.close();fs.rmSync(dir,{recursive:true,force:true});}
});
