'use strict';
const { randomInt } = require('node:crypto');
const codes={start:1,stop:2,home:3,refresh:0};
class Commands {
  constructor(prefix) { this.prefix=prefix; this.last=0; this.seen=new Map(); }
  accept(topic,payload,packet,connected,now=Date.now()) {
    if (!connected || packet?.retain || packet?.dup || payload.length>256) return null;
    if (!topic.startsWith(`${this.prefix}/cmd/`)) return null;
    const name=topic.slice(`${this.prefix}/cmd/`.length);
    if (!(Object.hasOwn(codes,name)) || !['1','true','ON'].includes(payload.toString().trim())) return null;
    if (now-this.last<1500 || now-(this.seen.get(name)||0)<(name==='refresh'?60000:10000)) return null;
    this.last=now;this.seen.set(name,now);return name;
  }
}
function commandPayload(name,device,now=new Date()) {
  if (!(Object.hasOwn(codes,name))) throw new Error('INVALID_COMMAND');
  const pad=n=>String(n).padStart(2,'0');
  return {id:randomInt(1024,65535),cmd:codes[name],sn:device.serial_number,
    lg:device.last_status?.payload?.cfg?.lg || 'en',
    tm:`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    dt:`${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`};
}
module.exports={Commands,commandPayload};
