import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=fileURLToPath(new URL('../',import.meta.url));
test('local auth + MCP handshake exposes only read tools and never logs in',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zalo-integration-'));
 const daemon=spawn(process.execPath,[path.join(root,'daemon.mjs')],{env:{...process.env,ZALO_READONLY_DATA_DIR:dir},stdio:'ignore'});
 let conn,client;
 try{
  for(let i=0;i<100;i++){try{conn=JSON.parse(fs.readFileSync(path.join(dir,'connection.json'),'utf8'));break;}catch{await new Promise(r=>setTimeout(r,50));}}
  assert.ok(conn);
  const url=`http://127.0.0.1:${conn.port}/rpc`;
  const request=(method,args={},headers={})=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${conn.secret}`,'Content-Type':'application/json',...headers},body:JSON.stringify({method,args})});
  assert.equal((await request('status',{}, {Authorization:'Bearer bad'})).status,403);
  assert.equal((await request('status',{}, {Origin:'https://example.invalid'})).status,403);
  assert.equal((await request('send',{text:'blocked'})).status,400);
  assert.equal((await request('web_history',{thread_id:'x',expression:'unsafe'})).status,400);
  assert.equal((await (await request('web_status')).json()).error,'WEB_NOT_CONNECTED_RUN_WEB_CONNECT');
  assert.equal((await (await request('status')).json()).result.state,'idle');
  client=new Client({name:'test',version:'1'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp.mjs')],env:{...process.env,ZALO_READONLY_DATA_DIR:dir},stderr:'pipe'}));
  const list=await client.listTools();assert.equal(list.tools.length,9);
  assert.ok(list.tools.every(t=>t.annotations.readOnlyHint));
  assert.ok(!list.tools.some(t=>/send|read_message|delete|login|sync|connect|eval|cookies/.test(t.name)));
  const s=await client.callTool({name:'zalo_status',arguments:{}});
  assert.equal(JSON.parse(s.content[0].text).state,'idle');
  assert.equal(fs.existsSync(path.join(dir,'session.json')),false);
  assert.equal(fs.statSync(path.join(dir,'connection.json')).mode&0o777,0o600);
 }finally{await client?.close();daemon.kill('SIGTERM');await new Promise(r=>daemon.exitCode!==null?r():daemon.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
});
