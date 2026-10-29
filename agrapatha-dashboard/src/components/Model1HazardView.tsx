import React from 'react';
import { Flame, Cpu } from 'lucide-react';
import { SemiCircularGauge } from './ui/SemiCircularGauge';
import { FloraKaggleSection } from './FloraKaggleSection';
import { type ModelHazardResult } from '../lib/aiModels';

interface Model1HazardViewProps {
  hazardResult: ModelHazardResult | null;
  temp: number | null;
  rh: number | null;
  wind: number | null;
  rain: number | null;
  ffmc: number | null;
  dmc: number | null;
  dc: number | null;
  isi: number | null;
  isLiveTelemetry: boolean;
  isTelemetryStale: boolean;
}

export const Model1HazardView: React.FC<Model1HazardViewProps> = ({
  hazardResult,
  temp,
  rh,
  wind,
  rain,
  ffmc,
  dmc,
  dc,
  isi,
  isLiveTelemetry,
  isTelemetryStale,
}) => {
  const isLiveValid = isLiveTelemetry && !isTelemetryStale && hazardResult !== null;

  return (
    <div className="space-y-6">
      {/* 1. MODEL SPECIFICATION & HEADER */}
      <section id="analysis" className="agra-card p-5 sm:p-6 shadow-xs border-l-4 border-l-[#4E8577] scroll-mt-6 sm:scroll-mt-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-[#4E8577] uppercase tracking-widest flex items-center gap-1.5 font-mono">
                <Flame size={13} className="text-[#DC2626]" />
                <span>Primary Named Reference: model_hazard.h</span>
              </span>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#E5EBE8] text-[#4E8577] border border-[#DCE4E1]">
                m2cgen Static C Code
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#2C2922] font-display mt-1">
              Model 1 — Forest Fire Hazard Classification
            </h2>
            <p className="text-xs text-[#4D6A75] mt-1 max-w-3xl leading-relaxed">
              Model klasifikasi bahaya kebakaran hutan berbasis 100 pohon keputusan yang dilatih pada dataset Montesinho Park (<code className="font-mono text-[#4E8577]">forestfires.csv</code>). Mengevaluasi 6 fitur input secara independen di edge device.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5 shrink-0">
            {/* Latency Indicator */}
            <div className="px-3 py-1.5 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1] flex items-center gap-2 shadow-2xs">
              <Cpu size={14} className="text-[#4E8577]" />
              <div className="text-left">
                <span className="text-[9px] font-bold text-[#4D6A75] uppercase block leading-none">
                  C-Header Latency
                </span>
                <span className="text-xs font-bold font-tabular text-[#2C2922]">
                  &lt; 1.2 ms (Static C)
                </span>
              </div>
            </div>

            {/* Risk Badge */}
            {isLiveValid ? (
              <span
                className={`text-xs font-bold px-3 py-1.5 rounded-xl border flex items-center gap-1.5 ${
                  hazardResult.riskLevel === 'HIGH'
                    ? 'agra-badge-high'
                    : hazardResult.riskLevel === 'MODERATE'
                    ? 'agra-badge-moderate'
                    : 'agra-badge-safe'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    hazardResult.riskLevel === 'HIGH'
                      ? 'bg-[#DC2626] animate-pulse'
                      : hazardResult.riskLevel === 'MODERATE'
                      ? 'bg-[#D97706]'
                      : 'bg-[#56612E]'
                  }`}
                />
                <span>{hazardResult.riskLevel} RISK ({hazardResult.confidence.toFixed(1)}%)</span>
              </span>
            ) : (
              <span className="text-xs font-bold px-3 py-1.5 rounded-xl border flex items-center gap-1.5 bg-[#F8FAF9] text-[#4D6A75] border-[#DCE4E1]">
                <span className="w-2 h-2 rounded-full bg-[#94A3B8]" />
                <span>{isTelemetryStale ? 'TELEMETRI STALE · INFERENSI STANDBY' : !isLiveValid ? 'HARDWARE OFFLINE · INFERENSI STANDBY' : 'DATA METEOROLOGIS BELUM LENGKAP · STANDBY'}</span>
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 2. DUAL-PANEL: GAUGE & CLASS PROBABILITIES (LEFT) + 6 INPUT FEATURES (RIGHT) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Column: Gauge & Class Probabilities (5 cols) */}
        <section className="lg:col-span-5 agra-card p-5 sm:p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold text-[#2C2922] font-display uppercase tracking-wider">
                Risk Gauge &amp; Probabilities
              </span>
              <span className="text-[10px] text-[#4D6A75] font-mono">
                P(High) + P(Low) + P(Mod)
              </span>
            </div>

            {/* Semi-Circular SVG Gauge */}
            <div className="flex justify-center my-2">
              <SemiCircularGauge
                value={isLiveValid ? hazardResult.highProbability : 0}
                title="Forest Fire Hazard Index"
                level={isLiveValid ? hazardResult.riskLevel : 'SAFE'}
                unit="%"
                subLabel={isLiveValid ? `Probabilitas High Risk: ${hazardResult.highProbability.toFixed(1)}%` : isTelemetryStale ? 'Data Telemetri Stale' : 'Standby / Menunggu Telemetri'}
                size="md"
              />
            </div>

            {/* 3-Class Probabilities Grid */}
            <div className="grid grid-cols-3 gap-2 my-4">
              <div className="p-2.5 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1] text-center">
                <span className="text-[10px] font-bold text-[#961C1C] uppercase block">
                  High [0]
                </span>
                <span className="text-base font-bold font-tabular text-[#961C1C] block mt-0.5">
                  {isLiveValid ? `${hazardResult.highProbability.toFixed(1)}%` : '--'}
                </span>
                <div className="w-full h-1 bg-[#E5EBE8] rounded-full overflow-hidden mt-1.5">
                  <div
                    style={{ width: `${isLiveValid ? hazardResult.highProbability : 0}%` }}
                    className="h-full bg-[#DC2626]"
                  />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1] text-center">
                <span className="text-[10px] font-bold text-[#8A570C] uppercase block">
                  Moderate [2]
                </span>
                <span className="text-base font-bold font-tabular text-[#8A570C] block mt-0.5">
                  {isLiveValid ? `${hazardResult.moderateProbability.toFixed(1)}%` : '--'}
                </span>
                <div className="w-full h-1 bg-[#E5EBE8] rounded-full overflow-hidden mt-1.5">
                  <div
                    style={{ width: `${isLiveValid ? hazardResult.moderateProbability : 0}%` }}
                    className="h-full bg-[#D97706]"
                  />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1] text-center">
                <span className="text-[10px] font-bold text-[#56612E] uppercase block">
                  Low [1]
                </span>
                <span className="text-base font-bold font-tabular text-[#56612E] block mt-0.5">
                  {isLiveValid ? `${hazardResult.lowProbability.toFixed(1)}%` : '--'}
                </span>
                <div className="w-full h-1 bg-[#E5EBE8] rounded-full overflow-hidden mt-1.5">
                  <div
                    style={{ width: `${isLiveValid ? hazardResult.lowProbability : 0}%` }}
                    className="h-full bg-[#56612E]"
                  />
                </div>
              </div>
            </div>

            {/* Decision Tree Split Rationale */}
            <div className="bg-[#F8FAF9] border border-[#DCE4E1] rounded-xl p-3 text-xs space-y-1">
              <span className="font-bold text-[#2C2922] block font-display">
                Decision Tree Split Rationale:
              </span>
              <p className="text-[11px] text-[#4D6A75] m-0 leading-relaxed">
                {isLiveValid && typeof ffmc === 'number'
                  ? ffmc >= 89.5
                    ? `Nilai FFMC (${ffmc.toFixed(1)} ≥ 89.5) melewati ambang kritis penyalaan serasah kering pada cabang utama pohon keputusan.`
                    : ffmc >= 82.0
                    ? `Nilai FFMC (${ffmc.toFixed(1)}) berada di rentang pengeringan moderat.`
                    : `Nilai FFMC (${ffmc.toFixed(1)} < 82.0) menandakan kadar air serasah tinggi yang menghambat penyalaan api.`
                  : 'Menunggu stream data telemetri FWI live untuk mengevaluasi split pohon keputusan.'}
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#DCE4E1] flex items-center justify-between text-[11px] text-[#4D6A75]">
            <span>Montesinho Ground Truth Label:</span>
            <span className="font-bold font-mono text-[#2C2922]">
              {isLiveValid ? (hazardResult.kaggleBinaryPrediction === 'On Fire' ? '1: On Fire' : '0: Safe') : '--'}
            </span>
          </div>
        </section>

        {/* Right Column: 6 Reference Input Features (7 cols) */}
        <section className="lg:col-span-7 agra-card p-5 sm:p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex justify-between items-center mb-3">
              <div>
                <span className="text-xs font-bold text-[#2C2922] font-display uppercase tracking-wider block">
                  6 Reference Input Features
                </span>
                <span className="text-[10px] text-[#4D6A75]">
                  Sinyal telemetri input langsung ke fungsi C <code className="font-mono text-[#4E8577]">score(input, output)</code>
                </span>
              </div>
              <span className="text-[10px] font-semibold text-[#4E8577] bg-[#F1F5F3] px-2.5 py-1 rounded-full border border-[#DCE4E1]">
                {isLiveTelemetry ? (isTelemetryStale ? 'Telemetri Stale · Offline' : 'Telemetri Live SSE') : 'Device Offline'}
              </span>
            </div>

            {/* 6 Features Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {/* Feature 1: Temperature */}
              <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1]">
                <span className="text-[10px] font-bold text-[#4D6A75] uppercase block truncate">
                  1. Air Temp (DHT22)
                </span>
                <span className="text-xl font-bold font-tabular text-[#2C2922] block mt-1">
                  {typeof temp === 'number' && isLiveValid ? `${temp.toFixed(1)}°C` : 'Unavailable'}
                </span>
                <span className="text-[10px] text-[#7E694F] block font-mono mt-0.5">
                  Mean Dataset: 18.9°C
                </span>
              </div>

              {/* Feature 2: RH */}
              <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1]">
                <span className="text-[10px] font-bold text-[#4D6A75] uppercase block truncate">
                  2. Relative Humidity
                </span>
                <span className="text-xl font-bold font-tabular text-[#2C2922] block mt-1">
                  {typeof rh === 'number' && isLiveValid ? `${rh.toFixed(0)}%` : 'Unavailable'}
                </span>
                <span className="text-[10px] text-[#7E694F] block font-mono mt-0.5">
                  Mean Dataset: 44.3%
                </span>
              </div>

              {/* Feature 3: Wind */}
              <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1]">
                <span className="text-[10px] font-bold text-[#4D6A75] uppercase block truncate">
                  3. Wind Speed
                </span>
                <span className="text-xl font-bold font-tabular text-[#2C2922] block mt-1">
                  {typeof wind === 'number' && isLiveValid ? `${wind.toFixed(1)} km/h` : 'Unavailable'}
                </span>
                <span className="text-[10px] text-[#7E694F] block font-mono mt-0.5">
                  Mean Dataset: 4.0 km/h
                </span>
              </div>

              {/* Feature 4: Rain */}
              <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1]">
                <span className="text-[10px] font-bold text-[#4D6A75] uppercase block truncate">
                  4. Rain (Model 1 Input)
                </span>
                <span className="text-xl font-bold font-tabular text-[#2C2922] block mt-1">
                  {typeof rain === 'number' && isLiveValid ? `${rain.toFixed(1)} mm` : 'Unavailable'}
                </span>
                <span className="text-[10px] text-[#7E694F] block font-mono mt-0.5">
                  {typeof rain === 'number' && isLiveValid ? 'Pengamatan Meteorologis' : 'Data Meteorologis Belum Tersedia'}
                </span>
              </div>

              {/* Feature 5: FFMC */}
              <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1]">
                <span className="text-[10px] font-bold text-[#4D6A75] uppercase block truncate">
                  5. FFMC (Fuel Code)
                </span>
                <span className="text-xl font-bold font-tabular text-[#2C2922] block mt-1">
                  {typeof ffmc === 'number' && isLiveValid ? ffmc.toFixed(1) : 'Unavailable'}
                </span>
                <span className="text-[10px] text-[#7E694F] block font-mono mt-0.5">
                  Ambang Kritis: 89.5
                </span>
              </div>

              {/* Feature 6: DMC */}
              <div className="p-3 rounded-xl bg-[#F8FAF9] border border-[#DCE4E1]">
                <span className="text-[10px] font-bold text-[#4D6A75] uppercase block truncate">
                  6. DMC (Duff Layer)
                </span>
                <span className="text-xl font-bold font-tabular text-[#2C2922] block mt-1">
                  {typeof dmc === 'number' && isLiveValid ? dmc.toFixed(1) : 'Unavailable'}
                </span>
                <span className="text-[10px] text-[#7E694F] block font-mono mt-0.5">
                  Duff Moisture Code
                </span>
              </div>
            </div>

            {/* Derived FWI Metrics Strip */}
            <div className="mt-4 pt-3 border-t border-[#DCE4E1] grid grid-cols-2 gap-3">
              <div className="p-2.5 rounded-lg bg-[#F1F5F3] border border-[#DCE4E1] flex justify-between items-center text-xs">
                <span className="text-[#4D6A75] font-semibold">ISI (Initial Spread Index):</span>
                <span className="font-bold font-tabular text-[#2C2922]">{typeof isi === 'number' && isLiveValid ? isi.toFixed(1) : 'Unavailable'}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[#F1F5F3] border border-[#DCE4E1] flex justify-between items-center text-xs">
                <span className="text-[#4D6A75] font-semibold">DC (Drought Code):</span>
                <span className="font-bold font-tabular text-[#2C2922]">{typeof dc === 'number' && isLiveValid ? dc.toFixed(1) : 'Unavailable'}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#DCE4E1] text-[11px] text-[#4D6A75] flex items-center justify-between">
            <span>Model Input Vector: [{isLiveValid && typeof temp === 'number' && typeof rh === 'number' && typeof wind === 'number' && typeof rain === 'number' && typeof ffmc === 'number' && typeof dmc === 'number' ? `${temp.toFixed(1)}, ${rh.toFixed(0)}, ${wind.toFixed(1)}, ${rain.toFixed(1)}, ${ffmc.toFixed(1)}, ${dmc.toFixed(1)}` : '--'}]</span>
            <span className="font-mono text-[#56612E]">
              {isLiveValid ? 'Telemetri Real Live' : isTelemetryStale ? 'Telemetri Stale' : 'Menunggu Sambungan'}
            </span>
          </div>
        </section>
      </div>

      {/* 3. VERIFIABLE KAGGLE DATASET BENCHMARKS */}
      <FloraKaggleSection />
    </div>
  );
};
