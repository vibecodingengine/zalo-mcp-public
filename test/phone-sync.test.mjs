import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {transfer} from '../phone-sync.mjs';
import {boundedDownload,transferUrl} from '../sync-download.mjs';
import {verifyAsset} from '../sync-codecs.mjs';
import {Bridge} from '../bridge.mjs';
import {Store} from '../store.mjs';
import {validate,readSchemas} from '../schema.mjs';
function fixture({silent=false,badOrigin=false}={}){
 const ws=new EventEmitter();ws.readyState=1;const sent=[],keys=[],blobs=new Map();
 const emit=(act,data)=>{const body=Buffer.from(JSON.stringify({data:{controls:[{content:{act_type:'transfer_sync2',act,data:JSON.stringify(data)}}]}}));const header=Buffer.alloc(4);header[0]=1;header.writeUInt16LE(601,1);ws.emit('message',Buffer.concat([header,body]));};
 const listener={ws,cipherKey:'synthetic',sendWs:p=>{sent.push(p);if(p.cmd!==590||silent)return;const v=p.data.data;const isConv=v.req.type==='conversation';
  const obj=isConv?{conversationsList:[{convId:'fictional',convType:1,lastTs:Date.now()}]}:{partitionsList:[{id:'oneone/fictional',messagesList:[{globalId:'100',senderId:'synthetic',timestamp:123,msgType:0,content:'historical fixture'},{globalId:'101',msgType:3,content:'attachment must be skipped'}]}]};
  const bytes=Buffer.from(JSON.stringify(obj)),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);
  const url=(badOrigin?'https://127.0.0.1':'https://transfersync.zaloapp.com')+'/api/transfer-sync-v2/download?key='+v.req.type;blobs.set(url,Buffer.concat([header,bytes]));
  setImmediate(()=>{emit('transfer_status',{syncId:v.syncId,status:4});const batch={syncId:v.syncId,batchType:2,idx:0,isLast:true,msgUrl:url,scopes:v.req.queries};emit('upload_batch',batch);emit('upload_batch',batch);});
 }};
 const codec={keypair:()=>{const k={publicKey:new Uint8Array(33),privateKey:new Uint8Array(32).fill(7)};keys.push(k);return k;},metadata:b=>({plain:b,session:new Uint8Array(1)}),message:b=>b,conversation:{deserializeBinary:b=>({toObject:()=>JSON.parse(b)})},messageType:{deserializeBinary:b=>({toObject:()=>JSON.parse(b)})}};
 return {api:{listener},codec,sent,keys,options:{decode:x=>x,download:async u=>blobs.get(u)},ws};
}
test('phone transfer negotiates conversations/messages on one socket, skips attachments, dedupes batches and disposes sessions',async()=>{
 const f=fixture(),rows=[],progress=[];await transfer(f.api,f.codec,(p,m)=>rows.push([p,m]),v=>progress.push(v),f.options);
 assert.equal(rows.length,1);assert.equal(rows[0][1].content,'historical fixture');
 assert.deepEqual(f.sent.map(x=>x.cmd),[590,591,590,591]);
 assert.equal(f.sent[0].data.data.req.type,'conversation');assert.equal(f.sent[2].data.data.req.queries[0].partition,'oneone/fictional');
 assert.equal(f.ws.listenerCount('message'),0);assert.ok(f.keys.every(k=>k.privateKey.every(x=>x===0)));
 assert.equal(progress.at(-1).phase,'finished');
});
test('transfer rejects unexpected signed-link origin; cancellation and socket conflict detach without reconnect',async()=>{
 for(const mode of ['origin','cancel','close','timeout']){
  const f=fixture({silent:mode!=='origin',badOrigin:mode==='origin'}),controller=new AbortController();
  const job=transfer(f.api,f.codec,()=>assert.fail('no data expected'),()=>{},{...f.options,signal:controller.signal,timeoutMs:mode==='timeout'?5:1000});
  if(mode==='cancel')controller.abort();if(mode==='close')f.ws.emit('close',3000);
  await assert.rejects(job,/SYNC_(DOWNLOAD_ORIGIN|CANCELLED|SOCKET_CLOSED|TIMEOUT)/);
  assert.equal(f.ws.listenerCount('message'),0);assert.equal(f.sent.filter(x=>x.cmd===590).length,1);
 }
});
test('downloads enforce URL, redirect, stream-size and asset-hash boundaries',async()=>{
 for(const u of ['http://transfersync.zaloapp.com/api/transfer-sync-v2/download','https://transfersync.zaloapp.com.evil.test/api/transfer-sync-v2/download','https://u:p@transfersync.zaloapp.com/api/transfer-sync-v2/download'])assert.throws(()=>transferUrl(u));
 let opts;await assert.rejects(boundedDownload('https://example.test',{maxBytes:2,fetcher:async(u,o)=>{opts=o;return new Response(new Uint8Array(3));}}),/SYNC_DOWNLOAD_LIMIT/);
 assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');
 const bytes=Buffer.from('synthetic');assert.equal(verifyAsset(bytes,createHash('sha256').update(bytes).digest('hex')),bytes);assert.throws(()=>verifyAsset(bytes,'bad'),/HASH_MISMATCH/);
});
test('bridge background sync is explicit, account-scoped, deduplicated, cancellable and absent from MCP mutation surface',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zalo-sync-test-'));
 const b=new Bridge(dir,{syncCodecs:async()=>({}),syncTransfer:async(api,c,add,status,{signal})=>{status({phase:'requested'});for(let i=0;i<2;i++)add('oneone/fixture',{globalId:'1',senderId:'opaque',timestamp:10,content:'old'});}});
 try{
  assert.throws(()=>b.startSync(),/NOT_CONNECTED/);b.state='connected';b.api={listener:{cipherKey:'synthetic',stop(){}}};b.store=new Store(path.join(dir,'cache.db'));
  assert.equal(b.startSync().state,'running');assert.throws(()=>b.startSync(),/ALREADY_RUNNING/);await b.syncJob;
  assert.equal(b.syncState.received,1);assert.equal(b.store.read().messages[0].source,'phone_sync');assert.equal(b.store.read().messages[0].is_self,null);
  assert.equal(b.store.read().messages[0].thread_id,'sync:oneone/fixture');
  b.syncTransfer=async(api,c,add,status,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('SYNC_CANCELLED')),{once:true}));
  b.startSync();await new Promise(r=>setImmediate(r));b.call('sync_cancel',{});await b.syncJob;assert.equal(b.syncState.state,'cancelled');
  assert.equal(Object.hasOwn(readSchemas,'sync_mobile'),false);assert.equal(Object.hasOwn(readSchemas,'sync_status'),true);
  assert.throws(()=>validate('sync_mobile',{days:31}));assert.deepEqual(validate('sync_mobile',{}),{days:14});
 }finally{b.disconnect();b.store?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('truncated downloaded framing fails without importing or retaining socket listeners',async()=>{
 const f=fixture();await assert.rejects(transfer(f.api,f.codec,()=>assert.fail('no import'),()=>{},{...f.options,download:async()=>Buffer.from([255,255,255,127,0])}),/INVALID_FRAME/);
 assert.equal(f.ws.listenerCount('message'),0);assert.equal(f.sent.at(-1).cmd,591);
});
