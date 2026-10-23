/**
 * AGRAPATHA — MQTT Client & Telemetry Service
 * Configured for EMQX Cloud Broker:
 * - Browser Dashboard: WebSocket over TLS/SSL (WSS) on Port 8084
 * - Microcontrollers / ESP32: MQTT over TLS/SSL (TCP) on Port 8883
 */

import mqtt, { type MqttClient } from 'mqtt';

export type MqttConnectionState = 'disconnected' | 'connecting' | 'connected' | 'auth_required' | 'error';

export interface MqttBrokerConfig {
  host: string;
  wsPort: number;
  tcpPort: number;
  wsPath: string;
  brokerUrl: string;
  username: string;
  password?: string;
  topics: {
    telemetry: string;
    commands: string;
    status: string;
  };
}

export interface IncomingTelemetryMessage {
  temp?: number;
  rh?: number;
  soilMoisture?: number;
  soilRaw?: number;
  wind?: number;
  rain?: number;
  rainRaw?: number;
  rainStatus?: string;
  lightLux?: number;
  ldrRaw?: number;
  ffmc?: number;
  dmc?: number;
  dc?: number;
  isi?: number;
  nodeId?: string;
  motorState?: string;
  motorDriver?: string;
  isRealtime?: boolean;
  limitLeft?: boolean;
  limitRight?: boolean;
  visionPrediction?: string;
  visionConfidence?: number;
  visionHealthy?: number;
  visionPowdery?: number;
  visionRust?: number;
  timestamp?: string | number;
}

import { getIotConfig } from '../config/iotConfig.ts';

/**
 * Loads MQTT configuration from centralized zero-config module.
 * Does NOT require .env file.
 */
export function getMqttConfig(): MqttBrokerConfig {
  const iot = getIotConfig();
  return {
    host: iot.emqx.host,
    wsPort: iot.emqx.wsPort,
    tcpPort: iot.emqx.tcpPort,
    wsPath: iot.emqx.wsPath,
    brokerUrl: iot.emqx.brokerUrl,
    username: iot.emqx.username,
    password: iot.emqx.password,
    topics: {
      telemetry: iot.emqx.topics.telemetry,
      commands: iot.emqx.topics.commands,
      status: iot.emqx.topics.status,
    },
  };
}

/**
 * Sanitizes and parses incoming telemetry payloads from ESP32 & GRENVIS nodes.
 */
export function parseTelemetryPayload(raw: string | Uint8Array): IncomingTelemetryMessage | null {
  try {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return null;

    const parsed: IncomingTelemetryMessage = {};

    // Temperature (alias temp / temperature)
    if (typeof data.temp === 'number' && !Number.isNaN(data.temp)) parsed.temp = data.temp;
    else if (typeof data.temperature === 'number' && !Number.isNaN(data.temperature)) parsed.temp = data.temperature;

    // Humidity (alias rh / humidity)
    if (typeof data.rh === 'number' && !Number.isNaN(data.rh)) parsed.rh = data.rh;
    else if (typeof data.humidity === 'number' && !Number.isNaN(data.humidity)) parsed.rh = data.humidity;

    // Soil Moisture (alias soilMoisture / soil_moisture)
    if (typeof data.soilMoisture === 'number' && !Number.isNaN(data.soilMoisture)) parsed.soilMoisture = data.soilMoisture;
    else if (typeof data.soil_moisture === 'number' && !Number.isNaN(data.soil_moisture)) parsed.soilMoisture = data.soil_moisture;
    if (typeof data.soil_raw === 'number') parsed.soilRaw = data.soil_raw;

    // Wind
    if (typeof data.wind === 'number' && !Number.isNaN(data.wind)) parsed.wind = data.wind;

    // Rain (intensity & status)
    if (typeof data.rain === 'number' && !Number.isNaN(data.rain)) parsed.rain = data.rain;
    if (typeof data.rain_raw === 'number') parsed.rainRaw = data.rain_raw;
    if (typeof data.rain_status === 'string') parsed.rainStatus = data.rain_status;

    // Light (Lux & LDR ADC)
    if (typeof data.lightLux === 'number' && !Number.isNaN(data.lightLux)) parsed.lightLux = data.lightLux;
    else if (typeof data.light_lux === 'number' && !Number.isNaN(data.light_lux)) parsed.lightLux = data.light_lux;
    if (typeof data.ldr_raw === 'number') parsed.ldrRaw = data.ldr_raw;

    // FWI indices
    if (typeof data.ffmc === 'number' && !Number.isNaN(data.ffmc)) parsed.ffmc = data.ffmc;
    if (typeof data.dmc === 'number' && !Number.isNaN(data.dmc)) parsed.dmc = data.dmc;
    if (typeof data.dc === 'number' && !Number.isNaN(data.dc)) parsed.dc = data.dc;
    if (typeof data.isi === 'number' && !Number.isNaN(data.isi)) parsed.isi = data.isi;

    // Node & Motor info
    if (typeof data.nodeId === 'string') parsed.nodeId = data.nodeId;
    else if (typeof data.esp32_mac === 'string') parsed.nodeId = data.esp32_mac;

    if (typeof data.motor_state === 'string') parsed.motorState = data.motor_state;
    if (typeof data.motor_driver === 'string') parsed.motorDriver = data.motor_driver;
    if (typeof data.is_realtime === 'boolean') parsed.isRealtime = data.is_realtime;
    if (typeof data.limit_left === 'boolean') parsed.limitLeft = data.limit_left;
    else if (data.limit_left === 'true') parsed.limitLeft = true;
    else if (data.limit_left === 'false') parsed.limitLeft = false;

    if (typeof data.limit_right === 'boolean') parsed.limitRight = data.limit_right;
    else if (data.limit_right === 'true') parsed.limitRight = true;
    else if (data.limit_right === 'false') parsed.limitRight = false;

    // Vision results
    if (typeof data.vision_prediction === 'string') parsed.visionPrediction = data.vision_prediction;
    else if (typeof data.prediction === 'string') parsed.visionPrediction = data.prediction;

    if (typeof data.vision_confidence === 'number') parsed.visionConfidence = data.vision_confidence;
    else if (typeof data.confidence === 'number') parsed.visionConfidence = data.confidence;

    if (typeof data.vision_healthy === 'number') parsed.visionHealthy = data.vision_healthy;
    if (typeof data.vision_powdery === 'number') parsed.visionPowdery = data.vision_powdery;
    if (typeof data.vision_rust === 'number') parsed.visionRust = data.vision_rust;

    if (data.timestamp) parsed.timestamp = data.timestamp;

    return parsed;
  } catch {
    return null;
  }
}

