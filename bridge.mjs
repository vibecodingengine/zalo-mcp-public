import fs from 'node:fs';
import path from 'node:path';
import {Zalo} from 'zca-js';
import {Store} from './store.mjs';
import {BrowserHistory} from './browser-history.mjs';
import {replayPage} from './server-replay.mjs';
import {transfer} from './phone-sync.mjs';
import {codecs} from './sync-codecs.mjs';

export class Bridge {
  constructor(dir,{clientFactory=()=>new Zalo({selfListen:true,checkUpdate:false,logging:false}),pageTimeout=8000,maxPages=5,replay=replayPage,syncTransfer=transfer,syncCodecs=codecs}={}) {
    this.browser=new BrowserHistory(dir);this.replay=replay;this.syncTransfer=syncTransfer;this.syncCodecs=syncCodecs;
    this.syncJob=null;this.syncController=null;this.syncState={state:'not_started',received:0,complete:false};
    this.dir=dir;this.clientFactory=clientFactory;this.pageTimeout=pageTimeout;this.maxPages=maxPages;
    this.generation=0;this.api=null;this.store=null;this.state='idle';this.backfill={state:'not_started'};
    this.lastError=null;this.account=null;this.connectionStarted=null;this.disconnectedAt=null;this.inflight=null;
    const selected=path.join(dir,'current-account.json');
    if(fs.existsSync(selected)){
      const id=JSON.parse(fs.readFileSync(selected,'utf8')).account_id;
      if(/^\d+$/.test(id)&&fs.existsSync(path.join(dir,'accounts',id,'messages.db'))){this.account=id;this.store=new Store(path.join(dir,'accounts',id,'messages.db'));}
    }
  }
  status(){return {state:this.state,connected:this.state==='connected',account_id:this.account,read_only:true,browser_history:{configured:!!this.browser.config,account_id:this.browser.config?.account_id??null},
    pid:process.pid,checked_at:new Date().toISOString(),connected_at:this.connectionStarted,
    disconnected_at:this.disconnectedAt,last_error:this.lastError,backfill:this.backfill,
    phone_sync:this.syncState,coverage:this.store?.coverage()??null,qr_path:this.state==='awaiting_scan'?path.join(this.dir,'login-qr.png'):undefined};}
  async begin(resume=false) {
    if(this.inflight || ['connected','connecting','awaiting_scan','confirming'].includes(this.state))return this.status();
    if(this.browser.config)throw new Error('BROWSER_ATTACHED_DO_NOT_START_SECOND_SESSION');
    const credentialFile=path.join(this.dir,'session.json');
    if(resume && !fs.existsSync(credentialFile))throw new Error('NO_SAVED_SESSION');
    const gen=++this.generation;this.state='connecting';this.lastError=null;
    let ready;
    const qrReady=new Promise(r=>{ready=r;});
    this.inflight=(async()=>{
      try {
        const client=this.clientFactory();
        const api=resume?await client.login(JSON.parse(fs.readFileSync(credentialFile,'utf8'))):await client.loginQR({},e=>{
          if(gen!==this.generation){e.actions?.abort?.();return;}
          if(e.type===0){fs.writeFileSync(path.join(this.dir,'login-qr.png'),Buffer.from(e.data.image,'base64'),{mode:0o600});this.state='awaiting_scan';ready();}
          if(e.type===1){this.state='qr_expired';e.actions.abort();}
          if(e.type===2)this.state='confirming';
          if(e.type===3){this.state='login_declined';e.actions.abort();}
        });
        if(gen!==this.generation)return;
        this.api=api;const ctx=api.getContext();this.account=String(ctx.uid);
        if(!/^\d+$/.test(this.account))throw new Error('INVALID_ACCOUNT_ID');
        const accountDir=path.join(this.dir,'accounts',this.account);fs.mkdirSync(accountDir,{recursive:true,mode:0o700});
        this.store?.close();this.store=new Store(path.join(accountDir,'messages.db'));
        fs.writeFileSync(path.join(this.dir,'current-account.json'),JSON.stringify({account_id:this.account}),{mode:0o600});
        fs.writeFileSync(credentialFile,JSON.stringify({cookie:ctx.cookie.toJSON().cookies,imei:ctx.imei,userAgent:ctx.userAgent}),{mode:0o600});
        try{fs.unlinkSync(path.join(this.dir,'login-qr.png'));}catch{}
        this.state='connecting';
        api.listener.on('connected',()=>{if(gen!==this.generation)return;this.state='connected';this.connectionStarted=new Date().toISOString();this.backfill={state:'waiting_for_key',pages:0,received:0};});
        api.listener.on('cipher_key',()=>{if(gen!==this.generation||this.backfill.state!=='waiting_for_key')return;this.backfill.state='running';void this.fill(api,gen);});
        api.listener.on('message',m=>{if(gen===this.generation)this.store.add(m,'live');});
        api.listener.on('disconnected',()=>{if(gen===this.generation){this.state='disconnected';this.disconnectedAt=new Date().toISOString();}});
        api.listener.on('closed',code=>{if(gen===this.generation){this.state=code===3000?'connection_conflict':'disconnected';this.lastError=`SOCKET_CLOSED_${code}`;}});
        api.listener.on('error',()=>{if(gen===this.generation)this.lastError='LISTENER_ERROR';});
        api.listener.start({retryOnClose:false});
      }catch{
        if(gen===this.generation){if(!['qr_expired','login_declined'].includes(this.state))this.state='login_failed';this.lastError='LOGIN_FAILED_CHECK_STATUS_OR_RESCAN';}
      }finally{this.inflight=null;ready();}
    })();
    await Promise.race([qrReady,new Promise(r=>setTimeout(r,10000).unref())]);
    return this.status();
  }
  async fill(api,gen){
    try {
      for(const type of [0,1]){
        let cursor='1';
        for(let page=0;page<this.maxPages;page++){
          if(gen!==this.generation||this.state!=='connected')return;
          let batch;
          try{batch=await this.replay(api.listener,type,{cursor,first:page===0,timeout:this.pageTimeout});}
          catch(e){this.backfill.last_error=/^[A-Z_]+$/.test(e.message)?e.message:'REPLAY_FAILED';this.backfill.failed_types=(this.backfill.failed_types||0)+1;break;}
          if(gen!==this.generation||this.state!=='connected')return;
          this.backfill.pages++;
          for(const m of batch.messages)if(this.store.add(m,'server_backfill'))this.backfill.received++;
          if(batch.overflow)this.backfill.queue_overflow=true;
          if(!batch.more)break;
          cursor=batch.next_cursor;
          if(page===this.maxPages-1)this.backfill.page_limit_reached=true;
        }
      }
      if(gen===this.generation)this.backfill.state=this.backfill.failed_types?'partial_failure':'finished_best_effort';
    }catch{if(gen===this.generation)this.backfill.state='failed';}
  }
  startSync({days=14}={}){
    if(this.syncJob)throw new Error('SYNC_ALREADY_RUNNING');
    if(this.state!=='connected'||!this.api?.listener.cipherKey)throw new Error('SYNC_NOT_CONNECTED');
    if(this.browser.config)throw new Error('BROWSER_ATTACHED_DO_NOT_START_SECOND_SESSION');
    const api=this.api,store=this.store,gen=this.generation,controller=new AbortController();
    this.syncController=controller;this.syncState={state:'running',phase:'loading_codecs',days,received:0,complete:false,started_at:new Date().toISOString()};
    const state=this.syncState;
    this.syncJob=(async()=>{try{
      const c=await this.syncCodecs(this.dir,{signal:controller.signal});
      await this.syncTransfer(api,c,(partition,m)=>{
        if(controller.signal.aborted||gen!==this.generation)throw new Error('SYNC_CANCELLED');
        if(typeof partition!=='string'||partition.length>110||!/^oneone\/|^group\//.test(partition))throw new Error('SYNC_PARTITION_INVALID');
        if(store.add({threadId:'sync:'+partition,type:partition.startsWith('group/')?1:0,isSelf:null,data:{msgId:m.globalId&&m.globalId!=='0'?m.globalId:m.clientId,uidFrom:m.senderId,ts:m.timestamp,content:m.content,msgType:'webchat'}},'phone_sync'))state.received++;
      },progress=>{if(gen===this.generation)Object.assign(state,{phase:progress.phase,...(typeof progress.status==='number'?{phone_status:progress.status}:{}),...(typeof progress.confirmed==='boolean'?{confirmed:progress.confirmed}:{})});},{days,signal:controller.signal});
      state.state=controller.signal.aborted?'cancelled':(state.received?'finished_best_effort':'finished_empty');
    }catch(e){state.state=controller.signal.aborted?'cancelled':'failed';state.last_error=/^[A-Z_]+$/.test(e.message)?e.message:'SYNC_FAILED';}
    finally{state.finished_at=new Date().toISOString();this.syncJob=null;this.syncController=null;}})();
    return {...state};
  }
  disconnect(){this.syncController?.abort();++this.generation;this.api?.listener.stop();this.api=null;this.state='stopped';this.disconnectedAt=new Date().toISOString();if(this.backfill.state==='running')this.backfill.state='interrupted';try{fs.unlinkSync(path.join(this.dir,'login-qr.png'));}catch{}return this.status();}
  call(method,args){
    if(method==='web_connect'){if(['connected','connecting','awaiting_scan','confirming'].includes(this.state))throw new Error('STOP_LISTENER_BEFORE_WEB_CONNECT');return this.browser.connect(args);}
    if(method==='web_disconnect')return this.browser.disconnect();
    if(['web_status','web_conversations','web_history'].includes(method))return this.browser.query(method.slice(4),args);
    if(method==='sync_status')return {...this.syncState};
    if(method==='sync_mobile')return this.startSync(args);
    if(method==='sync_cancel'){this.syncController?.abort();return {...this.syncState,cancel_requested:!!this.syncJob};}
    if(method==='status')return this.status();
    if(method==='login')return this.begin(false);
    if(method==='resume')return this.begin(true);
    if(method==='disconnect')return this.disconnect();
    if(!this.store)throw new Error('NO_ACCOUNT_LOADED_LOGIN_OR_RESUME');
    if(method==='conversations')return {conversations:this.store.threads(args.limit),source:'local_cache',complete:false};
    if(method==='coverage')return this.store.coverage();
    return this.store.read(args);
  }
}
