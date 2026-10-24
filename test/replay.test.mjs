import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {replayPage} from '../server-replay.mjs';
function frame(cmd,data){const header=Buffer.alloc(4);header[0]=1;header.writeUInt16LE(cmd,1);header[3]=1;return Buffer.concat([header,Buffer.from(JSON.stringify({encrypt:0,data:JSON.stringify({error_code:0,data})}))]);}
test('server replay preserves actual more/lastActionId and never guesses from last message',async()=>{
 const ws=new EventEmitter(),sent=[];
 const listener={ws,ctx:{uid:'10000'},cipherKey:null,sendWs(payload){sent.push(payload);queueMicrotask(()=>ws.emit('message',frame(payload.cmd,{msgs:payload.data.first?[{msgId:'20',actionId:'21',uidFrom:'10001',idTo:'0',content:'Synthetic old text',ts:'10'}]:[],more:payload.data.first?1:0,lastActionId:payload.data.first?'900':'950'})));}};
 const one=await replayPage(listener,0,{timeout:1000});assert.equal(one.next_cursor,'900');assert.equal(one.more,true);assert.equal(one.messages[0].threadId,'10001');
 const two=await replayPage(listener,0,{cursor:one.next_cursor,first:false,timeout:1000});assert.equal(two.more,false);assert.equal(sent[0].data.lastId,'1');assert.equal(sent[1].data.lastId,'900');assert.equal(sent[1].data.first,false);assert.ok(sent.every(p=>p.cmd===510));assert.equal(ws.listenerCount('message'),0);
});
test('empty queue page may still have more; invalid cursor, timeout and disconnect fail safely',async()=>{
 const ws=new EventEmitter();let data={msgs:[],more:1,lastActionId:'2'};
 const listener={ws,ctx:{uid:'10000'},sendWs(p){queueMicrotask(()=>ws.emit('message',frame(p.cmd,data)));}};
 assert.equal((await replayPage(listener,0,{timeout:1000})).more,true);
 data={msgs:[],more:1,lastActionId:'1'};await assert.rejects(replayPage(listener,0,{timeout:1000}),/REPLAY_CURSOR_INVALID/);
 listener.sendWs=()=>{};await assert.rejects(replayPage(listener,0,{timeout:10}),/REPLAY_TIMEOUT/);assert.equal(ws.listenerCount('message'),0);
 listener.sendWs=()=>queueMicrotask(()=>ws.emit('close'));await assert.rejects(replayPage(listener,0,{timeout:1000}),/REPLAY_SOCKET_CLOSED/);assert.equal(ws.listenerCount('close'),0);
});