export interface ConnectionTestResult {
  success: boolean;
  state: MqttConnectionState;
  message: string;
  latencyMs?: number;
  returnCode?: number;
}

/**
 * Tests connection to EMQX broker via browser WebSockets (WSS on Port 8084).
 */
export async function testMqttWebSocketConnection(
  overrides?: { username?: string; password?: string; url?: string }
): Promise<ConnectionTestResult> {
  const config = getMqttConfig();
  const targetUrl = overrides?.url || config.brokerUrl;
  const username = overrides?.username !== undefined ? overrides.username : config.username;
  const password = overrides?.password !== undefined ? overrides.password : config.password;

  const startTime = Date.now();
  const clientId = `probe-browser-${Math.random().toString(16).substring(2, 8)}`;

  return new Promise((resolve) => {
    let resolved = false;
    let client: MqttClient | null = null;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { client?.end(true); } catch { /* ignore */ }
        resolve({
          success: false,
          state: 'error',
          message: 'Timeout koneksi WSS (Port 8084 tidak merespons dalam 6 detik).',
        });
      }
    }, 6000);

    try {
      client = mqtt.connect(targetUrl, {
        clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 0,
        username: username || undefined,
        password: password || undefined,
        protocolVersion: 4,
      });

      client.on('connect', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          const latencyMs = Date.now() - startTime;
          try { client?.end(true); } catch { /* ignore */ }
          resolve({
            success: true,
            state: 'connected',
            message: `Koneksi WSS (Port 8084) BERHASIL terverifikasi (${latencyMs} ms).`,
            latencyMs,
          });
        }
      });

      client.on('error', (err: any) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          try { client?.end(true); } catch { /* ignore */ }

          const msg = err?.message || String(err);
          const isAuthError =
            msg.includes('Not authorized') ||
            msg.includes('Bad username') ||
            msg.includes('connack 4') ||
            msg.includes('connack 5');

          resolve({
            success: false,
            state: isAuthError ? 'auth_required' : 'error',
            message: isAuthError
              ? 'EMQX Cloud memerlukan otentikasi Username & Password (Password-Based Auth).'
              : `Gagal terhubung ke broker: ${msg}`,
          });
        }
      });
    } catch (err: any) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({
          success: false,
          state: 'error',
          message: `Inisialisasi klien gagal: ${err?.message || err}`,
        });
      }
    }
  });
}

export interface LiveTelemetryCallbacks {
  onTelemetry: (telemetry: IncomingTelemetryMessage) => void;
  onStatusChange?: (status: MqttConnectionState) => void;
  onRawMessage?: (topic: string, payload: string) => void;
}

