'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {config}=require('../lib/config');
const {Cloud,mqttOptions}=require('../lib/cloud');
const {parseStatus}=require('../lib/status');
const {Commands,commandPayload}=require('../lib/commands');
const transport=require('../lib/transport');
const {Bridge}=require('../lib/runtime');
const env={KRESS_EMAIL:'test@example.invalid',KRESS_PASSWORD:'fixture',MQTT_URL:'mqtt://broker:1883'};
const device={protocol:0,user_id:1,serial_number:'fixture',mqtt_endpoint:'example.invalid',mqtt_topics:{command_in:'test/in',command_out:'test/out'}};
const response={access_token:'a.b.c',refresh_token:'fixture-refresh',expires_in:3600};
async function setup(t,request){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kress-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return new Cloud({...config(env),stateDir:dir},{request});}
test('configuration rejects missing credentials, wildcard topics and URL credentials',()=>{
 assert.throws(()=>config({}),/KRESS_EMAIL/);
 assert.throws(()=>config({...env,MQTT_TOPIC_PREFIX:'kress/#'}));
 assert.throws(()=>config({...env,MQTT_URL:'mqtt://user:pass@host'}));
 assert.throws(()=>config({...env,MOWER_ONLINE_TTL_SECONDS:'NaN'}));
 assert.equal(config(env).commands,false);
});
test('login stores tokens privately and coalesces parallel refresh',async t=>{
 let calls=0;const cloud=await setup(t,async()=>{calls++;return {data:response};});
 await Promise.all([cloud.ensure(),cloud.ensure(),cloud.ensure()]);assert.equal(calls,1);
 assert.ok(cloud.token.expires_at>Date.now()+3500000);
 assert.equal((await fs.stat(cloud.file)).mode&0o777,0o600);
 await cloud.ensure();assert.equal(calls,1);
});
test('failed authentication sanitized, no retries or secrets',async t=>{
 let calls=0;const cloud=await setup(t,async()=>{calls++;throw {response:{status:401,data:{error:'invalid_grant',password:'do-not-log'}}};});
 await assert.rejects(cloud.ensure(),e=>e.permanent && e.message==='CLOUD_401_invalid_grant');assert.equal(calls,1);
});
test('expired token refreshes; revoked refresh has one password fallback',async t=>{
 const grants=[];const cloud=await setup(t,async r=>{grants.push(r.data.grant_type);if(grants.length===1)throw {response:{status:400,data:{error:'invalid_grant'}}};return {data:response};});
 cloud.token={access_token:'old',refresh_token:'revoked',expires_at:1};await cloud.ensure();
 assert.deepEqual(grants,['refresh_token','password']);
});
test('valid refresh needs no password login',async t=>{
 const grants=[];const cloud=await setup(t,async r=>{grants.push(r.data.grant_type);return {data:response};});
 cloud.token={refresh_token:'valid',expires_at:1};await cloud.ensure();assert.deepEqual(grants,['refresh_token']);
});
test('Cloudflare failure cannot trigger password fallback',async t=>{
 let calls=0;const cloud=await setup(t,async()=>{calls++;throw {response:{status:403,data:{}}};});
 cloud.token={refresh_token:'fixture',expires_at:1};await assert.rejects(cloud.ensure());assert.equal(calls,1);
});
test('device selection rejects multiple or unsupported devices',async t=>{
 const cloud=await setup(t,async()=>({data:[device,device]}));cloud.token=response;await assert.rejects(cloud.discover(),/SELECT_EXACTLY/);
 cloud.http.request=async()=>({data:[{...device,protocol:1}]});await assert.rejects(cloud.discover(),/UNSUPPORTED/);
 cloud.http.request=async()=>({data:[device]});assert.equal((await cloud.discover()).protocol,0);
});
test('MQTT credentials use actual custom authorizer and never queue commands',()=>{
 const options=mqttOptions(device,{access_token:'abc.def.ghi'});
 assert.match(options.clientId,/^KR\/USER\/1\/kressone\//);assert.match(options.username,/bot\?jwt=abc.def/);
 assert.equal(options.password,undefined);assert.equal(options.queueQoSZero,false);assert.equal(options.reconnectPeriod,0);
});
test('payload parsing preserves missing fields, unknown codes and blade minutes',()=>{
 assert.deepEqual(parseStatus({dat:{bt:{}}}),{});
 const s=parseStatus({dat:{bt:{p:0,c:0},ls:900,le:999,st:{b:123,wt:456,d:789}}});
 assert.equal(s.battery,0);assert.equal(s.battery_voltage,undefined);assert.equal(s.status,'unknown_900');assert.equal(s.error,'unknown_999');assert.equal(s.blade_time,123);
 assert.deepEqual(parseStatus(null),{});
});
test('retained, duplicated, invalid, offline and repeated commands are rejected',()=>{
 const c=new Commands('kress');const t=100000;
 assert.equal(c.accept('kress/cmd/start',Buffer.from('1'),{retain:true},true,t),null);
 assert.equal(c.accept('kress/cmd/start',Buffer.from('1'),{dup:true},true,t),null);
 assert.equal(c.accept('evil/cmd/start',Buffer.from('1'),{},true,t),null);
 assert.equal(c.accept('kress/cmd/start',Buffer.from('0'),{},true,t),null);
 assert.equal(c.accept('kress/cmd/start',Buffer.from('1'),{},false,t),null);
 assert.equal(c.accept('kress/cmd/start',Buffer.from('1'),{},true,t),'start');
 assert.equal(c.accept('kress/cmd/start',Buffer.from('1'),{},true,t+2000),null);
 assert.equal(commandPayload('refresh',device).cmd,0);assert.equal(commandPayload('stop',device).cmd,2);
});
test('MQTT connect waits for successful SUBACK and rejects denied subscriptions',async()=>{
 const factory=(_url,_opts)=>{const c=new EventEmitter();c.end=()=>{};c.subscribe=(_t,_o,cb)=>cb(null,[{qos:1}]);queueMicrotask(()=>c.emit('connect'));return c;};
 assert.ok(await transport.connect('unused',{},'topic',()=>{},factory));
 const denied=()=>{const c=factory();c.subscribe=(_t,_o,cb)=>cb(null,[{qos:128}]);return c;};
 await assert.rejects(transport.connect('unused',{},'topic',()=>{},denied));
});
test('backoff is exponential, jittered and bounded',()=>{
 assert.ok(transport.backoff(2,()=>0)>transport.backoff(1,()=>0));assert.ok(transport.backoff(999,()=>1)<=1080000);
});
test('runtime reconnect, freshness expiry, auth latch and graceful shutdown',async t=>{
 const cloud=await setup(t,async()=>({data:response}));const published=[];let connections=0;
 const io={...transport,connect:async()=>{connections++;const c=new EventEmitter();c.connected=true;return c;},close:async c=>{if(c)c.connected=false;},publish:async(_c,topic,value,retain)=>published.push({topic,value,retain}),backoff:()=>1000};
 cloud.token={...response,expires_at:Date.now()+3600000};cloud.ensure=async()=>cloud.token;cloud.discover=async()=>device;
 const b=new Bridge({...cloud.config,logLevel:'silent'},{cloud,io});await b.tick();assert.equal(connections,2);
 await b.status({dat:{bt:{p:81},ls:1}},Date.now()-1000000);
 assert.equal(published.findLast(x=>x.topic.endsWith('/mower_online')).value,0);
 b.remote.connected=false;await b.tick();assert.equal(connections,3);
 await b.block('CLOUD_401_invalid_grant');assert.equal(b.blocked,'CLOUD_401_invalid_grant');
 const n=connections;await b.tick();assert.equal(connections,n);
 await b.stop();assert.equal(b.local.connected,false);
 assert.equal(published.findLast(x=>x.topic.endsWith('/bridge_online')).value,0);
 const fresh=new Bridge({...cloud.config,logLevel:'silent'},{cloud,io});await fresh.init();assert.equal(fresh.blocked,'CLOUD_401_invalid_grant');
});
test('status-only mode subscribes solely to refresh and blocks motion even if delivered',async t=>{
 const cloud=await setup(t,async()=>({data:response}));let subscription,handler;const sent=[];
 const io={...transport,connect:async(_url,_opts,topic,callback)=>{subscription=topic;handler=callback;const c=new EventEmitter();c.connected=true;return c;},close:async()=>{},publish:async()=>{}};
 const b=new Bridge({...cloud.config,commands:false,logLevel:'silent'},{cloud,io});b.remote={connected:true};b.send=async name=>sent.push(name);
 await b.connectLocal();assert.equal(subscription,'kress/cmd/refresh');
 handler('kress/cmd/start',Buffer.from('1'),{});assert.deepEqual(sent,[]);
 b.commands=new Commands('kress');handler('kress/cmd/refresh',Buffer.from('1'),{});assert.deepEqual(sent,['refresh']);
});
test('changed credentials invalidate a token cache with an identity binding',async t=>{
 const cloud=await setup(t,async()=>({data:response}));await cloud.ensure();
 const changed=new Cloud({...cloud.config,password:'changed'},{request:async()=>({data:response})});await changed.load();assert.equal(changed.token,null);
});
