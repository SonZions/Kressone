'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {Cloud,mqttOptions}=require('./cloud');
const transport=require('./transport');
const {parseStatus}=require('./status');
const {Commands,commandPayload}=require('./commands');
const {Feedback,partyTarget}=require('./features');
const {Maintenance}=require('./maintenance');
const logFactory=require('../logger');
const featureKeys=['party_mode','schedule_mode','schedule_enabled','schedule_paused','party_remaining_minutes','schedule','schedule_text','schedule_updated_at','features_updated_at','blade_counter_initialized','blade_since_change_minutes','blade_since_change_hours','blade_changed_at','command_result','command_text'];
const statusKeys=['battery','battery_charging','battery_voltage','battery_temp','status','status_code','mowing','at_home','error','error_code','total_time','total_distance','blade_time','total_blades','wifi_rssi','last_update','source'];
class Bridge {
  constructor(config,deps={}) {
    this.config=config;this.cloud=deps.cloud || new Cloud(config);this.io=deps.io || transport;
    this.log=logFactory(config.logLevel);this.commands=new Commands(config.prefix);
    this.feedback=new Feedback();this.lastResult=this.feedback.result;this.maintenance=new Maintenance(config.stateDir);
    this.scheduleAt=0;this.featureAt=0;this.bladeAt=0;this.errorAt=0;this.schedule=null;this.alertKey=null;this.disconnectedAt=Date.now();
    this.queue=Promise.resolve();this.sending=false;
    this.local=null;this.remote=null;this.device=null;this.lastUpdate=0;this.latest=null;
    this.stopped=false;this.blocked=null;this.attempts={local:0,cloud:0};this.next={local:0,cloud:0};
    this.fingerprint=createHash('sha256').update(config.email+'\0'+config.password).digest('hex');
  }
  topic(key) { return `${this.config.prefix}/status/${key}`; }
  async init() {
    await fs.mkdir(this.config.stateDir,{recursive:true,mode:0o700});
    await this.cloud.load();await this.maintenance.load();
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
  async result(value,event=true) {
    if(!value)return;
    this.lastResult=value;
    if(!this.local?.connected)return;
    await this.io.publish(this.local,this.topic('command_result'),JSON.stringify(value));
    const names={start:'Start',stop:'Pause',home:'Heimfahrt',refresh:'Statusabfrage',party_on:'Party an',party_off:'Party aus',schedule_pause:'Zeitplan pausieren',schedule_resume:'Zeitplan fortsetzen',blade_reset:'Messerwechsel'};
    const states={unknown:'Noch kein Befehl',sent:'Gesendet',acknowledged:'Empfangen',confirmed:'Zustand bestätigt',timeout:'Keine Bestätigung',failed:'Fehlgeschlagen',rejected:'Abgelehnt',local_completed:'Gespeichert'};
    await this.io.publish(this.local,this.topic('command_text'),`${names[value.name]||'Bridge'}: ${states[value.state]||'Unbekannt'}`);
    if(event)await this.io.publish(this.local,`${this.config.prefix}/event/command`,JSON.stringify(value),false);
  }
  async values(values) {
    if(this.local?.connected)await Promise.all(Object.entries(values).map(([k,v])=>this.io.publish(this.local,this.topic(k),v)));
  }
  async alerts(cloud,mower) {
    const now=Date.now();if(cloud)this.disconnectedAt=null;else this.disconnectedAt??=now;
    const stale=Number(!this.lastUpdate||now-this.lastUpdate>=this.config.ttl);
    const error=!stale&&this.errorAt&&now-this.errorAt<this.config.ttl?this.latest?.values.error_code:undefined;
    const code=this.blocked?'authentication':(!cloud&&now-this.disconnectedAt>=60000)?'cloud_offline':stale?'stale_data':this.feedback.failed?'command_failed':error>0?'mower_error':'none';
    const descriptions={authentication:'Kress-Anmeldung gestört',cloud_offline:'Kress-Cloud länger als 60 Sekunden getrennt',stale_data:'Keine aktuellen Mäherdaten',command_failed:'Mäherbefehl nicht bestätigt',mower_error:`Mäher meldet Fehler ${error}`,none:'Keine Störung'};
    const key=code+(code==='mower_error'?`:${error}`:'');
    const states={idle:1,idle2:1,home:2,start_seq:3,leaving_home:3,mowing:4,going_home:5,searching_home:5,follow_wire:6,searching_wire:6,searching_zone:6,cutting_edge:7,lifted:8,trapped:9,blade_blocked:9,debug:10,remote_ctrl:10};
    const alarmStates={authentication:94,cloud_offline:91,stale_data:90,command_failed:93,mower_error:92};
    const summary=alarmStates[code]??(states[this.latest?.values.status]??99);
    await this.values({alert_code:code,alert_text:descriptions[code],summary_code:summary,telemetry_age_seconds:this.lastUpdate?Math.floor((now-this.lastUpdate)/1000):-1,party_supported:Number(Boolean(this.schedule))});
    await Promise.all(Object.entries({alert_active:Number(code!=='none'),data_stale:stale,command_pending:Number(Boolean(this.feedback.pending)),command_failed:Number(this.feedback.failed),features_fresh:Number(Boolean(mower&&this.featureAt&&now-this.featureAt<this.config.ttl)),schedule_fresh:Number(Boolean(mower&&this.scheduleAt&&now-this.scheduleAt<this.config.ttl))}).map(([k,v])=>this.io.publish(this.local,this.topic(k),v,false)));
    await this.io.publish(this.local,this.topic('loxone_snapshot'),JSON.stringify(this.loxoneSnapshot(cloud,mower,summary,code,now)),false);
    if(key!==this.alertKey) {
      this.alertKey=key;
      await this.values({alert_changed_at:new Date(now).toISOString()});
      await this.io.publish(this.local,`${this.config.prefix}/event/alert`,JSON.stringify({code,active:code!=='none',text:descriptions[code],at:new Date(now).toISOString()}),false);
    }
  }
  loxoneSnapshot(cloud,mower,summary,alert,now=Date.now()) {
    const v=this.latest?.values||{};
    const field=(name,fresh=mower)=>fresh&&typeof v[name]==='number'&&Number.isFinite(v[name])?v[name]:-1;
    const features=Boolean(mower&&this.featureAt&&now-this.featureAt<this.config.ttl);
    const schedule=Boolean(mower&&this.scheduleAt&&now-this.scheduleAt<this.config.ttl);
    return {heartbeat:Math.floor(now/1000),bridge:Number(!this.stopped),cloud:Number(cloud),mower:Number(mower),summary,
      battery:field('battery'),temperature:field('battery_temp'),party:field('party_mode',features),features_fresh:Number(features),schedule_fresh:Number(schedule),
      blade_hours:field('blade_since_change_hours',mower&&v.blade_counter_initialized===1&&now-this.bladeAt<this.config.ttl),
      blade_initialized:Number(v.blade_counter_initialized===1),pending:Number(Boolean(this.feedback.pending)),failed:Number(this.feedback.failed),alert:Number(alert!=='none')};
  }
  async availability() {
    if(!this.local?.connected)return;
    const bridge=Number(!this.stopped),cloud=Number(Boolean(this.remote?.connected)&&!this.blocked&&!this.stopped);
    const mower=Number(Boolean(cloud&&this.lastUpdate&&Date.now()-this.lastUpdate<this.config.ttl));
    await this.alerts(cloud,mower);
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
    if(!Number.isFinite(timestamp)||timestamp>Date.now()+60000||timestamp<this.lastUpdate)return;
    if(source==='cloud_mqtt')await this.result(this.feedback.observe(payload,timestamp));
    const values=parseStatus(payload);if(!Object.keys(values).length)return;
    const hasTelemetry=payload?.dat && Object.keys(parseStatus({dat:payload.dat})).length>0;
    if(hasTelemetry)this.lastUpdate=timestamp;
    const sc=payload?.cfg?.sc;
    if([0,1,2].includes(sc?.m) && Number.isInteger(sc?.distm)&&sc.distm>=0) {this.schedule={m:sc.m,distm:sc.distm};this.featureAt=timestamp;values.features_updated_at=new Date(timestamp).toISOString();}
    if(values.schedule!==undefined){this.scheduleAt=timestamp;values.schedule_updated_at=new Date(timestamp).toISOString();}
    if(values.blade_time!==undefined)this.bladeAt=timestamp;
    if(values.error_code!==undefined)this.errorAt=timestamp;
    this.latest={values:{...this.latest?.values,...values},source};
    Object.assign(values,this.maintenance.values(this.device?.serial_number,this.latest.values.blade_time));
    Object.assign(this.latest.values,values);
    await this.values({...values,...(hasTelemetry?{last_update:new Date(timestamp).toISOString(),source}:{})});
    await this.availability();
  }
  async connectLocal() {
    const c=this.config;
    await this.io.close(this.local);
    this.local=await this.io.connect(c.mqttUrl,{clientId:'kressone-'+c.prefix.replaceAll('/','-'),username:c.username,password:c.mqttPassword,clean:true,reconnectPeriod:0,connectTimeout:20000,queueQoSZero:false,resubscribe:false,
      will:{topic:this.topic('bridge_online'),payload:'0',retain:true,qos:1}},c.commands?`${c.prefix}/cmd/+`:`${c.prefix}/cmd/refresh`,(topic,payload,packet)=>{
        const name=this.commands.accept(topic,payload,packet,Boolean(this.remote?.connected));
        if(this.commands.rejection)this.result(this.feedback.reject(this.commands.rejection.name,this.commands.rejection.reason)).catch(()=>{});
        if(!name || (!c.commands && name!=='refresh'))return;
        this.send(name).catch(()=>this.log.warn('Command could not be sent; it will not be retried.'));
      });
    this.local.on('close',()=>{this.next.local=0;});
    // Remove retained flags left by older bridge versions.
    for(const key of ['cloud_connected','mower_online','online']) await this.io.publish(this.local,this.topic(key),'');
    for(const key of [...statusKeys,...featureKeys]) await this.io.publish(this.local,this.topic(key),'');
    if(this.latest)await Promise.all(Object.entries({...this.latest.values,last_update:new Date(this.lastUpdate).toISOString(),source:this.latest.source}).map(([k,v])=>this.io.publish(this.local,this.topic(k),v)));
    await this.result(this.lastResult,false);
    await this.availability();this.log.info('Local MQTT connected. Motion commands '+(c.commands?'enabled':'disabled')+'.');
  }
  async send(name) {
    const reject=reason=>this.result(this.feedback.reject(name,reason));
    if(!this.config.commands&&name!=='refresh')return reject('commands_disabled');
    if(!this.remote?.connected || !this.device || this.stopped)return reject('cloud_offline');
    if(this.sending)return reject('busy');
    if(name!=='refresh'&&(!this.lastUpdate||Date.now()-this.lastUpdate>=this.config.ttl))return reject('stale_data');
    const party=partyTarget(name);
    if(party!==null&&(!this.schedule||Date.now()-this.featureAt>=this.config.ttl||this.device.protocol!==0))return reject('schedule_unavailable');
    this.sending=true;
    try {
      if(this.feedback.pending) {
        if(!['stop','home'].includes(name))return await reject('command_pending');
        await this.result(this.feedback.fail('superseded'));
      }
      if(name==='blade_reset') {
        if(!this.bladeAt||Date.now()-this.bladeAt>=this.config.ttl)return await reject('blade_telemetry_unavailable');
        const values=await this.maintenance.reset(this.device.serial_number,this.latest?.values.blade_time);
        Object.assign(this.latest.values,values);await this.values(values);
        await this.result({name,state:'local_completed',at:Date.now()});return;
      }
      const request=commandPayload(name,this.device);
      await this.result(this.feedback.begin(name,request.id));
      // QoS 0 and no offline queue: neither reconnect nor timeout replays requests.
      await this.io.publish(this.remote,this.device.mqtt_topics.command_in,JSON.stringify(request),false,0);
      this.log.info('Cloud request sent:',name);
    } catch(e) {
      await this.result(this.feedback.fail('send_failed')||this.feedback.reject(name,'local_write_failed'));
      throw e;
    } finally {this.sending=false;}
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
      try { const data=JSON.parse(payload),receivedAt=Date.now();this.queue=this.queue.then(()=>this.status(data,receivedAt)).catch(()=>this.log.warn('Status publishing interrupted.')); }
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
      await this.result(this.feedback.expire());
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
    await this.result(this.feedback.fail('bridge_stopped')).catch(()=>{});
    await this.availability().catch(()=>{});
    await Promise.all([this.io.close(this.remote),this.io.close(this.local)]);await this.health();
  }
}
module.exports={Bridge};