let activeLiveClient: MqttClient | null = null;
const activeSubscribers = new Set<LiveTelemetryCallbacks>();
let currentLiveState: MqttConnectionState = 'disconnected';

export function getLiveMqttState(): MqttConnectionState {
  return currentLiveState;
}

/**
 * Subscribes to the live telemetry stream over browser WSS (Port 8084).
 * Returns an unsubscribe cleanup function.
 */
export function subscribeLiveTelemetry(callbacks: LiveTelemetryCallbacks): () => void {
  activeSubscribers.add(callbacks);

  if (!activeLiveClient) {
    initLiveMqttClient();
  } else if (activeLiveClient.connected) {
    callbacks.onStatusChange?.('connected');
  }

  return () => {
    activeSubscribers.delete(callbacks);
  };
}

function initLiveMqttClient(): void {
  const config = getMqttConfig();
  const clientId = `agrapatha-web-${Math.random().toString(16).substring(2, 8)}`;

  try {
    currentLiveState = 'connecting';
    activeSubscribers.forEach((cb) => cb.onStatusChange?.('connecting'));

    activeLiveClient = mqtt.connect(config.brokerUrl, {
      clientId,
      clean: true,
      connectTimeout: 7000,
      reconnectPeriod: 3000,
      username: config.username || undefined,
      password: config.password || undefined,
      protocolVersion: 4,
    });

    activeLiveClient.on('connect', () => {
      currentLiveState = 'connected';
      activeSubscribers.forEach((cb) => cb.onStatusChange?.('connected'));

      const topicsToSub = [
        config.topics.telemetry,
        'grenvis/sensor/data',
        'grenvis/vision/data',
        'grenvis/sensor/status',
        config.topics.status,
      ];

      activeLiveClient?.subscribe(topicsToSub, (err) => {
        if (err) {
          console.warn('[MQTT Live] Subscription warning:', err);
        }
      });
    });

    activeLiveClient.on('message', (topic: string, payload: any) => {
      const text = payload.toString();
      activeSubscribers.forEach((cb) => cb.onRawMessage?.(topic, text));

      if (topic.includes('telemetry') || topic.includes('data')) {
        const parsed = parseTelemetryPayload(text);
        if (parsed) {
          activeSubscribers.forEach((cb) => cb.onTelemetry(parsed));
        }
      }
    });

    activeLiveClient.on('error', (err: any) => {
      console.warn('[MQTT Live] Client error:', err?.message || err);
      currentLiveState = 'error';
      activeSubscribers.forEach((cb) => cb.onStatusChange?.('error'));
    });

    activeLiveClient.on('close', () => {
      if (currentLiveState !== 'error') {
        currentLiveState = 'disconnected';
        activeSubscribers.forEach((cb) => cb.onStatusChange?.('disconnected'));
      }
    });
  } catch (err: any) {
    currentLiveState = 'error';
    activeSubscribers.forEach((cb) => cb.onStatusChange?.('error'));
  }
}

/**
 * Publishes an actuator or camera trigger command ('L', 'R', 'S', 'C') to EMQX Cloud.
 * Dual-dispatches to both standard topic namespaces ('agrapatha/commands' and 'grenvis/device/control').
 */
export async function publishMqttCommand(command: string): Promise<boolean> {
  const config = getMqttConfig();
  return new Promise((resolve) => {
    if (activeLiveClient && activeLiveClient.connected) {
      activeLiveClient.publish(config.topics.commands, command, { qos: 1 }, (err) => {
        activeLiveClient?.publish('grenvis/device/control', command, { qos: 1 });
        resolve(!err);
      });
    } else {
      // Ephemeral fallback client
      const singleClient = mqtt.connect(config.brokerUrl, {
        clientId: `cmd-${Math.random().toString(16).substring(2, 6)}`,
        clean: true,
        connectTimeout: 4000,
        username: config.username || undefined,
        password: config.password || undefined,
      });

      const timeout = setTimeout(() => {
        try { singleClient.end(true); } catch {}
        resolve(false);
      }, 5000);

      singleClient.on('connect', () => {
        singleClient.publish(config.topics.commands, command, { qos: 1 }, (err) => {
          singleClient.publish('grenvis/device/control', command, { qos: 1 });
          clearTimeout(timeout);
          try { singleClient.end(true); } catch {}
          resolve(!err);
        });
      });

      singleClient.on('error', () => {
        clearTimeout(timeout);
        try { singleClient.end(true); } catch {}
        resolve(false);
      });
    }
  });
}
