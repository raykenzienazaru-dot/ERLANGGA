import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { getMqttConfig, parseTelemetryPayload } from './mqttService.ts';

describe('MQTT Subsystem & EMQX Cloud Configuration Tests', () => {
  test('1. Default EMQX configuration resolves to Port 8084 for browser WSS', () => {
    const config = getMqttConfig();
    assert.equal(config.host, 'wfc1ec11.ala.asia-southeast1.emqxsl.com');
    assert.equal(config.wsPort, 8084, 'Browser WebSocket port must be 8084');
    assert.equal(config.tcpPort, 8883, 'Hardware native TLS port must be 8883');
    assert.equal(config.wsPath, '/mqtt');
    assert.ok(
      config.brokerUrl.startsWith('wss://'),
      'Broker URL for browser must use secure WebSockets (wss://)'
    );
    assert.ok(
      config.brokerUrl.includes(':8084/mqtt'),
      'Broker URL must route to port 8084 with /mqtt path'
    );
  });

  test('2. Topics follow standard AGRAPATHA namespaces', () => {
    const config = getMqttConfig();
    assert.equal(config.topics.telemetry, 'agrapatha/telemetry');
    assert.equal(config.topics.commands, 'agrapatha/commands');
    assert.equal(config.topics.status, 'agrapatha/status');
  });

  test('3. parseTelemetryPayload parses valid JSON sensor telemetry', () => {
    const raw = JSON.stringify({
      temp: 29.4,
      rh: 42.1,
      soilMoisture: 25.0,
      wind: 3.5,
      rain: 0.0,
      lightLux: 45000,
      nodeId: 'ESP32-NODE-01',
    });

    const parsed = parseTelemetryPayload(raw);
    assert.ok(parsed !== null);
    assert.equal(parsed?.temp, 29.4);
    assert.equal(parsed?.rh, 42.1);
    assert.equal(parsed?.soilMoisture, 25.0);
    assert.equal(parsed?.wind, 3.5);
    assert.equal(parsed?.rain, 0.0);
    assert.equal(parsed?.lightLux, 45000);
    assert.equal(parsed?.nodeId, 'ESP32-NODE-01');
  });

  test('4. parseTelemetryPayload handles partial fields safely', () => {
    const raw = JSON.stringify({
      temp: 31.0,
      rh: 50.0,
    });

    const parsed = parseTelemetryPayload(raw);
    assert.ok(parsed !== null);
    assert.equal(parsed?.temp, 31.0);
    assert.equal(parsed?.rh, 50.0);
    assert.equal(parsed?.soilMoisture, undefined);
  });

  test('5. parseTelemetryPayload rejects malformed or invalid inputs', () => {
    assert.equal(parseTelemetryPayload('invalid-json'), null);
    assert.equal(parseTelemetryPayload(''), null);
    assert.equal(parseTelemetryPayload('12345'), null);
    assert.equal(parseTelemetryPayload('null'), null);
  });

  test('6. parseTelemetryPayload handles Uint8Array binary buffers', () => {
    const rawObj = { temp: 27.8, rh: 60 };
    const buffer = new TextEncoder().encode(JSON.stringify(rawObj));
    const parsed = parseTelemetryPayload(buffer);
    assert.ok(parsed !== null);
    assert.equal(parsed?.temp, 27.8);
    assert.equal(parsed?.rh, 60);
  });

  test('7. parseTelemetryPayload parses Rain, LDR, and Vision payloads from ESP32 firmware', () => {
    const raw = JSON.stringify({
      temperature: 28.2,
      humidity: 58.5,
      soil_moisture: 33.1,
      soil_raw: 2150,
      rain_raw: 2400,
      rain: 2.5,
      rain_status: 'GERIMIS',
      ldr_raw: 1200,
      light_lux: 48000,
      esp32_mac: '8C:AA:B5:37:71:18',
      motor_state: 'STOPPED',
      vision_prediction: 'Fire',
      vision_confidence: 92.4,
    });

    const parsed = parseTelemetryPayload(raw);
    assert.ok(parsed !== null);
    assert.equal(parsed?.temp, 28.2);
    assert.equal(parsed?.rh, 58.5);
    assert.equal(parsed?.soilMoisture, 33.1);
    assert.equal(parsed?.soilRaw, 2150);
    assert.equal(parsed?.rain, 2.5);
    assert.equal(parsed?.rainRaw, 2400);
    assert.equal(parsed?.rainStatus, 'GERIMIS');
    assert.equal(parsed?.lightLux, 48000);
    assert.equal(parsed?.ldrRaw, 1200);
    assert.equal(parsed?.nodeId, '8C:AA:B5:37:71:18');
    assert.equal(parsed?.motorState, 'STOPPED');
    assert.equal(parsed?.visionPrediction, 'Fire');
    assert.equal(parsed?.visionConfidence, 92.4);
  });

  test('8. parseTelemetryPayload parses L298N OUT3/OUT4 motor state and is_realtime flag', () => {
    const raw = JSON.stringify({
      temp: 26.8,
      rh: 64.2,
      soilMoisture: 42.5,
      soil_raw: 1850,
      rain: 0.0,
      rain_status: 'KERING',
      rain_raw: 3850,
      lightLux: 35200,
      ldr_raw: 1420,
      motor_state: 'RIGHT',
      motor_driver: 'L298N_OUT3_OUT4',
      is_realtime: true,
      limit_left: false,
      limit_right: true,
    });

    const parsed = parseTelemetryPayload(raw);
    assert.ok(parsed !== null);
    assert.equal(parsed?.temp, 26.8);
    assert.equal(parsed?.rh, 64.2);
    assert.equal(parsed?.soilMoisture, 42.5);
    assert.equal(parsed?.soilRaw, 1850);
    assert.equal(parsed?.rain, 0.0);
    assert.equal(parsed?.rainStatus, 'KERING');
    assert.equal(parsed?.lightLux, 35200);
    assert.equal(parsed?.motorState, 'RIGHT');
    assert.equal(parsed?.motorDriver, 'L298N_OUT3_OUT4');
    assert.equal(parsed?.isRealtime, true);
    assert.equal(parsed?.limitLeft, false);
    assert.equal(parsed?.limitRight, true);
  });
});

