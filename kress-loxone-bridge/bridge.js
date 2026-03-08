'use strict';

const mqtt = require('mqtt');
const axios = require('axios');
const { randomUUID } = require('crypto'); // built-in since Node 14.17 – no uuid dep needed

const config = require('./config.json');
const log = require('./logger')(config.logLevel || 'info');

// ─── Kress / Worx Cloud constants ────────────────────────────────────────────
const CLOUD = {
  kress: {
    tokenUrl:     'https://id.kress.com/oauth/token',
    apiBase:      'https://api.kress.com/api/v1',
    mqttPrefix:   'kress',
    clientId:     'kress_m_series',
    clientSecret: '5YAIqmqbpuoLPIaRGKcHQi15gDDkYN0OaA5YEsRuqM8=',
  },
};

const cloud = CLOUD[config.cloud.type] || CLOUD.kress;

// ─── Module-level state ───────────────────────────────────────────────────────
let accessToken  = null;
let mqttClient   = null;   // Cloud MQTT client
let localMqtt    = null;   // Local broker client
let deviceArray  = [];
let cloudTopicIn = null;   // Topic to send commands TO the mower
let localTopic   = null;   // Local topic prefix (e.g. "kress")

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function authenticate() {
  log.info('Authenticating with Kress Cloud...');
  const resp = await axios.post(cloud.tokenUrl, new URLSearchParams({
    username:      config.cloud.email,
    password:      config.cloud.pwd,
    grant_type:    'password',
    client_id:     cloud.clientId,
    client_secret: cloud.clientSecret,
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  accessToken = resp.data.access_token;
  log.info('Authentication successful.');
}

// ─── Fetch device list ────────────────────────────────────────────────────────
async function fetchDevices() {
  const resp = await axios.get(`${cloud.apiBase}/product-items`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params:  { status: 1 },
  });
  deviceArray = resp.data;
  log.info(`Found ${deviceArray.length} mower(s).`);
}

// ─── Connect to Kress Cloud MQTT ─────────────────────────────────────────────
// Called on startup AND after every token refresh so credentials stay fresh.
function connectCloudMqtt() {
  const device = deviceArray[0]; // single-mower setup
  if (!device) { log.error('No device found in cloud account.'); return; }

  const endpoint  = device.mqtt_endpoint || 'iot.eu-west-1.worxlandroid.com';
  const clientId  = `${cloud.mqttPrefix}/USER/${device.user_id}/${randomUUID()}`;
  const topicOut  = device.mqtt_topics.command_out;
  cloudTopicIn    = device.mqtt_topics.command_in;

  log.info(`Connecting to cloud MQTT: ${endpoint}`);
  log.debug(`Cloud topic out: ${topicOut}`);
  log.debug(`Cloud topic in:  ${cloudTopicIn}`);

  // Close previous client before recreating (important during token refresh)
  if (mqttClient) {
    mqttClient.removeAllListeners();
    mqttClient.end(true);
  }

  mqttClient = mqtt.connect(`mqtts://${endpoint}:8883`, {
    clientId,
    username:        accessToken,
    password:        accessToken,
    reconnectPeriod: 10_000,
  });

  mqttClient.on('connect', () => {
    log.info('Connected to Kress Cloud MQTT.');
    mqttClient.subscribe(topicOut, (err) => {
      if (err) log.error('Cloud subscribe error:', err);
    });
    // Request current status immediately after (re)connect
    mqttClient.publish(cloudTopicIn, JSON.stringify({ cmd: 0 }));
  });

  mqttClient.on('message', (_topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      log.debug('Cloud message received:', JSON.stringify(data));
      handleCloudMessage(data);
    } catch (e) {
      log.error('Failed to parse cloud message:', e.message);
    }
  });

  mqttClient.on('error',     (err) => log.error('Cloud MQTT error:', err.message));
  mqttClient.on('offline',   ()    => log.warn('Cloud MQTT offline.'));
  mqttClient.on('reconnect', ()    => log.info('Reconnecting to Cloud MQTT...'));
}

// ─── Connect to local MQTT broker ─────────────────────────────────────────────
function connectLocalMqtt() {
  const brokerUrl = config.mqtt.url;
  localTopic = config.mower[0]?.topic || 'kress';

  log.info(`Connecting to local MQTT broker: ${brokerUrl}`);

  localMqtt = mqtt.connect(brokerUrl, {
    clientId:        `kress-bridge-${randomUUID()}`,
    username:        config.mqtt.options?.username || undefined,
    password:        config.mqtt.options?.password || undefined,
    reconnectPeriod: 5_000,
    // Last Will: mark mower offline if bridge process dies unexpectedly
    will: {
      topic:   `${localTopic}/status/online`,
      payload: '0',
      retain:  true,
      qos:     1,
    },
  });

  localMqtt.on('connect', () => {
    log.info('Connected to local MQTT broker.');
    localMqtt.subscribe(`${localTopic}/cmd/#`, (err) => {
      if (err) log.error('Local subscribe error:', err);
      else log.info(`Listening for commands on: ${localTopic}/cmd/#`);
    });
  });

  // ── Forward commands Loxone → Kress Cloud ─────────────────────────────────
  localMqtt.on('message', (receivedTopic, message) => {
    log.debug(`Loxone command [${receivedTopic}]: ${message.toString().trim()}`);

    let cmd = null;
    if      (receivedTopic.endsWith('/cmd/start')) cmd = { cmd: 1 }; // Start mowing
    else if (receivedTopic.endsWith('/cmd/stop'))  cmd = { cmd: 2 }; // Stop / pause
    else if (receivedTopic.endsWith('/cmd/home'))  cmd = { cmd: 3 }; // Return to base

    if (!cmd) return;

    if (mqttClient?.connected && cloudTopicIn) {
      log.info(`Sending command to mower: ${JSON.stringify(cmd)}`);
      mqttClient.publish(cloudTopicIn, JSON.stringify(cmd));
    } else {
      log.warn('Cannot send command – not connected to Cloud MQTT.');
    }
  });

  localMqtt.on('error', (err) => log.error('Local MQTT error:', err.message));
}

// ─── Status/error look-up tables ──────────────────────────────────────────────
const STATUS_CODES = {
  0:  'idle',           1:  'home',          2:  'start_seq',
  3:  'leaving_home',   4:  'follow_wire',   5:  'searching_home',
  6:  'searching_wire', 7:  'mowing',        8:  'lifted',
  9:  'trapped',        10: 'blade_blocked', 11: 'debug',
  12: 'remote_ctrl',    30: 'going_home',    32: 'cutting_edge',
  33: 'idle2',          34: 'searching_zone',
};

const ERROR_CODES = {
  0:  'none',         1:  'trapped',      2:  'lifted',
  3:  'wire_missing', 4:  'outside_wire', 5:  'rain_delay',
  6:  'close_door',   7:  'motor_problem',8:  'laser_problem',
  9:  'wheel_problem',10: 'charge_problem',11: 'temp_high',
  12: 'wd_missing',   13: 'rev_problem',  14: 'charge_error',
  15: 'tilt_problem', 16: 'shifted',      17: 'cs_mismatch',
};

// ─── Parse cloud message and publish to local broker ─────────────────────────
function handleCloudMessage(data) {
  if (!localMqtt?.connected || !localTopic) return;

  const publish = (subtopic, value) =>
    localMqtt.publish(`${localTopic}/status/${subtopic}`, String(value), { retain: true });

  // Battery
  if (data.dat?.bt !== undefined) {
    publish('battery',          data.dat.bt.p ?? 0);
    publish('battery_charging', data.dat.bt.c ? '1' : '0');
    publish('battery_voltage',  data.dat.bt.v ?? 0);
    publish('battery_temp',     data.dat.bt.t ?? 0);
  }

  // Mower status
  if (data.dat?.ls !== undefined) {
    const code = data.dat.ls;
    publish('status_code', code);
    publish('status',      STATUS_CODES[code] || `unknown_${code}`);
    publish('mowing',      code === 7 ? '1' : '0');
    publish('at_home',     code === 1 ? '1' : '0');
  }

  // Error
  if (data.dat?.le !== undefined) {
    const code = data.dat.le;
    publish('error_code', code);
    publish('error',      ERROR_CODES[code] || `unknown_${code}`);
  }

  // Cumulative stats
  if (data.dat?.st !== undefined) {
    publish('total_time',     data.dat.st.wt ?? 0);
    publish('total_distance', data.dat.st.d  ?? 0);
    publish('total_blades',   data.dat.st.b  ?? 0);
  }

  // Blade time remaining
  if (data.dat?.bl !== undefined) {
    publish('blade_time', data.dat.bl);
  }

  // WiFi signal
  if (data.dat?.rsi !== undefined) {
    publish('wifi_rssi', data.dat.rsi);
  }

  publish('online', '1');
  log.debug('Status published to local MQTT.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log.info('=== Kress ↔ Loxone MQTT Bridge starting ===');

  await authenticate();
  await fetchDevices();
  connectCloudMqtt();
  connectLocalMqtt();

  // Re-authenticate every 11 h and reconnect cloud MQTT with fresh token.
  // (Tokens typically expire after 12 h – reconnecting avoids auth failures
  //  when the mqtt library's built-in reconnect kicks in after token expiry.)
  setInterval(async () => {
    try {
      await authenticate();
      log.info('Token refreshed – reconnecting Cloud MQTT with new credentials.');
      connectCloudMqtt();
    } catch (e) {
      log.error('Token refresh failed:', e.message);
    }
  }, 11 * 60 * 60 * 1000);
}

main().catch((err) => {
  log.error('Startup failed:', err.message);
  log.debug(err.stack);
  process.exit(1);
});
