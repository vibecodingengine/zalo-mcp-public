import {DatabaseSync} from 'node:sqlite';

export class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY, thread_id TEXT NOT NULL, message_id TEXT NOT NULL,
        sender_id TEXT, sender_name TEXT, is_self INTEGER, thread_type INTEGER,
        sent_at INTEGER NOT NULL, received_at TEXT NOT NULL, text TEXT NOT NULL,
        kind TEXT, source TEXT NOT NULL, UNIQUE(thread_id,message_id));
      CREATE INDEX IF NOT EXISTS history_idx ON messages(thread_id,sent_at,seq);`);
  }
  add(m, source='live') {
    const d=m.data || {}, id=d.msgId || d.cliMsgId;
    if (!id || !m.threadId) return false;
    const ts=Number(d.ts);
    return this.db.prepare(`INSERT OR IGNORE INTO messages
      (thread_id,message_id,sender_id,sender_name,is_self,thread_type,sent_at,received_at,text,kind,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(String(m.threadId),String(id),String(d.uidFrom || ''),
      String(d.dName || ''),m.isSelf == null ? null : Number(m.isSelf),Number(m.type || 0),
      Number.isFinite(ts)?ts:0,new Date().toISOString(),typeof d.content==='string'?d.content:'',
      String(d.msgType || 'unknown'),source).changes > 0;
  }
  read({thread_id,query,before,after,limit=50}={}) {
    const conditions=[], values=[];
    if(thread_id){conditions.push('thread_id=?');values.push(thread_id);}
    if(query){conditions.push('instr(lower(text),lower(?))>0');values.push(query);}
    if(before){conditions.push('(sent_at < ? OR (sent_at = ? AND seq < ?))');values.push(before.sent_at,before.sent_at,before.seq);}
    if(after!==undefined){conditions.push('seq>?');values.push(after);}
    const order=after!==undefined?'seq ASC':'sent_at DESC,seq DESC';
    const messages=this.db.prepare(`SELECT * FROM messages ${conditions.length?'WHERE '+conditions.join(' AND '):''} ORDER BY ${order} LIMIT ?`).all(...values,limit);
    const last=messages.at(-1);
    return {messages,source:'local_cache',complete:false,
      next_before:last?{sent_at:last.sent_at,seq:last.seq}:null,
      next_after:after!==undefined?(last?.seq??after):undefined};
  }
  threads(limit=50) {
    return this.db.prepare(`SELECT thread_id,thread_type,COUNT(*) AS message_count,MIN(sent_at) AS oldest,
      MAX(sent_at) AS newest FROM messages GROUP BY thread_id ORDER BY newest DESC LIMIT ?`).all(limit);
  }
  coverage() {
    return { ...this.db.prepare('SELECT COUNT(*) AS messages,COUNT(DISTINCT thread_id) AS threads,MIN(sent_at) AS oldest,MAX(sent_at) AS newest FROM messages').get(),
      sources:this.db.prepare('SELECT source,COUNT(*) AS count FROM messages GROUP BY source').all(),complete:false};
  }
  close(){this.db.close();}
}
