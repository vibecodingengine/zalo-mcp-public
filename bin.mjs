#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {dataDir,rpc,ensureDaemon} from './runtime.mjs';
const [command,arg]=process.argv.slice(2);
async function main(){
  if(!command||['help','--help'].includes(command)){
    console.log(`Zalo Read-only MCP (experimental)\n\nRequires Node.js 22.16+\n\nzalo-readonly web-connect '{"endpoint":"http://127.0.0.1:9222"}'\nzalo-readonly web_conversations '{"limit":20}'\nzalo-readonly web_history '{"thread_id":"CONTACT_ID","limit":50}'\nzalo-readonly web-disconnect        Forget attached browser (leave it running)\nzalo-readonly login                Show a fresh QR PNG path (scan with Zalo)\nzalo-readonly resume               Reuse this machine's saved login\nzalo-readonly status               Connection and history coverage\nzalo-readonly conversations '{"limit":20}'\nzalo-readonly history '{"thread_id":"CONTACT_ID","limit":50}'\nzalo-readonly search '{"query":"hello"}'\nzalo-readonly events '{"after":0,"limit":50}'\nzalo-readonly coverage\nzalo-readonly sync-mobile '{"days":14}'  Phone-confirmed text restore (existing connection)\nzalo-readonly sync-status            Poll restore progress\nzalo-readonly sync-cancel            Cancel restore, retain saved records\nzalo-readonly disconnect           Stop Zalo connection, retain cache\nzalo-readonly shutdown             Stop local daemon\nzalo-readonly config               Print MCP config\nzalo-readonly mcp                  Run MCP stdio\n\nData: ${dataDir}\nNo sending, read receipts or attachment downloads. Phone history: sync-mobile (experimental); docs/HISTORY.md`);return;
  }
  if(command==='--version'){console.log('0.3.0');return;}
  if(command==='mcp'){await import('./mcp.mjs');return;}
  if(command==='config'){console.log(JSON.stringify({mcpServers:{zalo:{command:process.execPath,args:[fileURLToPath(new URL('./mcp.mjs',import.meta.url))],env:{ZALO_READONLY_DATA_DIR:dataDir}}}},null,2));return;}
  if(command==='import-history'){const {importHistory}=await import('./import-history.mjs');console.log(JSON.stringify(await importHistory(JSON.parse(arg||'{}')),null,2));return;}
  const aliases={'sync-mobile':'sync_mobile','sync-status':'sync_status','sync-cancel':'sync_cancel','web-connect':'web_connect','web-disconnect':'web_disconnect'};
  const method=Object.hasOwn(aliases,command)?aliases[command]:command;
  if(['start','login','resume','web_connect'].includes(method))await ensureDaemon();
  console.log(JSON.stringify(await rpc(method==='start'?'status':method,arg?JSON.parse(arg):{}),null,2));
}
main().catch(e=>{console.error(/^[A-Z_]+$/.test(e.message)?e.message:'COMMAND_FAILED_CHECK_STATUS_OR_LOCAL_LOG');process.exitCode=1;});
