'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const key=serial=>createHash('sha256').update(serial).digest('hex');
class Maintenance {
  constructor(dir) {this.file=path.join(dir,'maintenance.json');this.baseline=null;}
  async load() {
    try {
      const b=JSON.parse(await fs.readFile(this.file,'utf8'));
      if(typeof b.device!=='string'||!Number.isFinite(b.minutes)||b.minutes<0||!Number.isFinite(b.at))throw new Error('INVALID_MAINTENANCE_STATE');
      this.baseline=b;
    } catch(e) {if(e.code!=='ENOENT')throw new Error('INVALID_MAINTENANCE_STATE',{cause:e});}
  }
  values(serial,minutes) {
    const b=this.baseline,valid=Boolean(b && serial && b.device===key(serial) && Number.isFinite(minutes) && minutes>=b.minutes);
    return {blade_counter_initialized:Number(valid),blade_since_change_minutes:valid?minutes-b.minutes:'',blade_since_change_hours:valid?Math.round((minutes-b.minutes)/60*100)/100:'',blade_changed_at:b&&serial&&b.device===key(serial)?new Date(b.at).toISOString():''};
  }
  async reset(serial,minutes,now=Date.now()) {
    if(!serial||!Number.isFinite(minutes)||minutes<0)throw new Error('NO_BLADE_TELEMETRY');
    const b={device:key(serial),minutes,at:now};
    await fs.writeFile(this.file+'.tmp',JSON.stringify(b),{mode:0o600});await fs.rename(this.file+'.tmp',this.file);this.baseline=b;
    return this.values(serial,minutes);
  }
}
module.exports={Maintenance};
