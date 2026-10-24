import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
test('phone-history import is local, transactional, deduplicated and account-scoped',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zalo-import-'));
 process.env.ZALO_READONLY_DATA_DIR=path.join(dir,'target');
 const {importHistory}=await import('../import-history.mjs');
 const src=path.join(dir,'accounts','10000');fs.mkdirSync(src,{recursive:true});
 const file=path.join(src,'zalo.db');const db=new DatabaseSync(file);
 db.exec('CREATE TABLE messages (msgId TEXT,threadId TEXT,senderId TEXT,senderName TEXT,text TEXT,timestamp INTEGER); CREATE TABLE threads(threadId TEXT,type TEXT);');
 db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?)').run('m1','10001','10000','Synthetic','old text',1);
 db.prepare('INSERT INTO threads VALUES (?,?)').run('10001','user');db.close();
 try{
  await assert.rejects(importHistory({db:file,account_id:'20000'}),/ACCOUNT_DIRECTORY_MISMATCH/);
  assert.equal((await importHistory({db:file,account_id:'10000'})).added,1);
  assert.equal((await importHistory({db:file,account_id:'10000'})).added,0);
  const check=new DatabaseSync(file,{readOnly:true});assert.equal(check.prepare('SELECT COUNT(*) AS n FROM messages').get().n,1);check.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
