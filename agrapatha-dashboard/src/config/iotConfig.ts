/**
 * ==============================================================================
 * AGRAPATHA & GRENVIS — ZERO-CONFIG IOT CONFIGURATION
 * Single Source of Truth for Web Dashboard & Hardware Synchronization
 * ==============================================================================
 * Keunggulan:
 * 1. ZERO-CONFIG: Tidak membutuhkan file .env. Langsung jalan out-of-the-box.
 * 2. SYNC WITH HARDWARE: Selaras 100% dengan firmware/esp32_emqx_config.h.
 * 3. RUNTIME PERSISTENCE: Pengaturan dapat diubah lewat UI dan tersimpan di localStorage.
 * ==============================================================================
 */

export interface IotBrokerConfig {
  host: string;
  wsPort: number;
  tcpPort: number;
  wsPath: string;
  brokerUrl: string;
  username: string;
  password?: string;
  topics: {
    telemetry: string;
    telemetryGrenvis: string;
    commands: string;
    commandsGrenvis: string;
    status: string;
    statusGrenvis: string;
    image: string;
  };
}

export interface IotRailwayConfig {
  wildfireUrl: string;
  leafUrl: string | null;
}

export interface IotHardwareConfig {
  esp32MainMac: string;
  esp32CamMac: string;
  espNowChannel: number;
  pins: {
    dht: number;
    soil: number;
    rain: number;
    ldr: number;
    motorIn1: number;
    motorIn2: number;
    motorIn3: number; // L298N IN3 (Drives OUT3)
    motorIn4: number; // L298N IN4 (Drives OUT4)
    limitLeft: number;
    limitRight: number;
  };
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface IotConfig {
  emqx: IotBrokerConfig;
  railway: IotRailwayConfig;
  hardware: IotHardwareConfig;
}

const LOCAL_STORAGE_KEY = 'agrapatha_iot_runtime_config_v1';

// Default Hardcoded Configuration (Zero .env Required)
export const DEFAULT_IOT_CONFIG: IotConfig = {
  emqx: {
    host: 'wfc1ec11.ala.asia-southeast1.emqxsl.com',
    wsPort: 8084,
    tcpPort: 8883,
    wsPath: '/mqtt',
    brokerUrl: 'wss://wfc1ec11.ala.asia-southeast1.emqxsl.com:8084/mqtt',
    username: 'grenvis_esp32',
    password: 'grenvis123',
    topics: {
      telemetry: 'agrapatha/telemetry',
      telemetryGrenvis: 'grenvis/sensor/data',
      commands: 'agrapatha/commands',
      commandsGrenvis: 'grenvis/device/control',
      status: 'agrapatha/status',
      statusGrenvis: 'grenvis/sensor/status',
      image: 'grenvis/vision/image',
    },
  },
  railway: {
    wildfireUrl: 'https://tes-tflite-production.up.railway.app',
    leafUrl: null, // Isolated until explicit model deployment
  },
  hardware: {
    esp32MainMac: '8C:AA:B5:37:71:18',
    esp32CamMac: 'F8:B3:B7:A6:F3:9C',
    espNowChannel: 6,
    pins: {
      dht: 19,
      soil: 34,
      rain: 35,
      ldr: 36,
      motorIn1: 16,
      motorIn2: 17,
      motorIn3: 16, // L298N IN3 (Drives OUT3)
      motorIn4: 17, // L298N IN4 (Drives OUT4)
      limitLeft: 32,
      limitRight: 33,
    },
  },
};

/**
 * Loads the active configuration.
 * Priority:
 * 1. Runtime overrides saved in browser localStorage (via Settings modal)
 * 2. Optional Vite environment variables (if provided)
 * 3. Solid hardcoded default values (zero-config, works 100% without .env)
 */
export function getIotConfig(): IotConfig {
  let runtimeOverrides: Partial<IotConfig> = {};

  // Check localStorage (browser runtime)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        runtimeOverrides = JSON.parse(stored);
      }
    } catch {
      // ignore
    }
  }

  // Check optional env vars (if user still has them, but not required)
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {} as Record<string, string>;

  const host = runtimeOverrides.emqx?.host || env.VITE_MQTT_HOST || DEFAULT_IOT_CONFIG.emqx.host;
  const wsPort = runtimeOverrides.emqx?.wsPort || Number(env.VITE_MQTT_WS_PORT) || DEFAULT_IOT_CONFIG.emqx.wsPort;
  const tcpPort = runtimeOverrides.emqx?.tcpPort || Number(env.VITE_MQTT_TCP_PORT) || DEFAULT_IOT_CONFIG.emqx.tcpPort;
  const wsPath = runtimeOverrides.emqx?.wsPath || env.VITE_MQTT_WS_PATH || DEFAULT_IOT_CONFIG.emqx.wsPath;
  const brokerUrl = runtimeOverrides.emqx?.brokerUrl || env.VITE_MQTT_BROKER_URL || `wss://${host}:${wsPort}${wsPath}`;
  const username = runtimeOverrides.emqx?.username ?? (env.VITE_MQTT_USERNAME !== undefined ? env.VITE_MQTT_USERNAME : DEFAULT_IOT_CONFIG.emqx.username);
  const password = runtimeOverrides.emqx?.password ?? (env.VITE_MQTT_PASSWORD !== undefined ? env.VITE_MQTT_PASSWORD : DEFAULT_IOT_CONFIG.emqx.password);

  const wildfireUrl = runtimeOverrides.railway?.wildfireUrl || env.VITE_VISION_API_BASE_URL || DEFAULT_IOT_CONFIG.railway.wildfireUrl;
  const leafUrl = runtimeOverrides.railway?.leafUrl ?? (env.VITE_LEAF_API_BASE_URL || DEFAULT_IOT_CONFIG.railway.leafUrl);

  return {
    emqx: {
      host,
      wsPort,
      tcpPort,
      wsPath,
      brokerUrl,
      username,
      password,
      topics: {
        telemetry: runtimeOverrides.emqx?.topics?.telemetry || env.VITE_MQTT_TOPIC_TELEMETRY || DEFAULT_IOT_CONFIG.emqx.topics.telemetry,
        telemetryGrenvis: runtimeOverrides.emqx?.topics?.telemetryGrenvis || DEFAULT_IOT_CONFIG.emqx.topics.telemetryGrenvis,
        commands: runtimeOverrides.emqx?.topics?.commands || env.VITE_MQTT_TOPIC_COMMANDS || DEFAULT_IOT_CONFIG.emqx.topics.commands,
        commandsGrenvis: runtimeOverrides.emqx?.topics?.commandsGrenvis || DEFAULT_IOT_CONFIG.emqx.topics.commandsGrenvis,
        status: runtimeOverrides.emqx?.topics?.status || env.VITE_MQTT_TOPIC_STATUS || DEFAULT_IOT_CONFIG.emqx.topics.status,
        statusGrenvis: runtimeOverrides.emqx?.topics?.statusGrenvis || DEFAULT_IOT_CONFIG.emqx.topics.statusGrenvis,
        image: runtimeOverrides.emqx?.topics?.image || DEFAULT_IOT_CONFIG.emqx.topics.image,
      },
    },
    railway: {
      wildfireUrl,
      leafUrl,
    },
    hardware: {
      ...DEFAULT_IOT_CONFIG.hardware,
      ...(runtimeOverrides.hardware || {}),
    },
  };
}

/**
 * Persists runtime configuration overrides to browser localStorage.
 */
export function saveIotConfig(overrides: DeepPartial<IotConfig>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const current = getIotConfig();
      const merged = {
        ...current,
        ...overrides,
        emqx: { ...current.emqx, ...(overrides.emqx || {}) },
        railway: { ...current.railway, ...(overrides.railway || {}) },
        hardware: { ...current.hardware, ...(overrides.hardware || {}) },
      };
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // ignore
    }
  }
}

/**
 * Resets runtime configuration back to factory default constants.
 */
export function resetIotConfig(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
