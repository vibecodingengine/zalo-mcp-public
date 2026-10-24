import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Bridge} from '../bridge.mjs';
test('single mock session captures live + history, stops on conflict; no account mutation',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zalo-bridge-'));
  const listener=new EventEmitter();let starts=0,logins=0;
  listener.start=()=>{starts++;queueMicrotask(()=>listener.emit('connected'));};
  listener.stop=()=>{};
  listener.requestOldMessages=(type,cursor)=>queueMicrotask(()=>listener.emit('old_messages',type===0&&!cursor?[{type:0,threadId:'10001',isSelf:false,data:{msgId:'1',actionId:'1',content:'old',ts:'10'}}]:[],type));
  const api={listener,getContext:()=>({uid:'10000',imei:'synthetic',userAgent:'synthetic',cookie:{toJSON:()=>({cookies:[]})}})};
  const clientFactory=()=>({loginQR:async()=>{logins++;return api;}});
  const b=new Bridge(dir,{clientFactory,pageTimeout:20,maxPages:3});
  try{
    await b.begin();await b.begin();await new Promise(r=>setTimeout(r,50));
    assert.equal(logins,1);assert.equal(starts,1);assert.equal(b.store.coverage().messages,1);
    listener.emit('message',{type:0,threadId:'10001',isSelf:true,data:{msgId:'2',content:'new',ts:'20'}});
    assert.equal(b.store.coverage().messages,2);
    listener.emit('closed',3000);assert.equal(b.status().state,'connection_conflict');assert.equal(starts,1);
    b.disconnect();b.store.close();b.store=null;
    const offline=new Bridge(dir,{clientFactory});assert.equal(offline.status().coverage.messages,2);assert.equal(logins,1);offline.store.close();
  }finally{b.disconnect();b.store?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
