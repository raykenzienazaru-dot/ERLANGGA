/**
 * Flora AI Dashboard — BMKG Integration Unit Tests
 * Uses Node 24 native test runner with no external test dependencies.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import {
  parseBmkgForecast,
  isValidAdm4Code,
  normalizeForecastStep,
  getTimezoneLabel,
} from './bmkgForecastParser.ts';
import { parseBmkgWarnings } from './bmkgWarningParser.ts';
import {
  evaluateCacheFreshness,
  formatDataAge,
  FRESH_THRESHOLD_MS,
  STALE_THRESHOLD_MS,
  DISCARD_THRESHOLD_MS,
  getBmkgRegionalData,
  getBmkgWarnings,
  clearBmkgCache,
} from './bmkgService.ts';
import type { BmkgRegionRecord } from '../types/bmkg.ts';

// Official reference fixture sample modeled from infoBMKG/data-cuaca/31.71.01.1001.json
const OFFICIAL_FIXTURE_SAMPLE = {
  lokasi: {
    adm1: '31',
    adm2: '31.71',
    adm3: '31.71.01',
    adm4: '31.71.01.1001',
    provinsi: 'DKI Jakarta',
    kotkab: 'Kota Adm. Jakarta Pusat',
    kecamatan: 'Gambir',
    desa: 'Gambir',
    lon: 106.8267073562,
    lat: -6.1763842693,
    timezone: 'Asia/Jakarta',
  },
  data: [
    {
      lokasi: {
        adm1: '31',
        adm2: '31.71',
        adm3: '31.71.01',
        adm4: '31.71.01.1001',
        provinsi: 'DKI Jakarta',
        kotkab: 'Kota Adm. Jakarta Pusat',
        kecamatan: 'Gambir',
        desa: 'Gambir',
        lon: 106.8267073562,
        lat: -6.1763842693,
        timezone: '+0700',
        type: 'adm4',
      },
      cuaca: [
        // Group 1 (Day 0)
        [
          {
            datetime: '2025-10-12T08:00:00Z',
            t: 32,
            tcc: 79,
            tp: 0.1,
            weather: 2,
            weather_desc: 'Cerah Berawan',
            weather_desc_en: 'Partly Cloudy',
            wd_deg: 19,
            wd: 'N',
            wd_to: 'S',
            ws: 10.1,
            hu: 59,
            vs: 23321,
            vs_text: '> 10 km',
            time_index: '7-8',
            analysis_date: '2025-10-12T00:00:00',
            image: 'https://api-apps.bmkg.go.id/storage/icon/cuaca/cerah berawan-am.svg',
            utc_datetime: '2025-10-12 08:00:00',
            local_datetime: '2025-10-12 15:00:00',
          },
          {
            datetime: '2025-10-12T11:00:00Z',
            t: 30,
            tcc: 100,
            tp: 0,
            weather: 3,
            weather_desc: 'Berawan',
            weather_desc_en: 'Mostly Cloudy',
            wd_deg: 19,
            wd: 'N',
            wd_to: 'S',
            ws: 6.6,
            hu: 72,
            vs: 26936,
            vs_text: '> 10 km',
            time_index: '10-11',
            analysis_date: '2025-10-12T00:00:00',
            utc_datetime: '2025-10-12 11:00:00',
            local_datetime: '2025-10-12 18:00:00',
          },
        ],
        // Group 2 (Day 1) — multi-group traversal test
        [
          {
            datetime: '2025-10-13T00:00:00Z',
            t: 26,
            tcc: 60,
            tp: 0,
            weather: 1,
            weather_desc: 'Cerah',
            weather_desc_en: 'Clear',
            wd_deg: 90,
            wd: 'E',
            wd_to: 'W',
            ws: 4.5,
            hu: 88,
            analysis_date: '2025-10-12T00:00:00',
            utc_datetime: '2025-10-13 00:00:00',
            local_datetime: '2025-10-13 07:00:00',
          },
        ],
      ],
    },
  ],
};

const TEST_REGION: BmkgRegionRecord = {
  adm4: '31.71.01.1001',
  desa: 'Gambir',
  kecamatan: 'Gambir',
  kotkab: 'Kota Adm. Jakarta Pusat',
  provinsi: 'DKI Jakarta',
  timezone: 'Asia/Jakarta',
  coordinates: {
    lat: -6.1763842693,
    lon: 106.8267073562,
  },
  isVerified: true,
};

test('1. Valid adm4 code validation', () => {
  assert.strictEqual(isValidAdm4Code('31.71.01.1001'), true);
  assert.strictEqual(isValidAdm4Code('31.71.03.1001'), true);
  assert.strictEqual(isValidAdm4Code('3171011001'), false); // Requires dots
  assert.strictEqual(isValidAdm4Code('31.71.01'), false);
  assert.strictEqual(isValidAdm4Code('invalid-string'), false);
});

test('2. Parse valid official forecast fixture with multi-group flattening', () => {
  const result = parseBmkgForecast(OFFICIAL_FIXTURE_SAMPLE, 1729000000000);
  assert.strictEqual(result.success, true);
  assert.ok(result.data);

  const forecast = result.data!;
  assert.strictEqual(forecast.adm4, '31.71.01.1001');
  assert.strictEqual(forecast.hierarchy.village, 'Gambir');
  assert.strictEqual(forecast.hierarchy.district, 'Gambir');
  assert.strictEqual(forecast.hierarchy.regency, 'Kota Adm. Jakarta Pusat');
  assert.strictEqual(forecast.timezone, 'Asia/Jakarta');
  assert.strictEqual(forecast.analysisDate, '2025-10-12T00:00:00');

  // Verify multi-group traversal (flattened Day 0 [2 steps] + Day 1 [1 step] = 3 steps)
  assert.strictEqual(forecast.allSteps.length, 3);
  assert.strictEqual(forecast.currentStep.temperatureC, 32);
  assert.strictEqual(forecast.currentStep.humidityPercent, 59);
  assert.strictEqual(forecast.currentStep.windSpeedKmh, 10.1);
  assert.strictEqual(forecast.currentStep.weatherDesc, 'Cerah Berawan');
  assert.strictEqual(forecast.currentStep.localDatetime, '2025-10-12 15:00:00');
  assert.strictEqual(forecast.currentStep.utcDatetime, '2025-10-12 08:00:00');

  // Second step
  assert.strictEqual(forecast.allSteps[1].temperatureC, 30);
  // Third step (from group 2)
  assert.strictEqual(forecast.allSteps[2].temperatureC, 26);
  assert.strictEqual(forecast.allSteps[2].weatherDesc, 'Cerah');
});

test('3. Handle missing optional fields without failing', () => {
  const minimalStep = {
    datetime: '2025-10-12T08:00:00Z',
    utc_datetime: '2025-10-12 08:00:00',
    local_datetime: '2025-10-12 15:00:00',
    t: 28.4,
    hu: 75,
    ws: 5.0,
    // Optional fields omitted: tp, tcc, vs, vs_text, wd_deg, image
  };

  const normalized = normalizeForecastStep(minimalStep);
  assert.ok(normalized);
  assert.strictEqual(normalized!.temperatureC, 28.4);
  assert.strictEqual(normalized!.humidityPercent, 75);
  assert.strictEqual(normalized!.windSpeedKmh, 5.0);
  assert.strictEqual(normalized!.precipitationMm, undefined);
  assert.strictEqual(normalized!.cloudCoverPercent, undefined);
  assert.strictEqual(normalized!.visibilityText, undefined);
});

test('4. Reject malformed and out-of-range forecast data', () => {
  // Temperature out of bounds
  assert.strictEqual(
    normalizeForecastStep({ datetime: '2025-10-12T08:00:00Z', t: 150, hu: 50, ws: 10 }),
    null
  );
  // Negative humidity
  assert.strictEqual(
    normalizeForecastStep({ datetime: '2025-10-12T08:00:00Z', t: 25, hu: -5, ws: 10 }),
    null
  );
  // Missing timestamps
  assert.strictEqual(
    normalizeForecastStep({ t: 25, hu: 50, ws: 10 }),
    null
  );
});

test('5. Reject empty payload or missing data groups', () => {
  const emptyResult = parseBmkgForecast({ lokasi: {}, data: [] });
  assert.strictEqual(emptyResult.success, false);
  assert.strictEqual(emptyResult.isDrift, true);

  const noCuaca = parseBmkgForecast({ lokasi: {}, data: [{ lokasi: {}, cuaca: [] }] });
  assert.strictEqual(noCuaca.success, false);
});

test('6. Parse early weather warning RSS/XML and verify unknown expiration handling', () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Peringatan Dini Cuaca BMKG</title>
    <item>
      <title>Peringatan Dini Cuaca Wilayah DKI Jakarta</title>
      <link>https://www.bmkg.go.id/alerts/nowcast/id/jkt_alert.xml</link>
      <description>Berpotensi terjadi hujan sedang-lebat di Gambir dan sekitarnya.</description>
      <pubDate>Sun, 12 Oct 2025 08:00:00 GMT</pubDate>
      <headline>Peringatan Dini Cuaca Wilayah DKI Jakarta</headline>
      <event>Hujan Sedang-Lebat Disertai Kilat/Petir</event>
      <effective>2025-10-12T08:00:00Z</effective>
      <!-- Note: <expires> is deliberately omitted to test mandatory unknown expiry rule -->
      <senderName>BMKG Jakarta</senderName>
    </item>
  </channel>
</rss>`;

  const result = parseBmkgWarnings(sampleXml, TEST_REGION);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.alerts.length, 1);

  const alert = result.alerts[0];
  assert.strictEqual(alert.headline, 'Peringatan Dini Cuaca Wilayah DKI Jakarta');
  assert.strictEqual(alert.event, 'Hujan Sedang-Lebat Disertai Kilat/Petir');
  // MANDATORY RULE: Never assign arbitrary 6-hour expiration if source provides none!
  assert.strictEqual(alert.validityStatus, 'UNKNOWN_EXPIRY');
  assert.strictEqual(alert.expiresTime, null);

  // MANDATORY RULE: Place name in text alone does NOT equal confirmed geographic match!
  assert.strictEqual(alert.applicability, 'REGIONAL_UNVERIFIED');
});

test('7. Deduplicate identical warnings', () => {
  const duplicateXml = `<rss version="2.0"><channel>
    <item><guid>ALERT-101</guid><headline>Banjir</headline><description>Alert 1</description></item>
    <item><guid>ALERT-101</guid><headline>Banjir</headline><description>Alert 1 duplicate</description></item>
  </channel></rss>`;

  const result = parseBmkgWarnings(duplicateXml, TEST_REGION);
  assert.strictEqual(result.alerts.length, 1);
});

test('8. Cache freshness policy boundaries', () => {
  const now = 1000000000;

  // 0 - 15 minutes: FRESH
  assert.strictEqual(evaluateCacheFreshness(now - 5 * 60 * 1000, now), 'FRESH');
  assert.strictEqual(evaluateCacheFreshness(now - FRESH_THRESHOLD_MS, now), 'FRESH');

  // > 15 - 60 minutes: STALE_USABLE
  assert.strictEqual(evaluateCacheFreshness(now - 20 * 60 * 1000, now), 'STALE_USABLE');
  assert.strictEqual(evaluateCacheFreshness(now - STALE_THRESHOLD_MS, now), 'STALE_USABLE');

  // > 60 minutes - 24 hours: EXPIRED_UNUSABLE
  assert.strictEqual(evaluateCacheFreshness(now - 90 * 60 * 1000, now), 'EXPIRED_UNUSABLE');
  assert.strictEqual(evaluateCacheFreshness(now - 12 * 60 * 60 * 1000, now), 'EXPIRED_UNUSABLE');
  assert.strictEqual(evaluateCacheFreshness(now - DISCARD_THRESHOLD_MS, now), 'EXPIRED_UNUSABLE');

  // > 24 hours: DISCARDED
  assert.strictEqual(evaluateCacheFreshness(now - (DISCARD_THRESHOLD_MS + 1000), now), 'DISCARDED');
});

test('9. Format data age helper', () => {
  const now = 1000000000;
  assert.strictEqual(formatDataAge(now - 10000, now), 'baru saja');
  assert.strictEqual(formatDataAge(now - 12 * 60000, now), '12 menit yang lalu');
  assert.strictEqual(formatDataAge(now - 120 * 60000, now), '2 jam yang lalu');
});

test('10. Service state transitions with mock fixtures and fallback', async () => {
  clearBmkgCache();
  const now = 1729000000000;

  // Fresh retrieval via mock fixture
  const state1 = await getBmkgRegionalData(TEST_REGION, {
    mockFixtureForecast: OFFICIAL_FIXTURE_SAMPLE,
    now,
  });

  assert.strictEqual(state1.status, 'SUCCESS_FRESH');
  assert.ok(state1.forecast);
  assert.strictEqual(state1.forecast!.hierarchy.village, 'Gambir');

  // Cached immediate return within 15 minutes
  const state2 = await getBmkgRegionalData(TEST_REGION, {
    now: now + 5 * 60 * 1000, // 5 min later
  });
  assert.strictEqual(state2.status, 'SUCCESS_FRESH');
  assert.strictEqual(state2.retrievalTimestamp, now);

  // Stale recovery when network fails after 25 minutes
  const state3 = await getBmkgRegionalData(TEST_REGION, {
    now: now + 25 * 60 * 1000, // 25 min later (STALE_USABLE)
    // simulate network failure by passing invalid mock fixture
    mockFixtureForecast: null,
  });
  assert.strictEqual(state3.status, 'SUCCESS_STALE');
  assert.ok(state3.forecast);
  assert.ok(state3.staleReason);

  // Expired suppression when network fails after 90 minutes
  const state4 = await getBmkgRegionalData(TEST_REGION, {
    now: now + 90 * 60 * 1000, // 90 min later (EXPIRED_UNUSABLE)
    mockFixtureForecast: null,
  });
  assert.strictEqual(state4.status, 'EXPIRED');
  assert.strictEqual(state4.forecast, null); // Suppressed from active display
});

test('11. Verify preset administrative configurations and unverified status', () => {
  const presetsJson = JSON.parse(
    fs.readFileSync(new URL('../data/indonesiaAdm4Presets.json', import.meta.url), 'utf-8')
  ) as BmkgRegionRecord[];

  const gambir = presetsJson.find((p) => p.adm4 === '31.71.01.1001');
  assert.ok(gambir);
  assert.strictEqual(gambir.isVerified, true);
  assert.strictEqual(gambir.coordinates.lat, -6.1763842693);
  assert.strictEqual(gambir.coordinates.lon, 106.8267073562);

  const kemayoran = presetsJson.find((p) => p.adm4 === '31.71.03.1001');
  assert.ok(kemayoran);
  // MANDATORY RULE: Kemayoran must be marked false until official boundary confirmation!
  assert.strictEqual(kemayoran.isVerified, false);
});

test('12. Namespaced CAP/XML elements parsing (e.g. <cap:event>, <cap:polygon>)', () => {
  const namespacedCapXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <channel>
    <item>
      <title>Peringatan Dini Wilayah Khusus</title>
      <cap:headline>Peringatan Badai Petir</cap:headline>
      <cap:event>Badai Petir Ekstrem</cap:event>
      <cap:effective>2025-10-15T10:00:00Z</cap:effective>
      <cap:expires>2025-10-15T16:00:00Z</cap:expires>
      <cap:senderName>BMKG Pusat</cap:senderName>
      <cap:polygon>-6.17,106.82 -6.17,106.84 -6.19,106.84 -6.19,106.82 -6.17,106.82</cap:polygon>
    </item>
  </channel>
</rss>`;

  const result = parseBmkgWarnings(namespacedCapXml, TEST_REGION);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.alerts.length, 1);

  const alert = result.alerts[0];
  assert.strictEqual(alert.headline, 'Peringatan Badai Petir');
  assert.strictEqual(alert.event, 'Badai Petir Ekstrem');
  assert.strictEqual(alert.sender, 'BMKG Pusat');
  assert.strictEqual(alert.effectiveTime, '2025-10-15T10:00:00.000Z');
  assert.strictEqual(alert.expiresTime, '2025-10-15T16:00:00.000Z');
  // Point [-6.1763842693, 106.8267073562] is inside [-6.17,106.82] to [-6.19,106.84]
  assert.strictEqual(alert.applicability, 'GEOGRAPHIC_MATCH');
});

test('13. Missing and invalid warning expiration handling', () => {
  // Case A: Missing <expires> element
  const missingExpiryXml = `<rss version="2.0"><channel>
    <item>
      <headline>Hujan Deras</headline>
      <event>Hujan</event>
      <effective>2025-10-12T08:00:00Z</effective>
    </item>
  </channel></rss>`;
  const resultA = parseBmkgWarnings(missingExpiryXml, TEST_REGION);
  assert.strictEqual(resultA.alerts[0].validityStatus, 'UNKNOWN_EXPIRY');
  assert.strictEqual(resultA.alerts[0].expiresTime, null);

  // Case B: Malformed string in <expires>
  const invalidExpiryXml = `<rss version="2.0"><channel>
    <item>
      <headline>Hujan Deras</headline>
      <event>Hujan</event>
      <expires>not-a-valid-timestamp</expires>
    </item>
  </channel></rss>`;
  const resultB = parseBmkgWarnings(invalidExpiryXml, TEST_REGION);
  assert.strictEqual(resultB.alerts[0].validityStatus, 'UNKNOWN_EXPIRY');
  assert.strictEqual(resultB.alerts[0].expiresTime, null);
});

test('14. Multiple warning polygon containment handling', () => {
  // Two distinct polygons:
  // Poly 1: covers Gambir region (lat -6.170 to -6.185, lon 106.820 to 106.835)
  // Poly 2: covers Kemayoran region (lat -6.150 to -6.170, lon 106.845 to 106.860)
  const multiPolyXml = `<rss version="2.0"><channel>
    <item>
      <headline>Peringatan Cuaca Multi-Wilayah</headline>
      <event>Hujan Lebat</event>
      <polygon>-6.170,106.820 -6.170,106.835 -6.185,106.835 -6.185,106.820 -6.170,106.820</polygon>
      <polygon>-6.150,106.845 -6.150,106.860 -6.170,106.860 -6.170,106.845 -6.150,106.845</polygon>
    </item>
  </channel></rss>`;

  // 1. Tested against Gambir (inside Polygon 1)
  const resultGambir = parseBmkgWarnings(multiPolyXml, TEST_REGION);
  assert.strictEqual(resultGambir.alerts.length, 1);
  assert.strictEqual(resultGambir.alerts[0].applicability, 'GEOGRAPHIC_MATCH');
  assert.strictEqual(resultGambir.alerts[0].allPolygons?.length, 2);

  // 2. Tested against Kemayoran (inside Polygon 2)
  const KEMAYORAN_REGION: BmkgRegionRecord = {
    adm4: '31.71.03.1001',
    desa: 'Kemayoran',
    kecamatan: 'Kemayoran',
    kotkab: 'Kota Adm. Jakarta Pusat',
    provinsi: 'DKI Jakarta',
    timezone: 'Asia/Jakarta',
    coordinates: { lat: -6.1601, lon: 106.8524 },
    isVerified: false,
  };
  const resultKemayoran = parseBmkgWarnings(multiPolyXml, KEMAYORAN_REGION);
  assert.strictEqual(resultKemayoran.alerts.length, 1);
  assert.strictEqual(resultKemayoran.alerts[0].applicability, 'GEOGRAPHIC_MATCH');

  // 3. Tested against an outside coordinate
  const OUTSIDE_REGION: BmkgRegionRecord = {
    adm4: '99.99.99.9999',
    desa: 'Luar Wilayah',
    kecamatan: 'Luar',
    kotkab: 'Luar',
    provinsi: 'DKI Jakarta',
    timezone: 'Asia/Jakarta',
    coordinates: { lat: -6.400, lon: 107.000 },
    isVerified: false,
  };
  const resultOutside = parseBmkgWarnings(multiPolyXml, OUTSIDE_REGION);
  assert.strictEqual(resultOutside.alerts[0].applicability, 'REGIONAL_UNVERIFIED');
});

test('15. Region switching and warning cache isolation', async () => {
  clearBmkgCache();
  const now = 1729000000000;

  // XML with polygon covering Gambir ONLY
  const gambirOnlyXml = `<rss version="2.0"><channel>
    <item>
      <headline>Hujan Gambir Saja</headline>
      <event>Hujan</event>
      <polygon>-6.170,106.820 -6.170,106.835 -6.185,106.835 -6.185,106.820 -6.170,106.820</polygon>
    </item>
  </channel></rss>`;

  const KEMAYORAN_REGION: BmkgRegionRecord = {
    adm4: '31.71.03.1001',
    desa: 'Kemayoran',
    kecamatan: 'Kemayoran',
    kotkab: 'Kota Adm. Jakarta Pusat',
    provinsi: 'DKI Jakarta',
    timezone: 'Asia/Jakarta',
    coordinates: { lat: -6.1601, lon: 106.8524 },
    isVerified: false,
  };

  // 1. First fetch for Gambir -> GEOGRAPHIC_MATCH
  const alertsGambir = await getBmkgWarnings(TEST_REGION, {
    mockXml: gambirOnlyXml,
    now,
  });
  assert.strictEqual(alertsGambir.length, 1);
  assert.strictEqual(alertsGambir[0].applicability, 'GEOGRAPHIC_MATCH');

  // 2. Fetch for Kemayoran within 5 minutes (served from cached raw feed, but evaluated specifically for Kemayoran)
  const alertsKemayoran = await getBmkgWarnings(KEMAYORAN_REGION, {
    now: now + 5 * 60 * 1000,
  });
  assert.strictEqual(alertsKemayoran.length, 1);
  // Must NOT leak Gambir's GEOGRAPHIC_MATCH!
  assert.strictEqual(alertsKemayoran[0].applicability, 'REGIONAL_UNVERIFIED');
});

test('16. Safe forecast ordering and duplicate interval deduplication', () => {
  const disorderedPayload = {
    lokasi: { adm4: '31.71.01.1001', desa: 'Gambir' },
    data: [
      {
        cuaca: [
          [
            // Later interval placed first
            {
              utc_datetime: '2025-10-12 11:00:00',
              local_datetime: '2025-10-12 18:00:00',
              datetime: '2025-10-12T11:00:00Z',
              t: 30, hu: 70, ws: 5,
            },
            // Earlier interval placed second
            {
              utc_datetime: '2025-10-12 08:00:00',
              local_datetime: '2025-10-12 15:00:00',
              datetime: '2025-10-12T08:00:00Z',
              t: 32, hu: 60, ws: 10,
            },
            // Duplicate interval with identical timestamp
            {
              utc_datetime: '2025-10-12 08:00:00',
              local_datetime: '2025-10-12 15:00:00',
              datetime: '2025-10-12T08:00:00Z',
              t: 32, hu: 60, ws: 10,
            },
          ],
        ],
      },
    ],
  };

  const result = parseBmkgForecast(disorderedPayload, Date.parse('2025-10-12T08:00:00Z'));
  assert.strictEqual(result.success, true);
  assert.ok(result.data);

  const forecast = result.data!;
  // Deduplication verified: 3 raw items -> 2 unique intervals
  assert.strictEqual(forecast.allSteps.length, 2);

  // Chronological sorting verified: 08:00 UTC must precede 11:00 UTC
  assert.strictEqual(forecast.allSteps[0].utcDatetime, '2025-10-12 08:00:00');
  assert.strictEqual(forecast.allSteps[1].utcDatetime, '2025-10-12 11:00:00');
  assert.strictEqual(forecast.allSteps[0].temperatureC, 32);
  assert.strictEqual(forecast.allSteps[1].temperatureC, 30);
});

test('17. Dynamic current forecast step selection', () => {
  const threeIntervalPayload = {
    lokasi: { adm4: '31.71.01.1001', desa: 'Gambir' },
    data: [
      {
        cuaca: [
          [
            { utc_datetime: '2025-10-12 08:00:00', local_datetime: '2025-10-12 15:00:00', t: 32, hu: 60, ws: 10 },
            { utc_datetime: '2025-10-12 11:00:00', local_datetime: '2025-10-12 18:00:00', t: 30, hu: 70, ws: 8 },
            { utc_datetime: '2025-10-12 14:00:00', local_datetime: '2025-10-12 21:00:00', t: 27, hu: 80, ws: 5 },
          ],
        ],
      },
    ],
  };

  // Clock is at 11:10 UTC (closest to Step 1: 11:00 UTC)
  const clientClockMs = Date.parse('2025-10-12T11:10:00Z');
  const result = parseBmkgForecast(threeIntervalPayload, clientClockMs);
  assert.strictEqual(result.success, true);
  assert.ok(result.data);

  // currentStep must dynamically select the 11:00 step, NOT index 0 (08:00 step)
  assert.strictEqual(result.data!.currentStep.utcDatetime, '2025-10-12 11:00:00');
  assert.strictEqual(result.data!.currentStep.temperatureC, 30);
});

test('18. Older asynchronous response does not overwrite active region', async () => {
  clearBmkgCache();
  const now = 1729000000000;

  const KEMAYORAN_REGION: BmkgRegionRecord = {
    adm4: '31.71.03.1001',
    desa: 'Kemayoran',
    kecamatan: 'Kemayoran',
    kotkab: 'Kota Adm. Jakarta Pusat',
    provinsi: 'DKI Jakarta',
    timezone: 'Asia/Jakarta',
    coordinates: { lat: -6.1601, lon: 106.8524 },
    isVerified: false,
  };

  // Start query for Gambir
  const promiseGambir = getBmkgRegionalData(TEST_REGION, {
    mockFixtureForecast: OFFICIAL_FIXTURE_SAMPLE,
    now,
  });

  // Immediately switch region to Kemayoran
  const promiseKemayoran = getBmkgRegionalData(KEMAYORAN_REGION, {
    mockFixtureForecast: {
      lokasi: { adm4: '31.71.03.1001', desa: 'Kemayoran' },
      data: [{ cuaca: [[{ utc_datetime: '2025-10-12 08:00:00', local_datetime: '2025-10-12 15:00:00', t: 29, hu: 65, ws: 7 }]] }],
    },
    now: now + 100,
  });

  const [stateGambir, stateKemayoran] = await Promise.all([promiseGambir, promiseKemayoran]);

  // Newer region (Kemayoran) should be active
  assert.strictEqual(stateKemayoran.status, 'SUCCESS_FRESH');
  assert.strictEqual(stateKemayoran.selectedRegion.adm4, '31.71.03.1001');

  // Older region (Gambir) was superseded and must not overwrite
  assert.strictEqual(stateGambir.status, 'LOADING');
});

test('19. Accurate timezone label resolution without indiscriminate WIB labeling', () => {
  assert.strictEqual(getTimezoneLabel('Asia/Jakarta'), 'WIB');
  assert.strictEqual(getTimezoneLabel('Asia/Pontianak'), 'WIB');
  assert.strictEqual(getTimezoneLabel('Asia/Makassar'), 'WITA');
  assert.strictEqual(getTimezoneLabel('Asia/Denpasar'), 'WITA');
  assert.strictEqual(getTimezoneLabel('Asia/Jayapura'), 'WIT');
  assert.strictEqual(getTimezoneLabel('+0700'), 'WIB');
  assert.strictEqual(getTimezoneLabel('+0800'), 'WITA');
  assert.strictEqual(getTimezoneLabel('+0900'), 'WIT');
  assert.strictEqual(getTimezoneLabel(null), 'Waktu Lokal');
  assert.strictEqual(getTimezoneLabel(undefined), 'Waktu Lokal');
  assert.strictEqual(getTimezoneLabel('UTC'), 'UTC');
});

