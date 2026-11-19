'use strict';
const { randomInt } = require('node:crypto');
const {partyTarget}=require('./features');
const codes={start:1,stop:2,home:3,refresh:0};
const names=[...Object.keys(codes),'party_on','party_off','schedule_pause','schedule_resume','blade_reset'];
class Commands {
  constructor(prefix) { this.prefix=prefix; this.last=0; this.seen=new Map(); }
  accept(topic,payload,packet,connected,now=Date.now()) {
    this.rejection=null;
    if (packet?.retain || packet?.dup || payload.length>256) return null;
    if (!topic.startsWith(`${this.prefix}/cmd/`)) return null;
    const name=topic.slice(`${this.prefix}/cmd/`.length);
    if (!names.includes(name) || !['1','true','ON'].includes(payload.toString().trim())) return null;
    if(!connected){this.rejection={name,reason:'cloud_offline'};return null;}
    const target=partyTarget(name),key=target===null?name:`party_${target}`;
    if (now-this.last<1500 || now-(this.seen.get(key)||0)<(name==='refresh'?60000:10000)) {this.rejection={name,reason:'rate_limited'};return null;}
    this.last=now;this.seen.set(key,now);return name;
  }
}
function commandPayload(name,device,now=new Date()) {
  if (!(Object.hasOwn(codes,name)) && partyTarget(name)===null) throw new Error('INVALID_COMMAND');
  const pad=n=>String(n).padStart(2,'0');
  const party=partyTarget(name);
  return {id:randomInt(1024,65535),...(party===null?{cmd:codes[name]}:{sc:{m:party?2:1,distm:0}}),sn:device.serial_number,
    lg:device.last_status?.payload?.cfg?.lg || 'en',
    tm:`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    dt:`${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`};
}
module.exports={Commands,commandPayload};
