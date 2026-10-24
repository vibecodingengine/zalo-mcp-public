import {randomUUID} from 'node:crypto';
import * as zlib from 'node:zlib';
import {boundedDownload,transferUrl} from './sync-download.mjs';
let decoder;
async function decodeDefault(envelope,key){decoder??=(await import(new URL('./utils.js',import.meta.resolve('zca-js')))).decodeEventData;return decoder(envelope,key);}
// Experimental phone-confirmed restore on the existing socket; no attachments or receipts.
export async function transfer(api,c,onMessage,onStatus,{days=14,signal,timeoutMs=180000,decode=decodeDefault,download=boundedDownload}={}){
 if(typeof zlib.zstdDecompressSync!=='function')throw Error('SYNC_NODE_ZSTD_REQUIRED');
 if(!Number.isInteger(days)||days<1||days>30)throw Error('SYNC_DAYS_INVALID');
 if(!api.listener?.cipherKey||api.listener.ws?.readyState!==1)throw Error('SYNC_NOT_CONNECTED');
 const listener=api.listener, ws=listener.ws, sessions=new Map(), ik=c.keypair();
 const deadline=Date.now()+timeoutMs; let closed=false,fatal=null,totalBytes=0,decodedBytes=0,frames=0,rows=0;
 const check=()=>{if(signal?.aborted)throw Error('SYNC_CANCELLED');if(closed)throw Error('SYNC_SOCKET_CLOSED');if(fatal)throw Error(fatal);if(Date.now()>deadline)throw Error('SYNC_TIMEOUT')};
 const onClose=()=>{closed=true};
 const tap=async raw=>{
  if(!Buffer.isBuffer(raw)||raw.length<4||raw.length>8*1024*1024||raw.readUInt16LE(1)!==601)return;
  try{
   const envelope=JSON.parse(raw.subarray(4));const d=typeof envelope.encrypt==='number'?await decode(envelope,listener.cipherKey):envelope;
   for(const control of d?.data?.controls??[]){
    if(control.content?.act_type!=='transfer_sync2')continue;
    let v=control.content.data;if(typeof v==='string')v=JSON.parse(v);
    const s=sessions.get(v?.syncId);if(!s)continue;
    if(control.content.act==='transfer_status'){onStatus({phase:'phone_status',status:v.status});if(v.status===4||v.status===5)s.confirmed=true;}
    if(control.content.act==='upload_batch'){
     if(s.batches.length>=100)throw Error('BATCH_LIMIT');
     const batchKey=JSON.stringify([v.batchType,v.idx,v.msgUrl]);if(s.seen.has(batchKey))continue;s.seen.add(batchKey);s.batches.push(v);if(v.isLast===true||v.isLast===1)s.last=true;
     for(const scope of v.scopes??[])s.covered.add(scope.partition);
    }
    if(/error/i.test(control.content.act))s.failed=true;
   }
  }catch{fatal='SYNC_CONTROL_INVALID'}
 };
 ws.on('message',tap);ws.on('close',onClose);
 const send=(cmd,data)=>listener.sendWs({version:1,cmd,subCmd:0,data:{data,reqId:randomUUID()}},false);
 const dispose=s=>{if(!s.disposed&&ws.readyState===1){send(591,{syncId:s.id,toDevice:0,reason:1});s.disposed=true}};
 async function round(type,queries){
  check();const s={id:randomUUID(),ek:c.keypair(),batches:[],covered:new Set(),seen:new Set(),last:false,confirmed:false};sessions.set(s.id,s);
  send(590,{syncId:s.id,syncType:0,ek:Buffer.from(s.ek.publicKey).toString('base64'),ik:Buffer.from(ik.publicKey).toString('base64'),toDevice:0,tempKey:'',deviceName:'Zalo Readonly History',req:{type,priority:type==='conversation'?0:2,queries,batchSize:2000},ver:1,ussidx:0});
  onStatus({phase:'requested',type});
  while(!(s.last&&(type==='conversation'||queries.every(q=>s.covered.has(q.partition))))){
   check();if(s.failed)throw Error('SYNC_REJECTED');await new Promise(r=>setTimeout(r,250));
  }
  check();if(s.failed)throw Error('SYNC_REJECTED');
  onStatus({phase:'download',type,batches:s.batches.length,confirmed:s.confirmed});
  const decoded=[];let session;
  for(const batch of s.batches.sort((a,b)=>(a.batchType===2?0:1)-(b.batchType===2?0:1)||a.idx-b.idx)){
   if(!batch.msgUrl)continue;
   check();const url=transferUrl(batch.msgUrl);
   const buffer=await download(url,{maxBytes:16*1024*1024,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))]):AbortSignal.timeout(Math.max(1,deadline-Date.now()))});totalBytes+=buffer.length;if(totalBytes>64*1024*1024)throw Error('SYNC_TOTAL_BYTES_LIMIT');let offset=0;
   while(offset<buffer.length){
    check();if(offset+4>buffer.length)throw Error('TRUNCATED_FRAME');const size=buffer.readUInt32LE(offset);offset+=4;
    if(!size||offset+size>buffer.length)throw Error('INVALID_FRAME');const chunk=buffer.subarray(offset,offset+size);offset+=size;
    let plain;if(batch.batchType===2){const m=c.metadata(chunk,ik,s.ek);session=m.session;plain=m.plain}else{if(!session)throw Error('MISSING_METADATA');plain=c.message(chunk,session)}
    const bytes=plain.length>=4&&plain.readUInt32LE(0)===0xfd2fb528?zlib.zstdDecompressSync(plain,{maxOutputLength:32*1024*1024}):plain;
    decodedBytes+=bytes.length;if(decodedBytes>64*1024*1024||++frames>10000)throw Error('SYNC_DECODE_LIMIT');
    decoded.push((type==='conversation'?c.conversation:c.messageType).deserializeBinary(bytes).toObject());
   }
  }
  dispose(s);return decoded;
 }
 try{
  const from=Date.now()-days*86400000;
  const conv=(await round('conversation',[{partition:'',from,to:Number.MAX_SAFE_INTEGER,limit:2147483647}])).flatMap(x=>x.conversationsList??[]);
  if(conv.some(v=>typeof v.convId!=='string'||!v.convId.length||v.convId.length>100||![1,2].includes(v.convType)||!Number.isSafeInteger(Number(v.lastTs))||Number(v.lastTs)<0))throw Error('SYNC_CONVERSATION_INVALID');
  onStatus({phase:'conversations',count:conv.length});if(conv.length>100)throw Error('CONVERSATION_LIMIT');
  for(let i=0;i<conv.length;i+=20){
   const queries=conv.slice(i,i+20).map(v=>({partition:(v.convType===2?'group/':'oneone/')+v.convId,from,to:Number(v.lastTs)||Date.now(),limit:2147483647}));
   for(const chunk of await round('message',queries))for(const p of chunk.partitionsList??[])for(const m of p.messagesList??[]){check();if(++rows>50000)throw Error('SYNC_MESSAGE_LIMIT');if(!queries.some(q=>q.partition===p.id))throw Error('SYNC_PARTITION_INVALID');if(m.msgType===0&&typeof m.content==='string'&&m.content.length<=100000)await onMessage(p.id,m);}
  }
  onStatus({phase:'finished'});
 }finally{ws.off('message',tap);ws.off('close',onClose);for(const s of sessions.values()){try{dispose(s)}catch{}}ik.privateKey.fill(0);for(const s of sessions.values())s.ek.privateKey.fill(0)}
}
