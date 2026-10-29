import React from 'react';
import { Leaf, Sprout, Droplets, Thermometer, Activity } from 'lucide-react';
import { SemiCircularGauge } from './ui/SemiCircularGauge';
import { FloraHistoryCanvas, type TelemetryHistoryPoint } from './FloraHistoryCanvas';
import type { FloraSensorModelResult } from '../lib/aiModels';

interface Model2BotanicalViewProps {
  floraResult: FloraSensorModelResult | null;
  temp: number | null;
  rh: number | null;
  soilMoisture: number | null;
  history: TelemetryHistoryPoint[];
  wateringHistory?: Array<{ id: number; timestamp: string; soilBefore: number; note: string }>;
  isLiveTelemetry: boolean;
  isTelemetryStale: boolean;
}

export const Model2BotanicalView: React.FC<Model2BotanicalViewProps> = ({
  floraResult,
  temp,
  rh,
  soilMoisture,
  history,
  wateringHistory = [],
  isLiveTelemetry,
  isTelemetryStale,
}) => {
  const isLiveValid = isLiveTelemetry && !isTelemetryStale && floraResult !== null && typeof soilMoisture === 'number';

  // Approximate Vapor Pressure Deficit (VPD in kPa)
  // SVP = 0.61078 * exp((17.27 * T) / (T + 237.3))
  // AVP = SVP * (RH / 100)
  // VPD = SVP - AVP
  const svp = typeof temp === 'number' ? 0.61078 * Math.exp((17.27 * temp) / (temp + 237.3)) : 0;
  const avp = typeof rh === 'number' && svp > 0 ? svp * (rh / 100) : 0;
  const vpd = Math.max(0, svp - avp);

  const hydrationLevel = isLiveValid && typeof soilMoisture === 'number'
    ? (soilMoisture >= 35 ? 'OPTIMAL' : soilMoisture >= 25 ? 'MODERAT' : 'DEFISIT')
    : '--';

  return (
    <div className="space-y-6">
      {/* 1. MODEL SPECIFICATION & HEADER */}
      <section className="agra-card p-5 sm:p-6 shadow-xs border-l-4 border-l-[#56612E]">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-[#56612E] uppercase tracking-widest flex items-center gap-1.5 font-mono">
                <Leaf size={13} className="text-[#56612E]" />
                <span>Primary Named Reference: grenvis_sensor_model.h</span>
              </span>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#E5EBE8] text-[#2C2922] border border-[#DCE4E1]">
                ANN · Multi-Layer Perceptron
              </span>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#E5EBE8] text-[#56612E] border border-[#DCE4E1]">
                Botanical &amp; Soil Hydrology
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#2C2922] font-display mt-1">
              Model 2 — Botanical &amp; Environmental Risk Evaluation
            </h2>
            <p className="text-xs text-[#4D6A75] mt-1 max-w-3xl leading-relaxed">
              Model inferensi botani berbasis Artificial Neural Network (<code className="font-mono text-[#4E8577]">grenvis_sensor_model.h</code>) yang mengintegrasikan mikroklimat kanopi DHT22 dan kelembapan perakaran tanah untuk mendeteksi stres fisiologis vegetasi.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {isLiveValid && floraResult ? (
              <span className="text-xs font-bold px-3 py-1.5 rounded-xl border flex items-center gap-1.5 agra-badge-safe">
                <span className="w-2 h-2 rounded-full bg-[#56612E]" />
                <span>{floraResult.sensorRisk.toUpperCase()} RISK ({floraResult.sensorConfidence.toFixed(1)}%)</span>
              </span>
            ) : (
              <span className="text-xs font-bold px-3 py-1.5 rounded-xl border flex items-center gap-1.5 bg-[#F8FAF9] text-[#4D6A75] border-[#DCE4E1]">
                <span className="w-2 h-2 rounded-full bg-[#94A3B8]" />
                <span>{isTelemetryStale ? 'TELEMETRI STALE · INFERENSI STANDBY' : 'HARDWARE OFFLINE · INFERENSI STANDBY'}</span>
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 2. DUAL-PANEL: PLANT-HEALTH GAUGE (LEFT) + BOTANICAL SENSORS (RIGHT) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Column: Plant-Health Gauge & Probabilities (5 cols) */}
        <section className="lg:col-span-5 agra-card p-5 sm:p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold text-[#2C2922] font-display uppercase tracking-wider">
                Plant-Health Index &amp; Hydration
              </span>
              <span className="text-[10px] text-[#4D6A75] font-mono">
                Status: {isLiveValid ? hydrationLevel : 'OFFLINE'}
              </span>
            </div>

            {/* Semi-Circular SVG Gauge */}
            <div className="py-2 flex justify-center">
              <SemiCircularGauge
                value={isLiveValid && typeof soilMoisture === 'number' ? Math.min(100, Math.max(0, soilMoisture * 1.5)) : 0}
                title="Plant-Health &amp; Soil Hydration"
                level={isLiveValid && typeof soilMoisture === 'number' ? (soilMoisture >= 30 ? 'SAFE' : soilMoisture >= 20 ? 'MODERATE' : 'CRITICAL') : 'SAFE'}
                unit="%"
                subLabel={isLiveValid && typeof soilMoisture === 'number' ? `Hydration: ${hydrationLevel} · Soil Moisture ${soilMoisture.toFixed(1)}%` : isTelemetryStale ? 'Device Offline (Stale)' : 'Device Offline (No Telemetry)'}
                size="md"
              />
            </div>

            {/* ANN Risk Assessment & Hydration Breakdown */}
            <div className="mt-4 pt-3 border-t border-[#DCE4E1] space-y-2.5">
              <span className="text-[10px] font-bold text-[#4D6A75] uppercase tracking-wider block">
                ANN Botanical Evaluation
              </span>

              <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1] space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#4D6A75] font-semibold">Assessed Botanical Risk:</span>
                  <span className="font-bold text-[#56612E]">{isLiveValid && floraResult ? floraResult.sensorRisk.toUpperCase() : '--'}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#4D6A75] font-semibold">Model Confidence:</span>
                  <span className="font-bold font-tabular text-[#2C2922]">{isLiveValid && floraResult ? `${floraResult.sensorConfidence.toFixed(1)}%` : '--'}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#4D6A75] font-semibold">Soil Moisture v1.2:</span>
                  <span className="font-bold font-tabular text-[#2C2922]">{isLiveValid && typeof soilMoisture === 'number' ? `${soilMoisture.toFixed(1)}%` : 'Unavailable'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#DCE4E1] bg-[#F8FAF9] p-3 rounded-xl border">
            <span className="text-[10px] font-bold text-[#56612E] uppercase tracking-wider block mb-1">
              Agronomic Assessment
            </span>
            <p className="text-[11px] text-[#4D6A75] leading-relaxed m-0">
              {isLiveValid && typeof soilMoisture === 'number'
                ? soilMoisture >= 35
                  ? 'Kadar air tanah berada pada kapasitas lapang optimal, perakaran terhidrasi sempurna.'
                  : soilMoisture >= 25
                  ? 'Kadar air tanah mulai menurun, disarankan pemantauan jadwal irigasi preventif.'
                  : 'Defisit air perakaran kritis, kelembapan serasah di bawah ambang aman.'
                : 'Menunggu pembacaan sensor tanah kapasitif v1.2 untuk evaluasi hidrologi rizosfer.'}
            </p>
          </div>
        </section>

        {/* Right Column: Botanical Environmental Sensors (7 cols) */}
        <section className="lg:col-span-7 agra-card p-5 sm:p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex justify-between items-center mb-3">
              <div>
                <span className="text-[10px] font-bold text-[#56612E] uppercase tracking-wider block">
                  Sensor Signals Supporting grenvis_sensor_model.h
                </span>
                <h3 className="text-sm font-bold text-[#2C2922] font-display">
                  Environmental Sensor Telemetry
                </h3>
              </div>
              <span className="text-[10px] font-semibold text-[#56612E] bg-[#F1F5F3] px-2.5 py-1 rounded-full border border-[#DCE4E1]">
                {isLiveValid ? 'Physical Sensors Active' : 'Sensors Offline'}
              </span>
            </div>

            {/* 4 Sensor Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Card 1: Soil Moisture */}
              <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1] flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-[#56612E] uppercase flex items-center gap-1 font-mono">
                      <Sprout size={13} className="text-[#56612E]" />
                      <span>Capacitive Soil v1.2</span>
                    </span>
                    <span className="text-[9px] font-mono text-[#7E694F]">GPIO 34 · ADC1</span>
                  </div>
                  <span className="text-2xl font-bold font-tabular text-[#2C2922] block mt-1">
                    {isLiveValid && typeof soilMoisture === 'number' ? `${soilMoisture.toFixed(1)}%` : '0.0%'}
                  </span>
                  <p className="text-[11px] text-[#4D6A75] mt-1 leading-snug">
                    Kelembapan tanah perakaran. Mengontrol evapotranspirasi serasah dasar kanopi.
                  </p>
                </div>
                <div className="w-full h-1.5 bg-[#E5EBE8] rounded-full overflow-hidden mt-2.5">
                  <div
                    style={{ width: `${isLiveValid && typeof soilMoisture === 'number' ? Math.min(100, Math.max(0, soilMoisture)) : 0}%` }}
                    className={`h-full ${typeof soilMoisture === 'number' && soilMoisture < 25 ? 'bg-[#DC2626]' : typeof soilMoisture === 'number' && soilMoisture < 35 ? 'bg-[#D97706]' : 'bg-[#56612E]'}`}
                  />
                </div>
              </div>

              {/* Card 2: Air Temp */}
              <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1] flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-[#4E8577] uppercase flex items-center gap-1 font-mono">
                      <Thermometer size={13} className="text-[#DC2626]" />
                      <span>Suhu Ambien (DHT22)</span>
                    </span>
                    <span className="text-[9px] font-mono text-[#7E694F]">GPIO 19</span>
                  </div>
                  <span className="text-2xl font-bold font-tabular text-[#2C2922] block mt-1">
                    {isLiveValid && typeof temp === 'number' ? `${temp.toFixed(1)}°C` : 'Unavailable'}
                  </span>
                  <p className="text-[11px] text-[#4D6A75] mt-1 leading-snug">
                    Suhu mikroklimat tajuk tanaman. Mempengaruhi laju transpirasi stomata.
                  </p>
                </div>
                <div className="w-full h-1.5 bg-[#E5EBE8] rounded-full overflow-hidden mt-2.5">
                  <div
                    style={{ width: `${isLiveValid && typeof temp === 'number' ? Math.min(100, Math.max(0, (temp / 45) * 100)) : 0}%` }}
                    className="h-full bg-[#4E8577]"
                  />
                </div>
              </div>

              {/* Card 3: Relative Humidity */}
              <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1] flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-[#4D6A75] uppercase flex items-center gap-1 font-mono">
                      <Droplets size={13} className="text-[#4E8577]" />
                      <span>Kelembapan Udara (RH)</span>
                    </span>
                    <span className="text-[9px] font-mono text-[#7E694F]">GPIO 19</span>
                  </div>
                  <span className="text-2xl font-bold font-tabular text-[#2C2922] block mt-1">
                    {isLiveValid && typeof rh === 'number' ? `${rh.toFixed(1)}%` : 'Unavailable'}
                  </span>
                  <p className="text-[11px] text-[#4D6A75] mt-1 leading-snug">
                    Kelembapan relatif kanopi. Nilai rendah (&lt;40%) memicu stres penguapan cepat.
                  </p>
                </div>
                <div className="w-full h-1.5 bg-[#E5EBE8] rounded-full overflow-hidden mt-2.5">
                  <div
                    style={{ width: `${isLiveValid && typeof rh === 'number' ? Math.min(100, Math.max(0, rh)) : 0}%` }}
                    className="h-full bg-[#4D6A75]"
                  />
                </div>
              </div>

              {/* Card 4: Vapor Pressure Deficit */}
              <div className="p-3.5 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1] flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-[#7E694F] uppercase flex items-center gap-1 font-mono">
                      <Activity size={13} className="text-[#7E694F]" />
                      <span>Vapor Pressure Deficit</span>
                    </span>
                    <span className="text-[9px] font-mono text-[#7E694F]">VPD (kPa)</span>
                  </div>
                  <span className="text-2xl font-bold font-tabular text-[#2C2922] block mt-1">
                    {isLiveValid ? `${vpd.toFixed(2)} ` : '0.00 '}<span className="text-xs font-normal">kPa</span>
                  </span>
                  <p className="text-[11px] text-[#4D6A75] mt-1 leading-snug">
                    Tekanan defisit uap air atmosfer. Rentang agronomis ideal: 0.8 s.d 1.5 kPa.
                  </p>
                </div>
                <div className="w-full h-1.5 bg-[#E5EBE8] rounded-full overflow-hidden mt-2.5">
                  <div
                    style={{ width: `${isLiveValid ? Math.min(100, Math.max(0, (vpd / 3) * 100)) : 0}%` }}
                    className={`h-full ${vpd > 1.8 ? 'bg-[#DC2626]' : vpd > 1.2 ? 'bg-[#D97706]' : 'bg-[#56612E]'}`}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#DCE4E1] text-[11px] text-[#4D6A75] flex items-center justify-between">
            <span>Sinyal Input: {isLiveValid && typeof temp === 'number' && typeof rh === 'number' && typeof soilMoisture === 'number' ? `[DHT22 Suhu ${temp.toFixed(1)}°C, RH ${rh.toFixed(0)}%, Soil ${soilMoisture.toFixed(1)}%]` : '[Device Offline · Sensor 0.0]'}</span>
            <span className="font-mono text-[#56612E]">
              {isLiveValid ? 'Live Telemetri Gateway' : 'Device Offline'}
            </span>
          </div>
        </section>
      </div>

      {/* 3. 24-HOUR HISTORICAL TREND PRESENTATION */}
      <section className="agra-card p-5 sm:p-6 shadow-xs">
        <div className="flex justify-between items-center mb-3">
          <div>
            <span className="text-[10px] font-bold text-[#56612E] uppercase tracking-wider block">
              Time-Series Buffer · Real Session Telemetry
            </span>
            <h3 className="text-base font-bold text-[#2C2922] font-display">
              24-Hour Botanical &amp; Soil Hydrology Trend
            </h3>
          </div>
          <span className="text-xs text-[#4D6A75] font-tabular">
            {history.length} Titik Data Tersimpan
          </span>
        </div>

        {history.length < 2 ? (
          <div className="p-8 text-center bg-[#F8FAF9] rounded-xl border border-[#DCE4E1] text-xs text-[#4D6A75]">
            <p className="font-semibold text-[#2C2922]">Buffer histori telemetri sedang mengumpulkan data.</p>
            <p className="text-[11px] mt-1 text-[#4D6A75]">
              Titik data historis dicatat secara berkala dari stream gateway real time. Grafik akan diperbarui secara otomatis.
            </p>
          </div>
        ) : (
          <FloraHistoryCanvas history={history} />
        )}
      </section>

      {/* 4. MITIGATION & IRRIGATION DECISION SUPPORT */}
      <section id="treatment" className="agra-card p-5 sm:p-6 shadow-xs scroll-mt-6 sm:scroll-mt-8">
        <div className="flex justify-between items-start mb-3">
          <div>
            <span className="text-[10px] font-bold text-[#56612E] uppercase tracking-wider block">
              Agronomic Decision Support &amp; SOP
            </span>
            <h3 className="text-base font-bold text-[#2C2922] font-display">
              Rekomendasi Irigasi &amp; Pemulihan Vegetasi
            </h3>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full border agra-badge-safe">
            {wateringHistory.length > 0 ? `${wateringHistory.length} Catatan Siram` : 'SOP Aktif'}
          </span>
        </div>

        <div className="bg-[#F8FAF9] border border-[#DCE4E1] rounded-xl p-4 my-3 text-xs text-[#2C2922] space-y-2">
          <p className="font-semibold text-[#56612E] m-0">
            Pedoman Aksi Berdasarkan Status Sensor Saat Ini:
          </p>
          <ul className="pl-4 list-disc space-y-1.5 text-[#4D6A75] leading-relaxed">
            {!isLiveValid || typeof soilMoisture !== 'number' ? (
              <li>
                <strong>Status Telemetri Standby:</strong> Menunggu stream data telemetri gateway untuk mengevaluasi status irigasi dan defisit air rizosfer secara riil.
              </li>
            ) : soilMoisture < 30 ? (
              <li className="text-[#DC2626] font-semibold">
                <strong>Defisit Kelembapan Tanah ({soilMoisture.toFixed(1)}% &lt; 30%):</strong> Segera jadwalkan irigasi tetes atau siram manual zona akar untuk mencegah layu permanen.
              </li>
            ) : (
              <li className="text-[#56612E]">
                <strong>Hidrasi Tanah Normal ({soilMoisture.toFixed(1)}%):</strong> Pertahankan ritme kelembapan reguler.
              </li>
            )}
            {isLiveValid && (vpd > 1.6 ? (
              <li className="text-[#D97706]">
                <strong>VPD Tinggi ({vpd.toFixed(2)} kPa):</strong> Laju transpirasi tajuk tinggi, aktifkan naungan atau siram kanopi jika diperlukan.
              </li>
            ) : (
              <li>
                <strong>VPD Stabil ({vpd.toFixed(2)} kPa):</strong> Transpirasi stomata dalam kondisi seimbang.
              </li>
            ))}
            <li>
              Pantau integrasi sensor tanah kapasitif GPIO 34 (ADC1) dan konfirmasi konsistensi pembacaan.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
};
