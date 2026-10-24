import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Bridge} from './bridge.mjs';
import {dataDir} from './runtime.mjs';
import {validate} from './schema.mjs';
process.umask(0o077);
fs.mkdirSync(dataDir,{recursive:true,mode:0o700});fs.chmodSync(dataDir,0o700);
const lock=path.join(dataDir,'daemon.lock');
try{fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});}catch{console.error('DAEMON_LOCK_EXISTS_CHECK_PID_BEFORE_REMOVING');process.exit(1);}
const bridge=new Bridge(dataDir), secret=randomBytes(32).toString('hex');
let stopping=false;
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  const a=Buffer.from(req.headers.authorization||''), b=Buffer.from(`Bearer ${secret}`);
  if(req.headers.origin!==undefined || a.length!==b.length || !timingSafeEqual(a,b)){res.writeHead(403);res.end('{"ok":false,"error":"FORBIDDEN"}');return;}
  if(req.url!=='/rpc'||req.method!=='POST'){res.writeHead(404);res.end('{"ok":false,"error":"NOT_FOUND"}');return;}
  try{
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>16384)throw new Error('REQUEST_TOO_LARGE');chunks.push(chunk);}
    const q=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const args=validate(q.method,q.args);
    if(q.method==='shutdown'){res.end(JSON.stringify({ok:true,result:{state:'stopping'}}));setTimeout(close,50);return;}
    const result=await bridge.call(q.method,args);res.end(JSON.stringify({ok:true,result}));
  }catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:/^[A-Z_]+$/.test(e.message)?e.message:'INVALID_REQUEST'}));}
});
server.requestTimeout=25000;server.headersTimeout=10000;
server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(path.join(dataDir,'connection.json'),JSON.stringify({pid:process.pid,port:server.address().port,secret}),{mode:0o600});console.error('DAEMON_READY');});
function close(){if(stopping)return;stopping=true;bridge.disconnect();bridge.store?.close();server.close();for(const f of [lock,path.join(dataDir,'connection.json')]){try{fs.unlinkSync(f);}catch{}}process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);
server.on('error',()=>{console.error('DAEMON_SERVER_ERROR');close();});
