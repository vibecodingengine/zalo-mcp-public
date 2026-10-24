// Serialized into the authorized Zalo tab. No network, cookies, credentials,
// write APIs, writable transactions or arbitrary code from callers.
// The app storage facade decrypts messages in-page; no keys leave the page.
export async function browserQuery(input) {
  const fail = code => { throw new Error(code); };
  const originOK = () => location.origin === 'https://chat.zalo.me';
  const active = () => localStorage.getItem('sh_z_recentuid') || localStorage.getItem('z_recentuid');
  if (!originOK()) fail('WRONG_BROWSER_ORIGIN');
  const account = active();
  if (!/^\d{1,30}$/.test(account || '')) fail('WEB_NOT_LOGGED_IN');
  if (input.account_id && input.account_id !== account) fail('WEB_ACCOUNT_CHANGED_RECONNECT');
  const name = `zdb_${account}`;
  if (!(await indexedDB.databases()).some(d => d.name === name)) fail('WEB_MESSAGE_DATABASE_UNAVAILABLE');
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => { req.transaction.abort(); reject(new Error('WEB_MESSAGE_DATABASE_UNAVAILABLE')); };
    req.onerror = () => reject(new Error('WEB_DATABASE_OPEN_FAILED'));
    req.onsuccess = () => resolve(req.result);
    req.onblocked = () => reject(new Error('WEB_DATABASE_BLOCKED'));
  });
  const reader = () => {
    // Zalo Web 26.10.20 uses this loaded module for its message query builder.
    // Capture the existing loader, then remove our temporary module immediately.
    // Never initialize arbitrary application modules or use network/chat APIs.
    const chunks=window.webpackJsonp;
    if(!Array.isArray(chunks)) fail('WEB_READER_VERSION_UNSUPPORTED');
    let req; const id='__zalo_readonly_history_reader_v1__';
    const chunk=[[id],{[id]:(module,exports,load)=>{req=load;}},[[id]]];
    try { chunks.push(chunk); }
    finally { const at=chunks.indexOf(chunk);if(at>=0)chunks.splice(at,1);if(req){delete req.m[id];delete req.c[id];} }
    const store=req?.c?.fsN4?.exports?.default?.instance;
    if(typeof store?.Core?.Message?.getAll!=='function') fail('WEB_READER_VERSION_UNSUPPORTED');
    return store.Core.Message;
  };
  const common = {account_id:account, source:'browser_local_store', complete:false};
  const trim = (s, max=16384) => typeof s === 'string' ? s.slice(0,max) : '';
  const check = () => { if (!originOK() || active() !== account) fail('WEB_ACCOUNT_CHANGED_RECONNECT'); };
  try {
    if (!db.objectStoreNames.contains('message')) fail('WEB_MESSAGE_SCHEMA_UNSUPPORTED');
    if (input.method === 'status') { reader(); check(); return {...common, available:true}; }
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('INVALID_WEB_LIMIT');
    if (input.method === 'conversations') {
      if (!db.objectStoreNames.contains('conversation')) fail('WEB_MESSAGE_SCHEMA_UNSUPPORTED');
      const rows = await new Promise((resolve,reject) => {
        const store=db.transaction('conversation','readonly').objectStore('conversation');
        const range=input.after ? IDBKeyRange.lowerBound(input.after,true) : undefined;
        const req=store.openCursor(range); const out=[];
        req.onerror=()=>reject(new Error('WEB_DATABASE_QUERY_FAILED'));
        req.onsuccess=()=>{const c=req.result;if(!c||out.length===limit+1)return resolve(out);out.push({key:c.key,value:c.value});c.continue();};
      });
      check(); const hasMore=rows.length>limit; const page=rows.slice(0,limit);
      return {...common,conversations:page.map(({value:r})=>({thread_id:trim(r.userId,128),thread_type:r.isGroup?1:0})),
        has_more:hasMore,next_after:hasMore?page.at(-1).key:null};
    }
    if (input.method !== 'history') fail('UNKNOWN_WEB_METHOD');
    const id=input.thread_id;
    if (typeof id!=='string'||!id.length||id.length>128) fail('INVALID_THREAD_ID');
    const before=input.before;
    if (before && (!/^\d{1,20}$/.test(before.sent_at)||typeof before.message_id!=='string'||before.message_id.length>128)) fail('INVALID_WEB_CURSOR');
    // Raw IndexedDB message bodies are encrypted. Use the same in-page read
    // facade as the web UI, which returns decoded records without exporting keys.
    const rows=await reader().getAll({from:[id,'',''],to:before?[id,before.sent_at,before.message_id]:[id,'\uffff','\uffff'],
      excludeFrom:false,excludeTo:!!before},{index:'userId_sendDttm_msgId',direction:'prev',limit:limit+1,partition:id,useLGKeyRange:true});
    if(!Array.isArray(rows)||rows.some(r=>r.toUid!==id||typeof r.sendDttm!=='string'||typeof r.msgId!=='string'))fail('WEB_MESSAGE_SCHEMA_UNSUPPORTED');
    check();const hasMore=rows.length>limit,page=rows.slice(0,limit),last=page.at(-1);
    return {...common,thread_id:id,messages:page.map(r=>({thread_id:id,message_id:trim(r.msgId,128),
      sender_id:trim(r.fromUid,128),sender_name:trim(r.dName,256),is_self:r.fromUid===account||r.fromUid==='0',
      sent_at:trim(r.sendDttm,20),text:trim(r.message),text_truncated:typeof r.message==='string'&&r.message.length>16384,
      kind:typeof r.msgType==='string'?trim(r.msgType,100):String(r.msgType??''),
      non_text:typeof r.message!=='string'})),has_more:hasMore,
      next_before:hasMore&&last?{sent_at:last.sendDttm,message_id:last.msgId}:null};
  } finally { db.close(); }
}
