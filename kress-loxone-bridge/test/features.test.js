'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {parseStatus}=require('../lib/status');
const {Feedback}=require('../lib/features');
const {Maintenance}=require('../lib/maintenance');
const {Commands,commandPayload}=require('../lib/commands');
const {Bridge}=require('../lib/runtime');
const device={protocol:0,serial_number:'fixture',mqtt_topics:{command_in:'cloud/in'}};
const days=Array.from({length:7},()=>['08:15',105,0]);
async function runtime(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kress-features-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const sent=[];const io={publish:async(_client,topic,value,retain,qos)=>sent.push({topic,value,retain,qos})};
 const b=new Bridge({stateDir:dir,logLevel:'silent',email:'fixture',password:'fixture',prefix:'kress',commands:true,ttl:900000},{cloud:{},io});
 b.local={connected:true};b.remote={connected:true};b.device=device;
 return {b,sent};
}
test('party writes contain only sc mode and timer, never cached schedules or motion',()=>{
 for(const [name,m] of [['party_on',2],['party_off',1],['schedule_pause',2],['schedule_resume',1]]) {
  const p=commandPayload(name,{...device,last_status:{payload:{cfg:{sc:{d:days,p:50}}}}});
  assert.deepEqual(p.sc,{m,distm:0});assert.equal(p.cmd,undefined);assert.equal(p.sc.d,undefined);
 }
 assert.throws(()=>commandPayload('blade_reset',device));
});
test('party commands retain pulse semantics and reject retained, duplicate, offline, unknown and false',()=>{
 for(const name of ['party_on','party_off','schedule_pause','schedule_resume','blade_reset']) {
  const c=new Commands('kress'),topic=`kress/cmd/${name}`,p=Buffer.from('1');
  assert.equal(c.accept(topic,p,{retain:true},true,100000),null);
  assert.equal(c.accept(topic,p,{dup:true},true,100000),null);
  assert.equal(c.accept(topic,Buffer.from('false'),{},true,100000),null);
  assert.equal(c.accept(topic,p,{},false,100000),null);
  assert.equal(c.accept(topic,p,{},true,100000),name);
  assert.equal(c.accept(topic,p,{},true,102000),null);
 }
});
test('schedule reads preserve both daily slots and explicit unknown values',()=>{
 const p=parseStatus({cfg:{sc:{m:2,distm:0,d:days,dd:days}}});
 assert.equal(p.party_mode,1);assert.equal(p.schedule_enabled,0);assert.equal(JSON.parse(p.schedule)[0].slots.length,2);
 assert.equal(JSON.parse(p.schedule)[0].day,'sun');assert.match(p.schedule_text,/sun: 08:15\/105min/);
 assert.equal(parseStatus({cfg:{sc:{m:1,distm:0}}}).party_mode,0);
 assert.equal(parseStatus({cfg:{sc:{m:0,distm:20}}}).party_mode,1);
 assert.equal(parseStatus({cfg:{sc:{m:0,distm:0}}}).schedule_enabled,1);
 assert.equal(parseStatus({cfg:{sc:{m:0}}}).party_mode,undefined);
 assert.equal(parseStatus({cfg:{sc:{m:99,d:[['bad',2,0]]}}}).schedule,undefined);
 assert.deepEqual(parseStatus({cfg:{}}),{});
});
test('feedback requires correlated receipt and state, expires and does not invent physical confirmation',()=>{
 const f=new Feedback();f.begin('party_on',123,1000);
 assert.equal(f.observe({cfg:{id:999,sc:{m:2,distm:0}}},2000),null);
 assert.equal(f.observe({cfg:{id:123}},2000).state,'acknowledged');
 assert.equal(f.observe({cfg:{sc:{m:2,distm:0}}},3000).state,'confirmed');assert.equal(f.pending,null);
 f.begin('start',124,4000);assert.equal(f.observe({cfg:{id:124},dat:{ls:1}},5000).state,'acknowledged');
 assert.equal(f.expire(64000).state,'timeout');assert.equal(f.failed,true);
 f.begin('refresh',125,65000);assert.equal(f.observe({cfg:{id:125,sc:{m:1}}},66000).state,'acknowledged');
 assert.equal(f.observe({dat:{ls:1}},67000).state,'confirmed');
});
test('blade baseline persists privately and never invents a last replacement date',async t=>{
 const {b}=await runtime(t),m=b.maintenance;
 assert.equal(m.values('fixture',100).blade_counter_initialized,0);
 assert.equal(m.values('fixture',100).blade_since_change_minutes,'');
 await m.reset('fixture',100,1000);assert.equal(m.values('fixture',160).blade_since_change_hours,1);
 assert.equal(m.values('other',160).blade_counter_initialized,0);
 assert.equal(m.values('fixture',90).blade_counter_initialized,0);
 const again=new Maintenance(b.config.stateDir);await again.load();assert.equal(again.values('fixture',160).blade_since_change_minutes,60);
 assert.equal((await fs.stat(m.file)).mode&0o777,0o600);
});
test('runtime rejects stale/unsupported party writes; fresh reported config is confirmed without motion',async t=>{
 const {b,sent}=await runtime(t);
 await b.send('party_on');assert.equal(JSON.parse(sent.findLast(x=>x.topic.endsWith('/command_result')).value).reason,'stale_data');
 await b.status({dat:{ls:1,le:0,st:{b:100}}});await b.send('party_on');
 assert.equal(JSON.parse(sent.findLast(x=>x.topic.endsWith('/command_result')).value).reason,'schedule_unavailable');
 await b.status({cfg:{sc:{m:1,distm:0,d:days}}});await b.send('party_on');
 const request=JSON.parse(sent.find(x=>x.topic==='cloud/in').value);assert.deepEqual(request.sc,{m:2,distm:0});
 await b.status({cfg:{id:request.id,sc:{m:2,distm:0}}});assert.equal(b.feedback.result.state,'confirmed');
 assert.equal(sent.findLast(x=>x.topic==='kress/status/party_mode').value,1);
 assert.equal(sent.filter(x=>x.topic==='cloud/in').length,1);
});
test('cfg-only messages cannot freshen telemetry and API cache cannot confirm requests',async t=>{
 const {b}=await runtime(t),old=Date.now()-1000000;
 await b.status({dat:{ls:1,le:0}},old);b.feedback.begin('party_on',123);
 await b.status({cfg:{id:123,sc:{m:2,distm:0}}},Date.now(),'cloud_api_cache');
 assert.equal(b.lastUpdate,old);assert.equal(b.feedback.result.state,'sent');
});
test('reset changes local baseline only and rejects stale blade telemetry',async t=>{
 const {b,sent}=await runtime(t);await b.status({dat:{ls:1,st:{b:123}}});
 await b.send('blade_reset');assert.equal(sent.filter(x=>x.topic==='cloud/in').length,0);
 assert.equal(sent.findLast(x=>x.topic.endsWith('/blade_since_change_minutes')).value,0);
 b.bladeAt=1;await b.send('blade_reset');assert.equal(JSON.parse(sent.findLast(x=>x.topic.endsWith('/command_result')).value).reason,'blade_telemetry_unavailable');
});
test('alerts distinguish stale data from historical mower errors and emit events only on transitions',async t=>{
 const {b,sent}=await runtime(t);await b.status({dat:{ls:0,le:11}},Date.now()-1000000);
 assert.equal(sent.findLast(x=>x.topic.endsWith('/alert_code')).value,'stale_data');
 const n=sent.filter(x=>x.topic==='kress/event/alert').length;await b.availability();assert.equal(sent.filter(x=>x.topic==='kress/event/alert').length,n);
 await b.status({dat:{ls:0,le:11}});assert.equal(sent.findLast(x=>x.topic.endsWith('/alert_code')).value,'mower_error');
 await b.status({dat:{ls:0,le:0}});assert.equal(sent.findLast(x=>x.topic.endsWith('/summary_code')).value,1);
 assert.equal(sent.findLast(x=>x.topic.endsWith('/alert_active')).retain,false);
});
test('disabled writes never dispatch; pending command blocks another write and stop can supersede',async t=>{
 const {b,sent}=await runtime(t);await b.status({dat:{ls:1,le:0},cfg:{sc:{m:1,distm:0}}});
 b.config.commands=false;await b.send('party_on');assert.equal(sent.filter(x=>x.topic==='cloud/in').length,0);
 b.config.commands=true;await b.send('party_on');await b.send('party_off');assert.equal(sent.filter(x=>x.topic==='cloud/in').length,1);
 await b.send('stop');assert.equal(sent.filter(x=>x.topic==='cloud/in').length,2);assert.equal(b.feedback.pending.name,'stop');
});
test('send failure never retries and explicit concurrent commands cannot overlap',async t=>{
 const {b,sent}=await runtime(t);await b.status({dat:{ls:1,le:0},cfg:{sc:{m:1,distm:0}}});
 const publish=b.io.publish;let release;
 b.io.publish=async(c,topic,value,retain,qos)=>{
  if(topic==='cloud/in')await new Promise(r=>{release=r;});
  await publish(c,topic,value,retain,qos);
 };
 const first=b.send('party_on');
 while(!release)await new Promise(r=>setImmediate(r));
 await b.send('party_off');assert.equal(b.lastResult.reason,'busy');release();await first;
 assert.equal(sent.filter(x=>x.topic==='cloud/in').length,1);
 b.feedback.pending=null;b.io.publish=async(c,topic,...args)=>{if(topic==='cloud/in')throw new Error('socket closed');return publish(c,topic,...args);};
 await assert.rejects(b.send('party_off'));assert.equal(b.feedback.result.state,'failed');assert.equal(b.sending,false);
});
