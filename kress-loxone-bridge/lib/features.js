'use strict';
// Protocol 0 schedule fields only. Never copy an entire cached schedule into a write.
function parseFeatures(payload) {
  const s=payload?.cfg?.sc,out={};
  if (!s || typeof s!=='object' || Array.isArray(s)) return out;
  if ([0,1,2].includes(s.m)) {
    out.schedule_mode=s.m;
    if (s.m===2 || s.m===1 || Number.isFinite(s.distm)) {
      out.party_mode=Number(s.m===2 || (s.m===0 && s.distm>0));
      out.schedule_paused=out.party_mode;
      out.schedule_enabled=Number(s.m===1 || (s.m===0 && s.distm===0));
    }
  }
  if (Number.isInteger(s.distm) && s.distm>=0) out.party_remaining_minutes=s.distm;
  const valid=days=>Array.isArray(days)&&days.length===7&&days.every(d=>Array.isArray(d)&&d.length===3&&/^([01]\d|2[0-3]):[0-5]\d$/.test(d[0])&&Number.isInteger(d[1])&&d[1]>=0&&d[1]<=1440&&[0,1].includes(d[2]));
  if (valid(s.d) && (s.dd===undefined || valid(s.dd))) {
    const days=['sun','mon','tue','wed','thu','fri','sat'];
    const schedule=days.map((day,i)=>({day,slots:[s.d[i],...(s.dd?[s.dd[i]]:[])].map(([start,minutes,border])=>({start,minutes,border:Boolean(border)}))}));
    out.schedule=JSON.stringify(schedule);
    out.schedule_text=schedule.map(d=>`${d.day}: ${d.slots.filter(s=>s.minutes>0).map(s=>`${s.start}/${s.minutes}min${s.border?' +edge':''}`).join(', ')||'off'}`).join('; ');
  }
  return out;
}
function partyTarget(name) {
  if (['party_on','schedule_pause'].includes(name)) return 1;
  if (['party_off','schedule_resume'].includes(name)) return 0;
  return null;
}
function matches(name,payload) {
  const party=partyTarget(name);
  if (party!==null) {
    const f=parseFeatures(payload);
    return f.party_mode===party && f.schedule_mode===(party?2:1) && f.party_remaining_minutes===0;
  }
  const state=payload?.dat?.ls;
  if (name==='start') return [2,3,7,32].includes(state);
  if (name==='stop') return [0,33].includes(state);
  if (name==='home') return [1,5,30].includes(state);
  return name==='refresh' && payload?.dat && typeof payload.dat==='object' && Object.keys(payload.dat).length>0;
}
// An echoed ID is receipt evidence; only a matching reported state confirms the result.
class Feedback {
  constructor() {this.pending=null;this.result={state:'unknown',reason:'bridge_started',at:Date.now()};this.failed=false;}
  begin(name,id,now=Date.now()) {
    this.pending={name,id,sent:now,ack:false};this.failed=false;
    this.result={name,id,state:'sent',at:now};return this.result;
  }
  reject(name,reason,now=Date.now()) {return {name,state:'rejected',reason,at:now};}
  fail(reason,now=Date.now()) {
    if (!this.pending) return null;
    const {name,id}=this.pending;this.pending=null;this.failed=true;
    return this.result={name,id,state:reason==='timeout'?'timeout':'failed',reason,at:now};
  }
  observe(payload,now=Date.now()) {
    const p=this.pending;if(!p || now<p.sent)return null;
    if(now-p.sent>=60000)return this.fail('timeout',now);
    const correlated=payload?.cfg?.id===p.id;
    if(correlated)p.ack=true;
    if(p.ack && matches(p.name,payload)) {
      this.pending=null;this.failed=false;
      return this.result={name:p.name,id:p.id,state:'confirmed',at:now};
    }
    if(correlated && this.result.state!=='acknowledged')return this.result={name:p.name,id:p.id,state:'acknowledged',at:now};
    return null;
  }
  expire(now=Date.now()) {return this.pending&&now-this.pending.sent>=60000?this.fail('timeout',now):null;}
}
module.exports={parseFeatures,partyTarget,Feedback};
