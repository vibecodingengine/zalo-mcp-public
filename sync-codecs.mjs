// Pinned official web codecs downloaded only on explicit sync. No vendor code bundled.
// VM separates globals; it is not a security boundary. Hash verification is mandatory.
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import jspb from 'google-protobuf';
import {webcrypto,createHash} from 'node:crypto';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {boundedDownload} from './sync-download.mjs';
export const CODEC_BUILD='1b2d86e9567f6be024ce';
const assets=[
 ['worker.js','https://chat.zalo.me/sync-v2-worker.'+CODEC_BUILD+'.js','b650e02c390f27b6e11e879c0475bfcdbeaa3211368772a5028fd20772fb8dec',32*1024*1024],
 ['libzproto.wasm','https://chat.zalo.me/libs/libzproto_wasm_bg.ecc0555ba9d0f8867a4699ce943ec745.wasm','3a868037a32739a4fcb3c22425150745613006f9dbc561f30fd705effaed55fa',2*1024*1024]
];
export function verifyAsset(bytes,hash){if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('SYNC_CODEC_HASH_MISMATCH');return bytes;}
export async function codecs(dir,{signal}={}){
 const cache=path.join(dir,'sync-codecs',CODEC_BUILD);fs.mkdirSync(cache,{recursive:true,mode:0o700});
 const loaded=[];
 for(const [name,url,hash,maxBytes] of assets){
  signal?.throwIfAborted();const file=path.join(cache,name);let bytes;
  if(fs.existsSync(file)){if(fs.statSync(file).size>maxBytes)throw Error('SYNC_CODEC_SIZE');bytes=fs.readFileSync(file);}
  else{
   bytes=await boundedDownload(url,{maxBytes,signal});
   if(bytes[0]===31&&bytes[1]===139)bytes=gunzipSync(bytes,{maxOutputLength:maxBytes});
   verifyAsset(bytes,hash);fs.writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
  }
  loaded.push(verifyAsset(bytes,hash));
 }
 const source=loaded[0].toString('utf8'), ast=parse(source,{ecmaVersion:'latest'}), wanted=new Set(['Vox7','Ho1Y','1y5R']), factories={};
 function visit(n){if(!n||typeof n!=='object')return;if(n.type==='Property'&&wanted.has(n.key.name??n.key.value)&&n.value.type==='FunctionExpression')factories[n.key.name??n.key.value]=source.slice(n.value.start,n.value.end);for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v)}}
 visit(ast);if(Object.keys(factories).length!==3)throw Error('CODEC_BUILD_CHANGED');
 const env={TextDecoder,TextEncoder,WebAssembly,Uint8Array,ArrayBuffer,DataView,crypto:webcrypto,proto:{},console:{log(){},warn(){},error(){}}};
 const context=vm.createContext(env);
 const req=id=>{if(id==='yLpj')return env;if(id==='3UD+')return x=>x;if(id==='hRO2')return jspb;if(id==='N3ek')return {};throw Error('UNEXPECTED_CODEC_DEPENDENCY_'+id)};
 req.d=(obj,key,get)=>Object.defineProperty(obj,key,{get,enumerable:true});req.r=()=>{};req.o=(a,b)=>Object.hasOwn(a,b);req.n=m=>()=>m;
 const run=id=>{const m={exports:{}};new vm.Script('('+factories[id]+')').runInContext(context,{timeout:3000})(m,m.exports,req);return m.exports};
 const z=run('Vox7');await z.b(loaded[1]);run('1y5R');run('Ho1Y');
 return {keypair:()=>{const k=z.e();const r={publicKey:Uint8Array.from(k.publicKey),privateKey:Uint8Array.from(k.privateKey)};k.free();return r},metadata:(chunk,ik,ek)=>{const r=z.j(chunk,ik.publicKey,ik.privateKey,ek.privateKey);const out={plain:Buffer.from(r.plaintext),session:Uint8Array.from(r.sessionRecord)};r.free();return out},message:(chunk,session)=>{const r=z.i(chunk,session);const out=Buffer.from(r.plaintext);r.free();return out},conversation:env.proto.Sync2.Conversation.SyncChunk,messageType:env.proto.Sync2.Message.SyncChunk};
}
