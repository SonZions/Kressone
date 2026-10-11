'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {Cloud,mqttOptions}=require('./cloud');
const transport=require('./transport');
const {parseStatus}=require('./status');
const {Commands,commandPayload}=require('./commands');
const logFactory=require('../logger');
const statusKeys=['battery','battery_charging','battery_voltage','battery_temp','status','status_code','mowing','at_home','error','error_code','total_time','total_distance','blade_time','total_blades','wifi_rssi','last_update','source'];
class Bridge {
  constructor(config,deps={}) {
    this.config=config;this.cloud=deps.cloud || new Cloud(config);this.io=deps.io || transport;
    this.log=logFactory(config.logLevel);this.commands=new Commands(config.prefix);
    this.local=null;this.remote=null;this.device=null;this.lastUpdate=0;this.latest=null;
    this.stopped=false;this.blocked=null;this.attempts={local:0,cloud:0};this.next={local:0,cloud:0};
    this.fingerprint=createHash('sha256').update(config.email+'\0'+config.password).digest('hex');
  }
  topic(key) { return `${this.config.prefix}/status/${key}`; }
  async init() {
    await fs.mkdir(this.config.stateDir,{recursive:true,mode:0o700});
    await this.cloud.load();
    try {
      const b=JSON.parse(await fs.readFile(path.join(this.config.stateDir,'auth-blocked.json'),'utf8'));
      if(b.fingerprint===this.fingerprint)this.blocked=b.code;
    } catch(e) { if(e.code!=='ENOENT')throw new Error('AUTH_LATCH_INVALID',{cause:e}); }
  }
  async block(code) {
    this.blocked=code;
    await fs.writeFile(path.join(this.config.stateDir,'auth-blocked.json'),JSON.stringify({fingerprint:this.fingerprint,code}),{mode:0o600});
    await this.io.close(this.remote);this.remote=null;
    this.log.error('Cloud authentication/configuration blocked; see health status. No automatic login retries.');
  }
  async availability() {
    if(!this.local?.connected)return;
    const bridge=Number(!this.stopped),cloud=Number(Boolean(this.remote?.connected)&&!this.blocked&&!this.stopped);
    const mower=Number(Boolean(cloud&&this.lastUpdate&&Date.now()-this.lastUpdate<this.config.ttl));
    await Promise.all([
      this.io.publish(this.local,this.topic('bridge_online'),bridge),
      this.io.publish(this.local,this.topic('availability'),JSON.stringify({bridge,cloud,mower,at:new Date().toISOString()})),
      // Non-retained: a stale cloud/mower flag must never be replayed to a new consumer.
      this.io.publish(this.local,this.topic('cloud_connected'),cloud,false),
      this.io.publish(this.local,this.topic('mower_online'),mower,false),
      this.io.publish(this.local,this.topic('online'),mower,false)
    ]);
  }
  async status(payload,timestamp=Date.now(),source='cloud_mqtt') {
    const values=parseStatus(payload);
    if(!Object.keys(values).length)return;
    if(!Number.isFinite(timestamp)||timestamp>Date.now()+60000)return;
    if(timestamp<this.lastUpdate)return;
    this.lastUpdate=timestamp;this.latest={values,source};
    if(this.local?.connected) {
      await Promise.all(Object.entries({...values,last_update:new Date(timestamp).toISOString(),source}).map(([k,v])=>this.io.publish(this.local,this.topic(k),v)));
      await this.availability();
    }
  }
  async connectLocal() {
    const c=this.config;
    await this.io.close(this.local);
    this.local=await this.io.connect(c.mqttUrl,{clientId:'kressone-'+c.prefix.replaceAll('/','-'),username:c.username,password:c.mqttPassword,clean:true,reconnectPeriod:0,connectTimeout:20000,queueQoSZero:false,resubscribe:false,
      will:{topic:this.topic('bridge_online'),payload:'0',retain:true,qos:1}},c.commands?`${c.prefix}/cmd/+`:`${c.prefix}/cmd/refresh`,(topic,payload,packet)=>{
        const name=this.commands.accept(topic,payload,packet,Boolean(this.remote?.connected));
        if(!name || (!c.commands && name!=='refresh'))return;
        this.send(name).catch(()=>this.log.warn('Command could not be sent; it will not be retried.'));
      });
    this.local.on('close',()=>{this.next.local=0;});
    // Remove retained flags left by older bridge versions.
    for(const key of ['cloud_connected','mower_online','online']) await this.io.publish(this.local,this.topic(key),'');
    for(const key of statusKeys) await this.io.publish(this.local,this.topic(key),'');
    if(this.latest)await Promise.all(Object.entries({...this.latest.values,last_update:new Date(this.lastUpdate).toISOString(),source:this.latest.source}).map(([k,v])=>this.io.publish(this.local,this.topic(k),v)));
    await this.availability();this.log.info('Local MQTT connected. Motion commands '+(c.commands?'enabled':'disabled')+'.');
  }
  async send(name) {
    if(!this.remote?.connected || !this.device)throw new Error('CLOUD_OFFLINE');
    // QoS 0 plus queueQoSZero=false deliberately prevents replay after reconnect.
    await this.io.publish(this.remote,this.device.mqtt_topics.command_in,JSON.stringify(commandPayload(name,this.device)),false,0);
    this.log.info('Cloud request sent:',name);
  }
  async connectCloud() {
    const previous=this.cloud.token?.access_token;
    await this.cloud.ensure();
    if(!this.device)this.device=await this.cloud.discover();
    if(this.remote?.connected && previous===this.cloud.token.access_token)return;
    await this.io.close(this.remote);this.remote=null;
    const d=this.device;
    this.remote=await this.io.connect(`wss://${d.mqtt_endpoint}/mqtt`,mqttOptions(d,this.cloud.token),d.mqtt_topics.command_out,(_topic,payload,packet)=>{
      if(packet.retain || payload.length>262144)return;
      try { const data=JSON.parse(payload);this.status(data).catch(()=>this.log.warn('Status publishing interrupted.')); }
      catch { this.log.warn('Invalid cloud payload ignored.'); }
    });
    this.remote.on('close',()=>{this.next.cloud=0;this.availability().catch(()=>{});});
    if(!this.lastUpdate && d.last_status?.payload) {
      const date=d.last_status.timestamp;
      const ts=Date.parse(typeof date==='string' && !/(?:Z|[+-]\d\d:\d\d)$/.test(date)?date.replace(' ','T')+'Z':date);
      await this.status(d.last_status.payload,ts,'cloud_api_cache');
    }
    await this.availability();this.log.info('Cloud MQTT connected and subscribed.');
  }
  async tick() {
    if(this.busy||this.stopped)return;this.busy=true;
    try {
      if(this.remote?.connected && this.cloud.token?.expires_at<=Date.now()) {await this.io.close(this.remote);this.remote=null;}
      for(const kind of ['local','cloud']) {
        if(this.stopped)break;
        const client=kind==='local'?this.local:this.remote;
        const needs=kind==='cloud' && this.cloud.token?.expires_at<Date.now()+120000;
        if((client?.connected&&!needs)||Date.now()<this.next[kind]||(kind==='cloud'&&this.blocked))continue;
        try {
          if(kind==='local')await this.connectLocal();else await this.connectCloud();
          this.attempts[kind]=0;
        } catch(e) {
          if(kind==='cloud' && e.permanent)await this.block(e.message);
          else {this.next[kind]=Date.now()+this.io.backoff(++this.attempts[kind]);this.log.warn(`${kind} connection unavailable; bounded backoff active.`);}
        }
      }
      if(!this.stopped)await this.availability().catch(()=>{});
    } finally {this.busy=false;await this.health();}
  }
  async health() {
    const data={at:Date.now(),local:Boolean(this.local?.connected),cloud:Boolean(this.remote?.connected),auth_error:this.blocked,stopped:this.stopped,last_update:this.lastUpdate};
    await fs.writeFile('/tmp/kress-health.json.tmp',JSON.stringify(data));await fs.rename('/tmp/kress-health.json.tmp','/tmp/kress-health.json');
  }
  async reconnect() {
    while(this.busy)await new Promise(r=>setTimeout(r,50));
    if(this.stopped)return;
    this.busy=true;
    try {await Promise.all([this.io.close(this.remote),this.io.close(this.local)]);this.remote=null;this.local=null;this.next={local:0,cloud:0};}
    finally {this.busy=false;}
    await this.tick();
  }
  async start() {await this.init();await this.tick();this.timer=setInterval(()=>this.tick().catch(()=>this.log.error('Bridge maintenance failed.')),10000);}
  async stop() {
    this.stopped=true;clearInterval(this.timer);
    // Wait for in-flight connection setup before final shutdown (bounded by main's deadline).
    while(this.busy)await new Promise(r=>setTimeout(r,50));
    await this.availability().catch(()=>{});
    await Promise.all([this.io.close(this.remote),this.io.close(this.local)]);await this.health();
  }
}
module.exports={Bridge};
