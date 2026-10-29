import mqtt, { type IClientOptions } from 'mqtt';
import type { ImageStore } from './imageStore.ts';
import type { TelemetryHub } from './telemetryHub.ts';

export interface MqttClientLike {
  on(event: 'connect', listener: (ack: unknown) => void): this;
  on(event: 'message', listener: (topic: string, payload: Buffer, packet: unknown) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'offline', listener: () => void): this;
  on(event: 'reconnect', listener: () => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  subscribe(
    topic: string | string[],
    options: unknown,
    callback?: (err: Error | null, granted: unknown[]) => void
  ): this;
  unsubscribe(topic: string | string[], options?: unknown, callback?: (err?: Error) => void): this;
  end(force?: boolean, options?: unknown, callback?: () => void): this;
  connected?: boolean;
}

export type MqttClientFactory = (url: string, opts: IClientOptions) => MqttClientLike;

export interface MqttAdapterOptions {
  brokerUrl: string;
  username?: string;
  password?: string;
  clientId?: string;
  connectTimeoutMs?: number;
  reconnectPeriodMs?: number;
  keepaliveSec?: number;
  telemetryTopic?: string;
  imageTopic?: string;
  caCert?: string;
  rejectUnauthorized?: boolean;
  clientFactory?: MqttClientFactory;
}

/**
 * Production-conscious, read-only MQTT Gateway Adapter for EMQX Cloud integration.
 * Subscribes ONLY to canonical telemetry and raw binary camera image topics.
 * Enforces strict TLS verification and zero-command publishing boundary.
 */
export class MqttGatewayAdapter {
  private client: MqttClientLike | null = null;
  private isConnectedState = false;
  private readonly telemetryHub: TelemetryHub;
  private readonly imageStore: ImageStore;
  private readonly options: MqttAdapterOptions;
  private readonly telemetryTopic: string;
  private readonly imageTopic: string;
  private readonly approvedTopics: Set<string>;

  constructor(
    telemetryHub: TelemetryHub,
    imageStore: ImageStore,
    options: MqttAdapterOptions
  ) {
    if (!options.brokerUrl || options.brokerUrl.trim() === '') {
      throw new Error('MQTT broker URL is required');
    }

    // Security Gate: Strict TLS verification must NEVER be disabled
    if (options.rejectUnauthorized === false) {
      throw new Error('SECURITY VIOLATION: rejectUnauthorized cannot be set to false.');
    }

    this.telemetryHub = telemetryHub;
    this.imageStore = imageStore;
    this.options = options;

    this.telemetryTopic = options.telemetryTopic || 'agrapatha/telemetry';
    this.imageTopic = options.imageTopic || 'grenvis/vision/image';
    this.approvedTopics = new Set([this.telemetryTopic, this.imageTopic]);
  }

  /**
   * Initializes the MQTT client and establishes connection with the broker.
   */
  public start(): void {
    if (this.client) {
      return; // Already started
    }

    const {
      brokerUrl,
      username,
      password,
      clientId,
      connectTimeoutMs = 10000,
      reconnectPeriodMs = 5000,
      keepaliveSec = 60,
      caCert,
      clientFactory,
    } = this.options;

    const clientOpts: IClientOptions = {
      clientId,
      username,
      password,
      connectTimeout: connectTimeoutMs,
      reconnectPeriod: reconnectPeriodMs,
      keepalive: keepaliveSec,
      clean: true,
      rejectUnauthorized: true, // Strict certificate validation
      ca: caCert ? [caCert] : undefined,
    };

    const factory: MqttClientFactory = clientFactory || ((url, opts) => mqtt.connect(url, opts) as unknown as MqttClientLike);

    try {
      this.client = factory(brokerUrl, clientOpts);
    } catch {
      // Catch synchronous connection factory errors safely without crashing HTTP server
      this.isConnectedState = false;
      return;
    }

    this.client.on('connect', () => {
      this.isConnectedState = true;
      this.subscribeApprovedTopics();
    });

    this.client.on('message', (topic: string, payload: Buffer) => {
      this.handleIncomingMessage(topic, payload);
    });

    this.client.on('error', () => {
      // Handle connection or protocol errors safely without leaking credentials
      this.isConnectedState = false;
    });

    this.client.on('close', () => {
      this.isConnectedState = false;
    });

    this.client.on('offline', () => {
      this.isConnectedState = false;
    });

    this.client.on('reconnect', () => {
      // Reconnect event emitted when attempting reconnection
    });
  }

  /**
   * Subscribes strictly to approved topics.
   * Explicitly avoids subscribing to actuator commands or legacy duplicate topics.
   */
  private subscribeApprovedTopics(): void {
    if (!this.client) return;

    const topics = Array.from(this.approvedTopics);
    this.client.subscribe(topics, { qos: 1 }, (err) => {
      if (err) {
        // Subscription error handled safely
      }
    });
  }

  /**
   * Routes incoming messages safely based on topic allowlist.
   * Unapproved topics are strictly dropped.
   */
  private handleIncomingMessage(topic: string, payload: Buffer): void {
    if (!this.approvedTopics.has(topic)) {
      return; // Dropped: unapproved topic
    }

    try {
      if (topic === this.telemetryTopic) {
        // Telemetry payload is UTF-8 JSON
        const text = payload.toString('utf-8');
        this.telemetryHub.ingestTelemetry(text);
      } else if (topic === this.imageTopic) {
        // Camera frame is raw binary JPEG; do NOT convert to string
        const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        this.imageStore.ingestFrame(buffer);
      }
    } catch {
      // Ensure bad payloads cannot crash process
    }
  }

  /**
   * Returns current broker connection state for /health reporting.
   */
  public isConnected(): boolean {
    return this.isConnectedState;
  }

  /**
   * Gracefully unsubscribes and terminates the MQTT connection.
   */
  public async destroy(): Promise<void> {
    this.isConnectedState = false;
    if (!this.client) return;

    const client = this.client;
    this.client = null;

    return new Promise((resolve) => {
      try {
        const topics = Array.from(this.approvedTopics);
        client.unsubscribe(topics, {}, () => {
          client.end(true, {}, () => {
            resolve();
          });
        });
      } catch {
        resolve();
      }
    });
  }
}
