// Signed transfer links are secrets. Never include URLs or response bodies in errors.
export async function boundedDownload(url,{maxBytes,signal,fetcher=fetch}={}) {
  const timeout=AbortSignal.timeout(20000);
  const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  let response;
  try{response=await fetcher(url,{redirect:'error',signal:combined,credentials:'omit'});}
  catch{throw new Error(combined.aborted?'SYNC_DOWNLOAD_ABORTED':'SYNC_DOWNLOAD_FAILED');}
  if(!response.ok||!response.body)throw new Error('SYNC_DOWNLOAD_FAILED');
  const size=Number(response.headers.get('content-length'));
  if(size>maxBytes){await response.body.cancel();throw new Error('SYNC_DOWNLOAD_LIMIT');}
  const reader=response.body.getReader(),parts=[];let total=0;
  try{
    for(;;){combined.throwIfAborted();const {done,value}=await reader.read();if(done)break;total+=value.length;
      if(total>maxBytes)throw new Error('SYNC_DOWNLOAD_LIMIT');parts.push(value);}
    return Buffer.concat(parts,total);
  }finally{try{await reader.cancel();}catch{}}
}

export function transferUrl(value){
  let u;try{u=new URL(value);}catch{throw new Error('SYNC_DOWNLOAD_ORIGIN');}
  if(u.protocol!=='https:'||u.hostname!=='transfersync.zaloapp.com'||u.port||u.username||u.password||u.pathname!=='/api/transfer-sync-v2/download')throw new Error('SYNC_DOWNLOAD_ORIGIN');
  return u.href;
}
