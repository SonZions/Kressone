'use strict';
const dns=require('node:dns/promises');
const tls=require('node:tls');
const {randomUUID}=require('node:crypto');
const {config}=require('./lib/config');
const {Cloud,mqttOptions}=require('./lib/cloud');
const io=require('./lib/transport');
const {parseStatus}=require('./lib/status');
const {commandPayload}=require('./lib/commands');
async function diagnose() {
  const report=Object.fromEntries(['DNS','HTTPS','OAuth','Token','Devices','Cloud MQTT','Subscribe','Status received','Local MQTT','MQTT publish','MQTT receive'].map(k=>[k,'SKIPPED']));
  let local,remote,stage='DNS';
  try {
    const c=config(),cloud=new Cloud(c);await cloud.load();
    await Promise.all(['id.kress.com','api.kress-robotik.com'].map(h=>dns.lookup(h)));report.DNS='PASS';stage='HTTPS';
    await new Promise((resolve,reject)=>{const s=tls.connect({host:'id.kress.com',port:443,servername:'id.kress.com'},()=>{s.end();resolve();});s.setTimeout(15000,()=>s.destroy(new Error('TLS_TIMEOUT')));s.on('error',()=>reject(new Error('TLS_FAILED')));});
    report.HTTPS='PASS';stage='OAuth';await cloud.ensure();report.OAuth='PASS';report.Token='PASS';
    stage='Devices';const d=await cloud.discover();report.Devices='PASS';
    // Values here are historical cloud API data, never presented as new MQTT data.
    report.api_snapshot=parseStatus(d.last_status?.payload);report.api_timestamp=d.last_status?.timestamp;
    stage='Local MQTT';const topic=`${c.prefix}/diagnostics/${randomUUID()}`;const nonce=randomUUID();
    let resolveEcho;const echo=new Promise(r=>{resolveEcho=r;});
    local=await io.connect(c.mqttUrl,{clientId:`kress-diagnose-${randomUUID()}`,username:c.username,password:c.mqttPassword,clean:true,reconnectPeriod:0,connectTimeout:15000,queueQoSZero:false},topic,(t,p)=>{if(t===topic&&p.toString()===nonce)resolveEcho();});report['Local MQTT']='PASS';
    stage='MQTT publish';await io.publish(local,topic,nonce,false);report['MQTT publish']='PASS';
    stage='MQTT receive';await timeout(echo,10000);report['MQTT receive']='PASS';
    stage='Cloud MQTT';let resolveStatus;const status=new Promise(r=>{resolveStatus=r;});
    remote=await io.connect(`wss://${d.mqtt_endpoint}/mqtt`,mqttOptions(d,cloud.token),d.mqtt_topics.command_out,(_t,p,packet)=>{
      if(packet.retain || p.length>262144)return;
      try {const v=parseStatus(JSON.parse(p));if(Object.keys(v).length)resolveStatus(v);}catch{}
    });report['Cloud MQTT']='PASS';report.Subscribe='PASS';stage='Status received';
    // Read-only cmd 0: requests status; never sends start/stop/home or configuration.
    await io.publish(remote,d.mqtt_topics.command_in,JSON.stringify(commandPayload('refresh',d)),false,0);
    report.mqtt_status=await timeout(status,60000);report['Status received']='PASS';
    report.result='SUCCESS';
  } catch(e) {report[stage]='FAIL';report.result='FAIL';report.error=/^(CLOUD_|TOKEN_|DEVICE_|SELECT_|UNSUPPORTED_)/.test(e.message)?e.message:'TEST_FAILED_OR_TIMEOUT';process.exitCode=1;}
  finally {await Promise.all([io.close(local),io.close(remote)]);console.log(JSON.stringify(report,null,2));}
}
function timeout(p,ms){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('TIMEOUT')),ms);p.then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});}
diagnose();
