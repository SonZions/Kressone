'use strict';
const statuses = { 0:'idle',1:'home',2:'start_seq',3:'leaving_home',4:'follow_wire',5:'searching_home',6:'searching_wire',7:'mowing',8:'lifted',9:'trapped',10:'blade_blocked',11:'debug',12:'remote_ctrl',30:'going_home',32:'cutting_edge',33:'idle2',34:'searching_zone' };
const errors = { 0:'none',1:'trapped',2:'lifted',3:'wire_missing',4:'outside_wire',5:'rain_delay',6:'close_door_to_cut',7:'close_door_to_home',8:'blade_motor_fault',9:'wheel_motor_fault',10:'trapped_timeout',11:'upside_down',12:'battery_low',13:'wire_reversed',14:'charge_error',15:'home_search_timeout',16:'wifi_locked',17:'battery_over_temperature' };
function parseStatus(payload) {
  const d = payload?.dat;
  if (!d || typeof d !== 'object') return {};
  const out = {};
  const add = (key, value) => { if (typeof value === 'number' && Number.isFinite(value)) out[key] = value; };
  add('battery', d.bt?.p); add('battery_voltage', d.bt?.v); add('battery_temp', d.bt?.t);
  if ([0,1,false,true].includes(d.bt?.c)) out.battery_charging = Number(Boolean(d.bt.c));
  if (Number.isInteger(d.ls)) Object.assign(out, {status_code:d.ls,status:statuses[d.ls] || `unknown_${d.ls}`,mowing:Number(d.ls===7),at_home:Number(d.ls===1)});
  if (Number.isInteger(d.le)) Object.assign(out, {error_code:d.le,error:errors[d.le] || `unknown_${d.le}`});
  add('total_time',d.st?.wt); add('total_distance',d.st?.d);
  add('blade_time',d.st?.b); add('total_blades',d.st?.b); add('wifi_rssi',d.rsi);
  return out;
}
module.exports = { parseStatus };
