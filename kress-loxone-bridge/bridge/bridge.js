'use strict';

const mqtt = require('mqtt');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const config = require('./config.json');
const log = require('./logger')(config.logLevel || 'info');

// ─── Kress / Worx Cloud constants ────────────────────────────────────────────
const CLOUD = {
  kress: {
    tokenUrl: 'https://id.kress.com/oauth/token',
    apiBase:  'https://api.kress.com/api/v1',
    mqttPrefix: 'kress',
    clientId:  'kress_m_series',
    clientSecret: '5YAIqmqbpuoLPIaRGKcHQi15gDDkYN0OaA5YEsRuqM8=',
  }
};

const cloud = CLOUD[config.cloud.type] || CLOUD.kress;

let accessToken = null;
let mqttClient  = null;
let localMqtt   = null;
let deviceArray = [];

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
  return accessToken;
}

// ─── Fetch device list ────────────────────────────────────────────────────────
async function fetchDevices() {
  const resp = await axios.get(`${cloud.apiBase}/product-items`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params:  { status: 1 },
  });
  deviceArray = resp.data;
  log.info(`Found ${deviceArray.length} mower(s).`);
  return deviceArray;
}

// ─── Connect to Kress Cloud MQTT ─────────────────────────────────────────────
async function connectCloudMqtt() {
  const device = deviceArray[0]; // single mower setup
  if (!device) { log.error('No device found in cloud account.'); return; }

  const endpoint  = device.mqtt_endpoint || 'iot.eu-west-1.worxlandroid.com';
  const clientId  = `${cloud.mqttPrefix}/USER/${device.user_id}/${uuidv4()}`;
  const topicOut  = device.mqtt_topics.command_out;
  const topicIn   = device.mqtt_topics.command_in;

  log.info(`Connecting to cloud MQTT: ${endpoint}`);
  log.debug(`Cloud topic out: ${topicOut}`);
  log.debug(`Cloud topic in:  ${topicIn}`);

  mqttClient = mqtt.connect(`mqtts://${endpoint}:8883`, {
    clientId,
    username: `${accessToken}`,
    password: `${accessToken}`,
    reconnectPeriod: 10000,
  });

  mqttClient.on('connect', () => {
    log.info('Connected to Kress Cloud MQTT.');
    mqttClient.subscribe(topicOut, (err) => {
      if (err) log.error('Cloud subscribe error:', err);
    });
    // Request initial status
    mqttClient.publish(topicIn, JSON.stringify({ cmd: 0 }));
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

  mqttClient.on('error', (err) => log.error('Cloud MQTT error:', err.message));
  mqttClient.on('offline', () => log.warn('Cloud MQTT offline.'));
  mqttClient.on('reconnect', () => log.info('Reconnecting to Cloud MQTT...'));

  return { topicIn };
}

// ─── Connect to local Mosquitto ───────────────────────────────────────────────
function connectLocalMqtt(cloudTopicIn) {
  const brokerUrl = config.mqtt.url;
  const topic     = config.mower[0]?.topic || 'kress';

  log.info(`Connecting to local MQTT broker: ${brokerUrl}`);

  localMqtt = mqtt.connect(brokerUrl, {
    clientId:  `kress-bridge-${uuidv4()}`,
    username:  config.mqtt.options?.username || undefined,
    password:  config.mqtt.options?.password || undefined,
    port:      config.mqtt.options?.port || 1883,
    reconnectPeriod: 5000,
  });

  localMqtt.on('connect', () => {
    log.info('Connected to local MQTT broker.');
    // Subscribe to command topics from Loxone
    localMqtt.subscribe(`${topic}/cmd/#`, (err) => {
      if (err) log.error('Local subscribe error:', err);
      else log.info(`Listening for Loxone commands on: ${topic}/cmd/#`);
    });
  });

  // ── Forward commands from Loxone → Kress Cloud ────────────────────────────
  localMqtt.on('message', (receivedTopic, message) => {
    const payload = message.toString().trim();
    log.debug(`Loxone command received [${receivedTopic}]: ${payload}`);

    let cmd = null;

    if (receivedTopic.endsWith('/cmd/start')) {
      cmd = { cmd: 1 }; // Start mowing
    } else if (receivedTopic.endsWith('/cmd/stop')) {
      cmd = { cmd: 2 }; // Stop / pause
    } else if (receivedTopic.endsWith('/cmd/home')) {
      cmd = { cmd: 3 }; // Return to base
    }

    if (cmd && mqttClient?.connected) {
      log.info(`Sending command to mower: ${JSON.stringify(cmd)}`);
      mqttClient.publish(cloudTopicIn, JSON.stringify(cmd));
    } else if (!mqttClient?.connected) {
      log.warn('Cannot send command – not connected to cloud MQTT.');
    }
  });

  localMqtt.on('error', (err) => log.error('Local MQTT error:', err.message));

  return { topic };
}

// ─── Parse & publish status to Loxone ────────────────────────────────────────
let localTopic = null;

const STATUS_CODES = {
  0:  'idle', 1: 'home', 2: 'start_seq', 3: 'leaving_home',
  4:  'follow_wire', 5: 'searching_home', 6: 'searching_wire',
  7:  'mowing', 8: 'lifted', 9: 'trapped', 10: 'blade_blocked',
  11: 'debug', 12: 'remote_ctrl', 30: 'going_home', 32: 'cutting_edge',
  33: 'idle2', 34: 'searching_zone',
};

const ERROR_CODES = {
  0: 'none', 1: 'trapped', 2: 'lifted', 3: 'wire_missing',
  4: 'outside_wire', 5: 'rain_delay', 6: 'close_door',
  7: 'motor_problem', 8: 'laser_problem', 9: 'wheel_problem',
  10: 'charge_problem', 11: 'temp_high', 12: 'wd_missing',
  13: 'rev_problem', 14: 'charge_error', 15: 'tilt_problem',
  16: 'shifted', 17: 'cs_mismatch',
};

function handleCloudMessage(data) {
  if (!localMqtt?.connected || !localTopic) return;

  const publish = (subtopic, value) => {
    localMqtt.publish(`${localTopic}/status/${subtopic}`, String(value), { retain: true });
  };

  // Battery
  if (data.dat?.bt !== undefined) {
    publish('battery', data.dat.bt.p ?? 0);
    publish('battery_charging', data.dat.bt.c ? '1' : '0');
    publish('battery_voltage', data.dat.bt.v ?? 0);
    publish('battery_temp', data.dat.bt.t ?? 0);
  }

  // Mower status
  if (data.dat?.ls !== undefined) {
    const statusCode = data.dat.ls;
    const statusText = STATUS_CODES[statusCode] || `unknown_${statusCode}`;
    publish('status_code', statusCode);
    publish('status', statusText);
    publish('mowing', statusCode === 7 ? '1' : '0');
    publish('at_home', statusCode === 1 ? '1' : '0');
  }

  // Error
  if (data.dat?.le !== undefined) {
    const errCode = data.dat.le;
    publish('error_code', errCode);
    publish('error', ERROR_CODES[errCode] || `unknown_${errCode}`);
  }

  // Stats
  if (data.dat?.st !== undefined) {
    publish('total_time', data.dat.st.wt ?? 0);
    publish('total_distance', data.dat.st.d ?? 0);
    publish('total_blades', data.dat.st.b ?? 0);
  }

  // Blade time
  if (data.dat?.bl !== undefined) {
    publish('blade_time', data.dat.bl);
  }

  // WiFi signal
  if (data.dat?.rsi !== undefined) {
    publish('wifi_rssi', data.dat.rsi);
  }

  // Online
  publish('online', '1');

  log.debug('Status published to local MQTT.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log.info('=== Kress ↔ Loxone MQTT Bridge starting ===');

  try {
    await authenticate();
    await fetchDevices();
    const { topicIn } = await connectCloudMqtt();
    const { topic }   = connectLocalMqtt(topicIn);
    localTopic = topic;

    // Re-authenticate every 12h (token expiry)
    setInterval(async () => {
      try {
        await authenticate();
        log.info('Token refreshed.');
      } catch (e) {
        log.error('Token refresh failed:', e.message);
      }
    }, 12 * 60 * 60 * 1000);

  } catch (err) {
    log.error('Startup failed:', err.message);
    log.debug(err.stack);
    process.exit(1);
  }
}

main();
