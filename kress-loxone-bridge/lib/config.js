'use strict';
function config(env = process.env) {
  for (const key of ['KRESS_EMAIL', 'KRESS_PASSWORD', 'MQTT_URL']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  const url = new URL(env.MQTT_URL);
  if (!['mqtt:', 'mqtts:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid MQTT_URL; use separate credentials');
  const prefix = env.MQTT_TOPIC_PREFIX || 'kress';
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) throw new Error('Invalid MQTT_TOPIC_PREFIX');
  const ttl = Number(env.MOWER_ONLINE_TTL_SECONDS || 900);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) throw new Error('Invalid mower TTL');
  if (env.ENABLE_COMMANDS && !['true', 'false'].includes(env.ENABLE_COMMANDS)) throw new Error('Invalid ENABLE_COMMANDS');
  return { email: env.KRESS_EMAIL, password: env.KRESS_PASSWORD, mqttUrl: env.MQTT_URL,
    username: env.MQTT_USERNAME || undefined, mqttPassword: env.MQTT_PASSWORD || undefined,
    prefix, ttl: ttl * 1000, serial: env.KRESS_SERIAL_NUMBER,
    commands: env.ENABLE_COMMANDS === 'true', stateDir: env.STATE_DIR || '/state',
    logLevel: env.LOG_LEVEL || 'info' };
}
module.exports = { config };
