import {UserMessage,GroupMessage} from 'zca-js';
// Pinned zca-js 2.2.0 event decoder. The public old_messages event discards
// pagination metadata; decode only history responses on the SAME live socket.
let decoder;
async function decode(parsed,key){decoder??=(await import(new URL('./utils.js',import.meta.resolve('zca-js')))).decodeEventData;return decoder(parsed,key);}
let requestSequence=0;
export function replayPage(listener,type,{cursor='1',first=true,timeout=8000,decodeFrame=decode}={}) {
  if(type!==0&&type!==1)throw new Error('INVALID_REPLAY_TYPE');
  const socket=listener.ws;
  if(!socket||typeof socket.on!=='function')throw new Error('REPLAY_SOCKET_UNAVAILABLE');
  const cmd=type===0?510:511;
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);socket.removeListener('message',onMessage);socket.removeListener('close',onClose);error?reject(error):resolve(value);};
    const onClose=()=>finish(new Error('REPLAY_SOCKET_CLOSED'));
    const timer=setTimeout(()=>finish(new Error('REPLAY_TIMEOUT')),timeout);
    const onMessage=async packet=>{
      if(!Buffer.isBuffer(packet)||packet.length<4||packet[0]!==1||packet.readUInt16LE(1)!==cmd||packet[3]!==1)return;
      try {
        if(packet.length>8*1024*1024)throw new Error();
        const result=await decodeFrame(JSON.parse(packet.subarray(4).toString('utf8')),listener.cipherKey);
        if(settled)return;
        if(result?.error_code!==0)throw new Error();
        const data=result.data,rows=type===0?data?.msgs:data?.groupMsgs;
        if(!Array.isArray(rows)||rows.length>10000)throw new Error();
        const more=data.more===true||data.more===1;
        const next=data.lastActionId==null?null:String(data.lastActionId);
        if(more&&(!next||!/^\d+$/.test(next)||next===String(cursor)))return finish(new Error('REPLAY_CURSOR_INVALID'));
        const messages=rows.map(row=>new (type===0?UserMessage:GroupMessage)(listener.ctx.uid,{...row}));
        finish(null,{messages,more,next_cursor:next,overflow:data.queueStatus?.[`${cmd}_1`]?.evict===1});
      }catch{finish(new Error('REPLAY_RESPONSE_INVALID'));}
    };
    socket.on('message',onMessage);socket.on('close',onClose);
    try {listener.sendWs({version:1,cmd,subCmd:1,data:{first,reqId:`history_${Date.now()}_${requestSequence++}`,lastId:String(cursor),preIds:[]}},false);}
    catch{finish(new Error('REPLAY_REQUEST_FAILED'));}
  });
}
