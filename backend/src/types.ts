/**
 * Agrapatha BMKG Gateway — Core Type Definitions
 */

export interface GatewayConfig {
  port: number;
  allowedOrigins: Set<string>;
  upstreamTimeoutMs: number;
  forecastCacheTtlMs: number;
  forecastCacheMaxEntries: number;
  nowcastCacheTtlMs: number;
  nowcastCacheMaxEntries: number;
  maxForecastBytes: number;
  maxNowcastBytes: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  rateLimitMaxEntries: number;
  trustProxy: boolean;
  // IoT & Authentication configuration
  operatorAccountsJson: string;
  gatewayTokenSecret: string;
  tokenExpirySec: number;
  enableActuators: boolean;
  maxImageBytes: number;
  imageStaleTtlMs: number;
  maxSseClientsPerIp: number;
  loginRateLimitMax: number;
  loginRateLimitWindowMs: number;
  // MQTT Broker configuration
  mqttEnabled: boolean;
  mqttBrokerUrl: string;
  mqttUsername?: string;
  mqttPassword?: string;
  mqttClientId: string;
  mqttConnectTimeoutMs: number;
  mqttReconnectPeriodMs: number;
  mqttKeepaliveSec: number;
  mqttTelemetryTopic: string;
  mqttImageTopic: string;
}

export interface UpstreamPayload {
  statusCode: number;
  contentType: string;
  body: Uint8Array;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number;
}

export type FetchFunction = typeof globalThis.fetch;
export type ClockFunction = () => number;

import type { OperatorAccount } from './auth/accountStore.ts';
import type { ImageStore } from './iot/imageStore.ts';
import type { MqttGatewayAdapter } from './iot/mqttAdapter.ts';
import type { TelemetryHub } from './iot/telemetryHub.ts';

export interface ServerDependencies {
  fetch?: FetchFunction;
  now?: ClockFunction;
  config?: Partial<GatewayConfig>;
  telemetryHub?: TelemetryHub;
  imageStore?: ImageStore;
  accountStore?: Map<string, OperatorAccount>;
  mqttAdapter?: MqttGatewayAdapter;
}

export interface RateLimitEntry {
  timestamps: number[];
  lastAccessed: number;
}
