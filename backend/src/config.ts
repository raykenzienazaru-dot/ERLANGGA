import type { GatewayConfig } from './types.ts';

/**
 * Parses and returns configuration options with secure defaults.
 * Allows overriding via environment variables.
 */
export function loadConfig(
  overrides?: Partial<GatewayConfig>,
  env: NodeJS.ProcessEnv = process.env
): GatewayConfig {

  // Explicit CORS allowlist: defaults to standard local dev servers
  // In production, comma-separated exact origins MUST be passed via ALLOWED_ORIGINS
  const defaultOrigins = ['http://localhost:5173', 'http://localhost:3000'];
  const configuredOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((o: string) => o.trim()).filter(Boolean)
    : [];

  const allowedOrigins = new Set<string>([...defaultOrigins, ...configuredOrigins]);

  // Only trust reverse proxy headers if explicitly verified and configured via TRUST_PROXY=true.
  // Never guess Railway proxy behavior or enable trust without verified contract.
  const trustProxy = overrides?.trustProxy ?? (env.TRUST_PROXY === 'true');

  // In production, require an explicitly configured GATEWAY_TOKEN_SECRET with sufficient entropy
  const isProduction = env.NODE_ENV === 'production';
  const defaultDevSecret = 'dev-gateway-token-secret-minimum-32-chars!';
  const gatewayTokenSecret = overrides?.gatewayTokenSecret ?? (env.GATEWAY_TOKEN_SECRET || defaultDevSecret);

  if (isProduction && (!env.GATEWAY_TOKEN_SECRET || env.GATEWAY_TOKEN_SECRET.length < 32)) {
    throw new Error('GATEWAY_TOKEN_SECRET must be set and contain at least 32 characters in production');
  }

  // MQTT Broker Configuration
  const brokerHost = env.MQTT_BROKER_HOST || env.MQTT_HOST;
  const brokerPort = env.MQTT_TLS_PORT || env.MQTT_PORT || 8883;
  const rawBrokerUrl =
    env.MQTT_BROKER_URL ||
    (brokerHost
      ? `mqtts://${brokerHost}:${brokerPort}`
      : '');
  const mqttBrokerUrl = overrides?.mqttBrokerUrl ?? rawBrokerUrl;
  const mqttEnabled = overrides?.mqttEnabled ?? Boolean(mqttBrokerUrl && mqttBrokerUrl.trim() !== '');

  if (mqttEnabled && isProduction) {
    if (mqttBrokerUrl.startsWith('mqtt://')) {
      throw new Error('MQTT broker connection must use TLS (mqtts:// or wss://) in production');
    }
    if (!overrides?.mqttUsername && !env.MQTT_USERNAME) {
      throw new Error('MQTT_USERNAME must be set in production when MQTT is enabled');
    }
    if (!overrides?.mqttPassword && !env.MQTT_PASSWORD) {
      throw new Error('MQTT_PASSWORD must be set in production when MQTT is enabled');
    }
  }

  return {
    port: overrides?.port ?? Number(env.PORT || 3000),
    allowedOrigins: overrides?.allowedOrigins ?? allowedOrigins,
    upstreamTimeoutMs: overrides?.upstreamTimeoutMs ?? Number(env.UPSTREAM_TIMEOUT_MS || 6000),
    forecastCacheTtlMs: overrides?.forecastCacheTtlMs ?? Number(env.FORECAST_CACHE_TTL_MS || 15 * 60 * 1000),
    forecastCacheMaxEntries: overrides?.forecastCacheMaxEntries ?? Number(env.FORECAST_CACHE_MAX_ENTRIES || 100),
    nowcastCacheTtlMs: overrides?.nowcastCacheTtlMs ?? Number(env.NOWCAST_CACHE_TTL_MS || 5 * 60 * 1000),
    nowcastCacheMaxEntries: overrides?.nowcastCacheMaxEntries ?? Number(env.NOWCAST_CACHE_MAX_ENTRIES || 2),
    maxForecastBytes: overrides?.maxForecastBytes ?? Number(env.MAX_FORECAST_BYTES || 512 * 1024),
    maxNowcastBytes: overrides?.maxNowcastBytes ?? Number(env.MAX_NOWCAST_BYTES || 1024 * 1024),
    rateLimitWindowMs: overrides?.rateLimitWindowMs ?? Number(env.RATE_LIMIT_WINDOW_MS || 60 * 1000),
    rateLimitMaxRequests: overrides?.rateLimitMaxRequests ?? Number(env.RATE_LIMIT_MAX_REQUESTS || 60),
    rateLimitMaxEntries: overrides?.rateLimitMaxEntries ?? Number(env.RATE_LIMIT_MAX_ENTRIES || 2000),
    trustProxy,
    // IoT and Operator Authentication
    operatorAccountsJson: overrides?.operatorAccountsJson ?? (env.OPERATOR_ACCOUNTS_JSON || '[]'),
    gatewayTokenSecret,
    tokenExpirySec: overrides?.tokenExpirySec ?? Number(env.TOKEN_EXPIRY_SEC || 14400),
    enableActuators: overrides?.enableActuators ?? (env.ENABLE_ACTUATOR_COMMANDS === 'true'),
    maxImageBytes: overrides?.maxImageBytes ?? Number(env.MAX_IMAGE_BYTES || 65536),
    imageStaleTtlMs: overrides?.imageStaleTtlMs ?? Number(env.IMAGE_STALE_TTL_MS || 60000),
    maxSseClientsPerIp: overrides?.maxSseClientsPerIp ?? Number(env.MAX_SSE_CLIENTS_PER_IP || 3),
    loginRateLimitMax: overrides?.loginRateLimitMax ?? Number(env.LOGIN_RATE_LIMIT_MAX || 5),
    loginRateLimitWindowMs: overrides?.loginRateLimitWindowMs ?? Number(env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    // MQTT Configuration
    mqttEnabled,
    mqttBrokerUrl,
    mqttUsername: overrides?.mqttUsername ?? env.MQTT_USERNAME,
    mqttPassword: overrides?.mqttPassword ?? env.MQTT_PASSWORD,
    mqttClientId:
      overrides?.mqttClientId ??
      (env.MQTT_CLIENT_ID || 'agrapatha-gateway-client'),
    mqttConnectTimeoutMs: overrides?.mqttConnectTimeoutMs ?? Number(env.MQTT_CONNECT_TIMEOUT_MS || 10000),
    mqttReconnectPeriodMs: overrides?.mqttReconnectPeriodMs ?? Number(env.MQTT_RECONNECT_PERIOD_MS || 5000),
    mqttKeepaliveSec: overrides?.mqttKeepaliveSec ?? Number(env.MQTT_KEEPALIVE_SEC || 60),
    mqttTelemetryTopic: overrides?.mqttTelemetryTopic ?? (env.MQTT_TELEMETRY_TOPIC || 'agrapatha/telemetry'),
    mqttImageTopic: overrides?.mqttImageTopic ?? (env.MQTT_IMAGE_TOPIC || 'grenvis/vision/image'),
  };
}
