import { createServer, type Server } from 'node:http';
import { loadAccountStore, type OperatorAccount } from './auth/accountStore.ts';
import { BoundedCache } from './cache.ts';
import { RequestCoalescer } from './coalescer.ts';
import { loadConfig } from './config.ts';
import { ImageStore } from './iot/imageStore.ts';
import { MqttGatewayAdapter } from './iot/mqttAdapter.ts';
import { TelemetryHub } from './iot/telemetryHub.ts';
import { BoundedRateLimiter } from './rateLimiter.ts';
import { handleRequest } from './router.ts';
import type { GatewayConfig, ServerDependencies, UpstreamPayload } from './types.ts';

export interface GatewayInstance {
  server: Server;
  config: GatewayConfig;
  forecastCache: BoundedCache<UpstreamPayload>;
  nowcastCache: BoundedCache<UpstreamPayload>;
  coalescer: RequestCoalescer<UpstreamPayload>;
  rateLimiter: BoundedRateLimiter;
  loginRateLimiter: BoundedRateLimiter;
  telemetryHub: TelemetryHub;
  imageStore: ImageStore;
  accountStore: Map<string, OperatorAccount>;
  mqttAdapter?: MqttGatewayAdapter;
}

/**
 * Creates and configures the native Node.js HTTP Gateway Server.
 * Supports full dependency injection (clock, fetch, config, stores, mqttAdapter) for unit and integration testing.
 */
export function createGatewayServer(dependencies: ServerDependencies = {}): GatewayInstance {
  const config = loadConfig(dependencies.config);
  const now = dependencies.now || Date.now;
  const fetchFn = dependencies.fetch || globalThis.fetch;
  const startTime = now();

  const forecastCache = new BoundedCache<UpstreamPayload>(
    config.forecastCacheMaxEntries,
    config.forecastCacheTtlMs,
    now
  );

  const nowcastCache = new BoundedCache<UpstreamPayload>(
    config.nowcastCacheMaxEntries,
    config.nowcastCacheTtlMs,
    now
  );

  const coalescer = new RequestCoalescer<UpstreamPayload>();

  const rateLimiter = new BoundedRateLimiter(
    config.rateLimitMaxRequests,
    config.rateLimitWindowMs,
    config.rateLimitMaxEntries,
    now
  );

  const loginRateLimiter = new BoundedRateLimiter(
    config.loginRateLimitMax,
    config.loginRateLimitWindowMs,
    config.rateLimitMaxEntries,
    now
  );

  const telemetryHub =
    dependencies.telemetryHub ||
    new TelemetryHub({
      maxClientsPerIp: config.maxSseClientsPerIp,
    });

  const imageStore =
    dependencies.imageStore ||
    new ImageStore({
      maxFrameBytes: config.maxImageBytes,
      staleTtlMs: config.imageStaleTtlMs,
    });

  const accountStore =
    dependencies.accountStore || loadAccountStore(config.operatorAccountsJson);

  let mqttAdapter = dependencies.mqttAdapter;
  if (!mqttAdapter && config.mqttEnabled) {
    mqttAdapter = new MqttGatewayAdapter(telemetryHub, imageStore, {
      brokerUrl: config.mqttBrokerUrl,
      username: config.mqttUsername,
      password: config.mqttPassword,
      clientId: config.mqttClientId,
      connectTimeoutMs: config.mqttConnectTimeoutMs,
      reconnectPeriodMs: config.mqttReconnectPeriodMs,
      keepaliveSec: config.mqttKeepaliveSec,
      telemetryTopic: config.mqttTelemetryTopic,
      imageTopic: config.mqttImageTopic,
    });
    mqttAdapter.start();
  }

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, {
        config,
        forecastCache,
        nowcastCache,
        coalescer,
        rateLimiter,
        loginRateLimiter,
        telemetryHub,
        imageStore,
        accountStore,
        mqttAdapter,
        startTime,
        now,
        fetchFn,
      });
    } catch {
      // Top-level catch-all: ensure socket never hangs and no stack trace is leaked
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }));
      }
    }
  });

  server.on('close', async () => {
    telemetryHub.destroy();
    if (mqttAdapter) {
      await mqttAdapter.destroy();
    }
  });

  return {
    server,
    config,
    forecastCache,
    nowcastCache,
    coalescer,
    rateLimiter,
    loginRateLimiter,
    telemetryHub,
    imageStore,
    accountStore,
    mqttAdapter,
  };
}
