'use strict';
const mqtt=require('mqtt');
function connect(url,options,topic,onMessage=()=>{}, factory=mqtt.connect) {
  return new Promise((resolve,reject)=>{
    const c=factory(url,options);
    let settled=false;
    const timer=setTimeout(()=>fail(),25000);
    function fail() { if (settled) return;settled=true;clearTimeout(timer);c.end(true);reject(new Error('MQTT_CONNECT_FAILED')); }
    c.on('error',fail); c.once('close',fail);c.on('message',onMessage);
    c.once('connect',()=>{
      const done=(err,grants)=>{
        if (err || grants?.some(g=>g.qos===128)) return fail();
        if (settled) return;settled=true;clearTimeout(timer);resolve(c);
      };
      if (topic) c.subscribe(topic,{qos:1},done);else done();
    });
  });
}
function publish(client,topic,value,retain=true,qos=1) {
  if (!client?.connected) return Promise.reject(new Error('MQTT_OFFLINE'));
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('MQTT_PUBLISH_TIMEOUT')),10000);
    client.publish(topic,String(value),{retain,qos},err=>{clearTimeout(timer);err?reject(new Error('MQTT_PUBLISH_FAILED')):resolve();});
  });
}
async function close(client) {
  if (!client) return;
  await new Promise(resolve=>{
    const timer=setTimeout(()=>{client.end(true);resolve();},2000);
    client.end(false,{},()=>{clearTimeout(timer);resolve();});
  });
}
function backoff(attempt,random=Math.random) { return Math.min(900000,5000*2**Math.min(attempt,8)*(0.8+random()*0.4)); }
module.exports={connect,publish,close,backoff};
