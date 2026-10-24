import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {dataDir,rpc} from './runtime.mjs';
import {Store} from './store.mjs';

// Explicit local CLI operation only. Never exposed as an MCP tool.
// Does not authenticate to Zalo or execute the optional upstream CLI.
export async function importHistory({db,account_id}={}) {
  if(typeof db!=='string'||!path.isAbsolute(db)||!/^\d+$/.test(account_id||''))throw new Error('ABSOLUTE_DB_PATH_AND_ACCOUNT_ID_REQUIRED');
  try{await rpc('status');throw new Error('SHUTDOWN_DAEMON_BEFORE_IMPORT');}catch(e){if(e.message==='SHUTDOWN_DAEMON_BEFORE_IMPORT')throw e;}
  const sourcePath=fs.realpathSync(db);
  // Upstream per-account layout is part of the supported format; refuse cross-account imports.
  if(path.basename(path.dirname(sourcePath))!==account_id||path.basename(sourcePath)!=='zalo.db')throw new Error('ACCOUNT_DIRECTORY_MISMATCH');
  process.umask(0o077);
  const targetDir=path.join(dataDir,'accounts',account_id);fs.mkdirSync(targetDir,{recursive:true,mode:0o700});
  const source=new DatabaseSync(sourcePath,{readOnly:true});let target;
  try{
    const cols=source.prepare('PRAGMA table_info(messages)').all().map(x=>x.name);
    for(const c of ['msgId','threadId','senderId','senderName','text','timestamp'])if(!cols.includes(c))throw new Error('UNSUPPORTED_HISTORY_SCHEMA');
    target=new Store(path.join(targetDir,'messages.db'));let added=0,examined=0;
    target.db.exec('BEGIN');
    try{
      for(const r of source.prepare('SELECT m.msgId,m.threadId,m.senderId,m.senderName,m.text,m.timestamp,t.type AS thread_type FROM messages m LEFT JOIN threads t ON m.threadId=t.threadId').iterate()){
        examined++;
        // Phone sync may use opaque sender IDs: do not label unmatched senders as definitely incoming.
        if(target.add({threadId:r.threadId,type:['group','1'].includes(String(r.thread_type))?1:0,isSelf:r.senderId===account_id?true:null,data:{msgId:r.msgId,uidFrom:r.senderId,dName:r.senderName,content:r.text,ts:r.timestamp,msgType:'imported'}},'external_history'))added++;
      }
      target.db.exec('COMMIT');
    }catch(e){target.db.exec('ROLLBACK');throw e;}
    return {added,examined,coverage:target.coverage(),source:'external_history',complete:false};
  }finally{source.close();target?.close();}
}
