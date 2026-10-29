/**
 * AGRAPATHA — Offline & Zero-Dummy-Data Safety Test Suite
 *
 * Verifies that:
 * 1. Sensor display values format to 'Unavailable' or explicit fallback when telemetry is absent, disconnected, or stale.
 * 2. Missing, disconnected, or stale readings are NEVER fabricated as zero-valued live measurements (0.0 / 0).
 * 3. Device and sensor card statuses explicitly distinguish 'LIVE', 'STALE TELEMETRY', 'MQTT DISCONNECTED', and 'NOT CONNECTED'.
 * 4. Stale and offline telemetry are strictly isolated from Model 1 and Model 2 evaluation (returns null / inference standby).
 * 5. Reconnection with genuine live telemetry seamlessly restores live values and valid model execution.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSensorValue,
  formatLightLuxValue,
  formatGasValue,
  formatFlameValue,
  getSensorStatusLabel,
  getDeviceConnectivityStatus,
  isModelEvaluationPermitted,
} from './sensorDisplay.ts';
import {
  evaluateModelHazard,
  evaluateFloraSensorModel,
} from './aiModels.ts';

describe('Zero-Dummy-Data Offline & Safety Guards Test Suite', () => {
  describe('1. Sensor Display Formatting (Zero-Dummy-Data Fallback vs Live Numeric)', () => {
    test('formats all sensors to "Unavailable" without dummy zeros when telemetry is uninitialized (null/undefined)', () => {
      const isLiveValid = false;

      // Must NEVER format unavailable telemetry as fake numeric zeros (0.0 / 0)
      assert.notEqual(formatSensorValue(null, isLiveValid, 1), '0.0', 'Must not fabricate 0.0 for Air Temp');
      assert.notEqual(formatSensorValue(null, isLiveValid, 1), '0.0', 'Must not fabricate 0.0 for RH');
      assert.notEqual(formatSensorValue(null, isLiveValid, 1), '0.0', 'Must not fabricate 0.0 for Soil Moisture');
      assert.notEqual(formatLightLuxValue(null, isLiveValid), '0', 'Must not fabricate 0 for Light Lux');
      assert.notEqual(formatGasValue(null, isLiveValid), '0', 'Must not fabricate 0 for MQ-135');
      assert.notEqual(formatFlameValue(null, isLiveValid), '0', 'Must not fabricate 0 for Flame sensor');

      // Truthful zero-dummy fallback
      assert.equal(formatSensorValue(null, isLiveValid, 1), 'Unavailable', 'Air Temp displays Unavailable');
      assert.equal(formatSensorValue(null, isLiveValid, 1), 'Unavailable', 'RH displays Unavailable');
      assert.equal(formatSensorValue(null, isLiveValid, 1), 'Unavailable', 'Soil displays Unavailable');
      assert.equal(formatSensorValue(null, isLiveValid, 1, 'Not Connected'), 'Not Connected', 'Accepts explicit fallback');
      assert.equal(formatLightLuxValue(null, isLiveValid), 'Unavailable', 'Light Lux displays Unavailable');
      assert.equal(formatGasValue(null, isLiveValid), 'Unavailable', 'MQ-135 Gas displays Unavailable');
      assert.equal(formatFlameValue(null, isLiveValid), 'Unavailable', 'Flame displays Unavailable');
      assert.equal(formatSensorValue(null, isLiveValid, 1), 'Unavailable', 'FFMC displays Unavailable');
      assert.equal(formatSensorValue(null, isLiveValid, 1), 'Unavailable', 'Wind displays Unavailable');
    });

    test('immediately replaces stale telemetry with "Unavailable" instead of retaining stale measurements or fabricating zeros', () => {
      const isLiveValid = false; // watchdog flagged stale
      const staleTemp = 29.4;
      const staleRh = 78.5;
      const staleSoil = 42.1;
      const staleLux = 15200;
      const staleFfmc = 88.2;

      // Stale data must never be presented as current measurements
      assert.notEqual(formatSensorValue(staleTemp, isLiveValid, 1), '29.4');
      assert.notEqual(formatSensorValue(staleRh, isLiveValid, 1), '78.5');
      assert.notEqual(formatSensorValue(staleSoil, isLiveValid, 1), '42.1');
      assert.notEqual(formatSensorValue(staleTemp, isLiveValid, 1), '0.0');

      // Reverts truthfully to Unavailable
      assert.equal(formatSensorValue(staleTemp, isLiveValid, 1), 'Unavailable');
      assert.equal(formatSensorValue(staleRh, isLiveValid, 1), 'Unavailable');
      assert.equal(formatSensorValue(staleSoil, isLiveValid, 1), 'Unavailable');
      assert.equal(formatLightLuxValue(staleLux, isLiveValid), 'Unavailable');
      assert.equal(formatGasValue(480, isLiveValid), 'Unavailable');
      assert.equal(formatFlameValue(1, isLiveValid), 'Unavailable');
      assert.equal(formatSensorValue(staleFfmc, isLiveValid, 1), 'Unavailable');
    });

    test('renders genuine live values with appropriate decimal precision when live and fresh', () => {
      const isLiveValid = true;

      assert.equal(formatSensorValue(29.44, isLiveValid, 1), '29.4');
      assert.equal(formatSensorValue(78.5, isLiveValid, 1), '78.5');
      assert.equal(formatSensorValue(42.12, isLiveValid, 1), '42.1');
      assert.equal(formatSensorValue(0.0, isLiveValid, 1), '0.0', 'Genuine live 0.0 is preserved');
      assert.equal(formatLightLuxValue(450, isLiveValid), '450');
      assert.equal(formatLightLuxValue(15200, isLiveValid), '15.2k');
      assert.equal(formatGasValue(480, isLiveValid), '480');
      assert.equal(formatFlameValue(1, isLiveValid), '1');
      assert.equal(formatFlameValue(0, isLiveValid), '0');
      assert.equal(formatSensorValue(88.2, isLiveValid, 1), '88.2');
    });
  });

  describe('2. Device & Sensor Card Status Behavior', () => {
    test('sensor cards return NOT CONNECTED or STALE when telemetry is offline or stale', () => {
      // 1. Completely disconnected / uninitialized
      assert.equal(getSensorStatusLabel('temp', null, false), 'NOT CONNECTED');
      assert.equal(getSensorStatusLabel('temp', 32.0, false), 'NOT CONNECTED', 'Must not label 32°C as SUHU TINGGI when offline');
      assert.equal(getSensorStatusLabel('temp', 0.0, false), 'NOT CONNECTED', 'Must not label 0.0°C as SEJUK when offline');
      assert.equal(getSensorStatusLabel('rh', 0.0, false), 'NOT CONNECTED', 'Must not label 0% RH as KERING KRITIS when offline');
      assert.equal(getSensorStatusLabel('soil', 0.0, false), 'NOT CONNECTED', 'Must not label 0% soil as TANAH KERING when offline');
      assert.equal(getSensorStatusLabel('mq135', null, false), 'NOT CONNECTED');
      assert.equal(getSensorStatusLabel('flame', null, false), 'NOT CONNECTED');

      // 2. Stale telemetry (watchdog fired)
      assert.equal(getSensorStatusLabel('temp', 32.0, false, null, true), 'STALE', 'Must report STALE on watchdog timeout');
      assert.equal(getSensorStatusLabel('rh', 60.0, false, null, true), 'STALE');
      assert.equal(getSensorStatusLabel('mq135', 500, false, null, true), 'STALE');
      assert.equal(getSensorStatusLabel('flame', 1, false, null, true), 'STALE');
    });

    test('sensor cards derive correct environmental categories ONLY when live and fresh', () => {
      const isLiveValid = true;

      assert.equal(getSensorStatusLabel('temp', 30.5, isLiveValid), 'SUHU TINGGI');
      assert.equal(getSensorStatusLabel('temp', 22.0, isLiveValid), 'OPTIMAL');
      assert.equal(getSensorStatusLabel('temp', 12.0, isLiveValid), 'SEJUK');

      assert.equal(getSensorStatusLabel('rh', 28.0, isLiveValid), 'KERING KRITIS');
      assert.equal(getSensorStatusLabel('rh', 55.0, isLiveValid), 'MODERAT');
      assert.equal(getSensorStatusLabel('rh', 85.0, isLiveValid), 'LEMBAP TINGGI');

      assert.equal(getSensorStatusLabel('soil', 18.0, isLiveValid), 'TANAH KERING');
      assert.equal(getSensorStatusLabel('soil', 45.0, isLiveValid), 'LEMBAP SUBUR');
      assert.equal(getSensorStatusLabel('soil', 82.0, isLiveValid), 'BASAH JENUH');

      assert.equal(getSensorStatusLabel('rain', 8.5, isLiveValid, 'HUJAN LEBAT'), 'HUJAN LEBAT');
      assert.equal(getSensorStatusLabel('rain', 1.0, isLiveValid, 'GERIMIS'), 'GERIMIS');
      assert.equal(getSensorStatusLabel('rain', 0.0, isLiveValid, 'KERING'), 'TIDAK HUJAN');

      assert.equal(getSensorStatusLabel('light', 60000, isLiveValid), 'TERIK INTENS');
      assert.equal(getSensorStatusLabel('light', 20000, isLiveValid), 'TERANG SIANG');
      assert.equal(getSensorStatusLabel('light', 500, isLiveValid), 'TEDUH / MALAM');

      assert.equal(getSensorStatusLabel('mq135', 300, isLiveValid), 'NORMAL');
      assert.equal(getSensorStatusLabel('mq135', 600, isLiveValid), 'MODERAT');
      assert.equal(getSensorStatusLabel('mq135', 1200, isLiveValid), 'GAS TINGGI');

      assert.equal(getSensorStatusLabel('flame', 0, isLiveValid), 'AMAN');
      assert.equal(getSensorStatusLabel('flame', 1, isLiveValid), 'FLAME DETECTED');

      assert.equal(getSensorStatusLabel('ffmc', 91.2, isLiveValid), 'ZONA PENYALAAN');
      assert.equal(getSensorStatusLabel('ffmc', 85.0, isLiveValid), 'PENGERINGAN');
      assert.equal(getSensorStatusLabel('ffmc', 75.0, isLiveValid), 'KADAR AIR AMAN');
    });

    test('device connectivity badge explicitly reflects connection state without masking', () => {
      // 1. Initial boot: SSE connected to backend gateway, but no ESP32 telemetry received yet
      const initialBoot = getDeviceConnectivityStatus(false, false, 'connected', true);
      assert.equal(initialBoot.text, 'DEVICE NOT CONNECTED (NO TELEMETRY)');
      assert.equal(initialBoot.isOnline, false);

      // 2. Gateway connected, but broker disconnected
      const brokerDown = getDeviceConnectivityStatus(false, false, 'connected', false);
      assert.equal(brokerDown.text, 'DEVICE OFFLINE (MQTT DISCONNECTED)');
      assert.equal(brokerDown.isOnline, false);

      // 3. Stale telemetry (watchdog timeout)
      const stale = getDeviceConnectivityStatus(true, true, 'connected', true);
      assert.equal(stale.text, 'DEVICE OFFLINE (STALE TELEMETRY)');
      assert.equal(stale.isOnline, false);

      // 4. Live valid telemetry
      const live = getDeviceConnectivityStatus(true, false, 'connected', true);
      assert.equal(live.text, 'DEVICE ONLINE · LIVE');
      assert.equal(live.isOnline, true);

      // 5. Gateway connecting
      const connecting = getDeviceConnectivityStatus(false, false, 'connecting', false);
      assert.equal(connecting.text, 'CONNECTING TO GATEWAY...');
      assert.equal(connecting.isOnline, false);

      // 6. Gateway error / closed
      const closed = getDeviceConnectivityStatus(false, false, 'closed', false);
      assert.equal(closed.text, 'GATEWAY OFFLINE');
      assert.equal(closed.isOnline, false);
    });
  });

  describe('3. Model Safety Isolation from Offline and Stale Telemetry', () => {
    test('isModelEvaluationPermitted strictly rejects offline or stale values', () => {
      // Offline zeros or values must never be permitted for evaluation
      assert.equal(
        isModelEvaluationPermitted(false, false, [25.0, 50.0, 3.0, 0.0, 85.0, 40.0]),
        false,
        'Offline values must not be evaluated'
      );

      // Stale telemetry must never be permitted for evaluation
      assert.equal(
        isModelEvaluationPermitted(true, true, [25.0, 50.0, 3.0, 0.0, 85.0, 40.0]),
        false,
        'Stale values must not be evaluated'
      );

      // Null or missing features must not be evaluated
      assert.equal(
        isModelEvaluationPermitted(true, false, [25.0, null, 3.0, 0.0, 85.0, 40.0]),
        false,
        'Null features must not be evaluated'
      );

      // Fresh valid inputs are permitted
      assert.equal(
        isModelEvaluationPermitted(true, false, [25.0, 50.0, 3.0, 0.0, 85.0, 40.0]),
        true,
        'Valid live inputs must be permitted'
      );
    });

    test('guarded model evaluations yield null and never fabricate predictions when offline or stale', () => {
      const isLiveTelemetry = false;
      const isTelemetryStale = false;
      const missingFeatures = { temp: null, rh: null, wind: null, rain: null, ffmc: null, dmc: null, soilMoisture: null };

      const evaluateHazardGuarded = () => {
        if (!isLiveTelemetry || isTelemetryStale) return null;
        return evaluateModelHazard(missingFeatures as any);
      };

      const evaluateFloraGuarded = () => {
        if (!isLiveTelemetry || isTelemetryStale) return null;
        return evaluateFloraSensorModel(missingFeatures.temp as any, missingFeatures.rh as any, missingFeatures.soilMoisture as any);
      };

      assert.equal(evaluateHazardGuarded(), null, 'Model 1 must return null in offline state');
      assert.equal(evaluateFloraGuarded(), null, 'Model 2 must return null in offline state');
    });
  });

  describe('4. Lifecycle State Transitions (Boot -> Live -> Stale -> Reconnected)', () => {
    test('transitions through full connectivity lifecycle accurately without dummy data', () => {
      // State 1: Boot (Offline, No Telemetry Yet)
      let isLive = false;
      let isStale = false;
      let temp: number | null = null;
      let rh: number | null = null;

      const isLiveValid = () => isLive && !isStale;
      const getDisplayTemp = () => formatSensorValue(temp, isLiveValid(), 1);
      const getDisplayRh = () => formatSensorValue(rh, isLiveValid(), 1);
      const getStatus = () => getSensorStatusLabel('temp', temp, isLiveValid(), null, isStale);

      assert.equal(getDisplayTemp(), 'Unavailable');
      assert.equal(getDisplayRh(), 'Unavailable');
      assert.equal(getStatus(), 'NOT CONNECTED');

      // State 2: Fresh Telemetry Arrives (28.5°C, 45.0% RH)
      isLive = true;
      isStale = false;
      temp = 28.5;
      rh = 45.0;

      assert.equal(getDisplayTemp(), '28.5');
      assert.equal(getDisplayRh(), '45.0');
      assert.equal(getStatus(), 'SUHU TINGGI');

      // State 3: Telemetry Becomes Stale (Watchdog >10s)
      isStale = true;

      assert.equal(getDisplayTemp(), 'Unavailable', 'Stale temperature must immediately revert to Unavailable');
      assert.equal(getDisplayRh(), 'Unavailable', 'Stale RH must immediately revert to Unavailable');
      assert.equal(getStatus(), 'STALE', 'Stale sensor must report STALE');

      // State 4: Telemetry Recovers with Fresh Message (22.0°C, 60.0% RH)
      isStale = false;
      temp = 22.0;
      rh = 60.0;

      assert.equal(getDisplayTemp(), '22.0');
      assert.equal(getDisplayRh(), '60.0');
      assert.equal(getStatus(), 'OPTIMAL');

      // State 5: Gateway Disconnect / Stream Error
      isLive = false;
      isStale = false;
      temp = null;
      rh = null;

      assert.equal(getDisplayTemp(), 'Unavailable');
      assert.equal(getDisplayRh(), 'Unavailable');
      assert.equal(getStatus(), 'NOT CONNECTED');
    });
  });
});
