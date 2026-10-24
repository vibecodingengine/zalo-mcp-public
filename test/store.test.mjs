import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../store.mjs';
import {validate} from '../schema.mjs';
test('persistent dedupe and lossless timestamp-tie pagination',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zalo-store-'));const file=path.join(dir,'test.db');
  let s=new Store(file);
  const msg=n=>({threadId:'10001',type:0,isSelf:false,data:{msgId:String(n),uidFrom:'10002',content:n===2?'Xin chào':'hello',ts:'1000'}});
  try{
    for(let i=1;i<=4;i++)assert.equal(s.add(msg(i)),true);
    assert.equal(s.add(msg(1)),false);
    const a=s.read({thread_id:'10001',limit:2});const b=s.read({thread_id:'10001',limit:2,before:a.next_before});
    assert.deepEqual([...a.messages,...b.messages].map(m=>m.message_id),['4','3','2','1']);
    assert.equal(s.read({query:"' OR 1=1 --"}).messages.length,0);
    assert.equal(s.read({query:'chào'}).messages.length,1);
    const e=s.read({after:0,limit:2});assert.equal(e.next_after,2);
    assert.equal(s.read({after:e.next_after}).messages.length,2);
    s.close();s=new Store(file);assert.equal(s.add(msg(1)),false);assert.equal(s.coverage().messages,4);
  }finally{s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('write methods and unbounded queries rejected',()=>{
  for(const method of ['send','sendMessage','mark_read','delete','react','__proto__','constructor'])assert.throws(()=>validate(method,{}));
  assert.throws(()=>validate('history',{thread_id:'10001',limit:100000}));
  assert.throws(()=>validate('status',{extra:true}));
  assert.throws(()=>validate('events',{after:-1}));
});
