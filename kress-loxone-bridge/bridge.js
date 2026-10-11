'use strict';
const {config}=require('./lib/config');
const {Bridge}=require('./lib/runtime');
async function main() {
  const bridge=new Bridge(config());
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;const deadline=setTimeout(()=>process.exit(0),30000);await bridge.stop();clearTimeout(deadline);process.exit(0);};
  process.on('SIGTERM',()=>stop().catch(()=>process.exit(1)));
  process.on('SIGINT',()=>stop().catch(()=>process.exit(1)));
  process.on('SIGHUP',()=>bridge.reconnect().catch(()=>console.error('Reconnect failed; maintenance will retry.')));
  await bridge.start();
}
main().catch(()=>{console.error('Bridge startup failed; validate configuration and state permissions.');process.exitCode=1;});
