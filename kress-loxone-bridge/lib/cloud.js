'use strict';
const axios = require('axios');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const AUTH = 'https://id.kress.com/oauth/token';
const API = 'https://api.kress-robotik.com/api/v2';
const CLIENT_ID = '931d4bc4-3192-405a-be78-98e43486dc59';
class CloudError extends Error {
  constructor(code, permanent = false) { super(code); this.permanent = permanent; }
}
class Cloud {
  constructor(config, http = axios.create({timeout:20000,maxRedirects:0})) {
    this.config=config; this.http=http; this.token=null; this.inflight=null;
    this.identity=createHash('sha256').update(config.email+'\0'+config.password).digest('hex');
    this.file=path.join(config.stateDir,'token.json');
  }
  async load() {
    try { this.token=JSON.parse(await fs.readFile(this.file,'utf8'));if(this.token.identity && this.token.identity!==this.identity)this.token=null; }
    catch (e) { if (e.code !== 'ENOENT') throw new CloudError('TOKEN_CACHE_INVALID',true); }
  }
  async request(method,url,data) {
    try {
      return (await this.http.request({method,url,data,headers:{Accept:'application/json',...(method==='post'?{'Content-Type':'application/json'}:{Authorization:`Bearer ${this.token.access_token}`})}})).data;
    } catch(e) {
      const status=e.response?.status;
      const code=e.response?.data?.error;
      const safe=['invalid_grant','invalid_client','invalid_request'].includes(code)?code:'request_failed';
      throw new CloudError(`CLOUD_${status || 'NETWORK'}_${safe}`,status>=400 && status<500 && status!==429);
    }
  }
  ensure(force=false) {
    if (this.inflight) return this.inflight;
    if (!force && this.token?.access_token && this.token.expires_at > Date.now()+120000) return Promise.resolve(this.token);
    this.inflight=this.renew().finally(()=>{this.inflight=null;});
    return this.inflight;
  }
  async renew() {
    let token;
    const base={client_id:CLIENT_ID,scope:'*'};
    if (this.token?.refresh_token) {
      try { token=await this.request('post',AUTH,{...base,grant_type:'refresh_token',refresh_token:this.token.refresh_token}); }
      catch(e) { if (!e.message.endsWith('invalid_grant')) throw e; }
    }
    if (!token) token=await this.request('post',AUTH,{...base,grant_type:'password',username:this.config.email,password:this.config.password});
    if (!token?.access_token || !token?.refresh_token || !Number.isFinite(token.expires_in) || token.expires_in<=120) throw new CloudError('TOKEN_RESPONSE_INVALID',true);
    this.token={identity:this.identity,access_token:token.access_token,refresh_token:token.refresh_token,expires_at:Date.now()+token.expires_in*1000};
    await fs.mkdir(this.config.stateDir,{recursive:true,mode:0o700});
    await fs.writeFile(this.file+'.tmp',JSON.stringify(this.token),{mode:0o600});
    await fs.rename(this.file+'.tmp',this.file);
    return this.token;
  }
  async discover() {
    const devices=await this.request('get',`${API}/product-items?status=1`);
    if (!Array.isArray(devices)) throw new CloudError('DEVICE_RESPONSE_INVALID',true);
    const matches=this.config.serial?devices.filter(d=>d.serial_number===this.config.serial):devices;
    if (matches.length!==1) throw new CloudError('SELECT_EXACTLY_ONE_DEVICE',true);
    const d=matches[0];
    if (d.protocol!==0) throw new CloudError('UNSUPPORTED_DEVICE_PROTOCOL',true);
    if (!/^[a-zA-Z0-9.-]+$/.test(d.mqtt_endpoint || '') || !d.user_id || !d.serial_number || !d.mqtt_topics?.command_in || !d.mqtt_topics?.command_out) throw new CloudError('DEVICE_MQTT_METADATA_MISSING',true);
    return d;
  }
}
function mqttOptions(device,token) {
  const parts=token.access_token.replace(/_/g,'/').replace(/-/g,'+').split('.');
  if (parts.length!==3) throw new CloudError('TOKEN_FORMAT_INVALID',true);
  // AWS custom authorizer protocol. No guessed broker, topic or client credentials.
  const enc=s=>encodeURIComponent(s).replace(/%2F/g,'/');
  return {clientId:`KR/USER/${device.user_id}/kressone/${randomUUID()}`,
    username:`bot?jwt=${enc(parts[0])}.${enc(parts[1])}&x-amz-customauthorizer-name=''&x-amz-customauthorizer-signature=${enc(parts[2])}`,
    protocolVersion:4,clean:true,keepalive:30,reconnectPeriod:0,connectTimeout:20000,queueQoSZero:false,resubscribe:false};
}
module.exports={Cloud,CloudError,mqttOptions,AUTH,API};
