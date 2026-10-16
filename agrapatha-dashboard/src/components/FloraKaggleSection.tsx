import React from 'react';
import {
  KAGGLE_FOREST_FIRE_STATS,
  KAGGLE_FLORA_DATASET_STATS,
  REAL_DATASET_PRESETS,
  type HazardInferenceResult,
} from '../lib/aiModels';

interface FloraKaggleSectionProps {
  temp: number;
  rh: number;
  wind: number;
  rain: number;
  ffmc: number;
  dmc: number;
  dc: number;
  isi: number;
  soilMoisture: number;
  activePresetId: string;
  hazardResult: HazardInferenceResult;
  floraResult: {
    sensorRisk: 'High' | 'Low' | 'Moderate';
    sensorConfidence: number;
    highProbability: number;
    lowProbability: number;
    moderateProbability: number;
  };
  onChangeParam: (field: 'temp' | 'rh' | 'wind' | 'rain' | 'ffmc' | 'dmc' | 'soilMoisture', value: number) => void;
  onSelectPreset: (presetId: string) => void;
}

export const FloraKaggleSection: React.FC<FloraKaggleSectionProps> = React.memo(({
  temp,
  rh,
  wind,
  rain,
  ffmc,
  dmc,
  dc,
  isi,
  soilMoisture,
  activePresetId,
  hazardResult,
  floraResult,
  onChangeParam,
  onSelectPreset,
}) => {
  const sliders = [
    {
      field: 'temp' as const,
      label: 'Temperature (temp)',
      code: 'input[0]',
      value: temp,
      min: 2.2,
      max: 33.3,
      step: 0.1,
      unit: '°C',
      mean: 18.89,
      std: 5.81,
      dataset: 'forestfires.csv (2.2 – 33.3°C)',
    },
    {
      field: 'rh' as const,
      label: 'Relative Humidity (RH)',
      code: 'input[1]',
      value: rh,
      min: 15.0,
      max: 100.0,
      step: 1,
      unit: '%',
      mean: 44.29,
      std: 16.32,
      dataset: 'forestfires.csv (15 – 100%)',
    },
    {
      field: 'wind' as const,
      label: 'Wind Speed (wind)',
      code: 'input[2]',
      value: wind,
      min: 0.4,
      max: 9.4,
      step: 0.1,
      unit: 'km/h',
      mean: 4.02,
      std: 1.79,
      dataset: 'forestfires.csv (0.4 – 9.4 km/h)',
    },
    {
      field: 'rain' as const,
      label: 'Outside Rain (rain)',
      code: 'input[3]',
      value: rain,
      min: 0.0,
      max: 6.4,
      step: 0.1,
      unit: 'mm/m²',
      mean: 0.02,
      std: 0.30,
      dataset: 'forestfires.csv (0.0 – 6.4 mm)',
    },
    {
      field: 'ffmc' as const,
      label: 'Fine Fuel Moisture (FFMC)',
      code: 'input[4]',
      value: ffmc,
      min: 18.7,
      max: 96.2,
      step: 0.1,
      unit: 'idx',
      mean: 90.64,
      std: 5.52,
      dataset: 'FWI Index (18.7 – 96.2)',
    },
    {
      field: 'dmc' as const,
      label: 'Duff Moisture Code (DMC)',
      code: 'input[5]',
      value: dmc,
      min: 1.1,
      max: 291.3,
      step: 0.5,
      unit: 'idx',
      mean: 110.87,
      std: 64.05,
      dataset: 'FWI Index (1.1 – 291.3)',
    },
    {
      field: 'soilMoisture' as const,
      label: 'Soil Moisture (Capacitive)',
      code: 'flora_in[2]',
      value: soilMoisture,
      min: 5.0,
      max: 95.0,
      step: 0.5,
      unit: '%',
      mean: 67.15,
      std: 17.56,
      dataset: 'flora-risk-dataset (Mean 67.15%)',
    },
  ];

  return (
    <section id="benchmarks" className="scroll-mt-6 sm:scroll-mt-8 space-y-6">
      {/* 1. Interactive C Header Model Simulator */}
      <div className="flora-card p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 mb-5 pb-4 border-b border-[#D6DCCE]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
                Interactive C Header Kernel Simulator · Real-Time Inference
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EFF3EF] text-[#263A35] border border-[#A6B49E]">
                100 Decision Trees Active
              </span>
            </div>
            <h2 className="text-lg font-bold text-[#263A35] font-display mt-0.5">
              Simulasi Parameter <code className="text-[#4E635E] font-mono text-base">model_hazard.h</code> &amp;{' '}
              <code className="text-[#4E635E] font-mono text-base">grenvis_sensor_model.h</code>
            </h2>
            <p className="text-xs text-[#50645F] mt-0.5">
              Geser nilai fitur di bawah ini atau pilih preset sampel asli dari{' '}
              <code className="font-mono text-[#263A35]">forestfires.csv</code> untuk mengeksekusi fungsi C{' '}
              <code className="font-mono text-[#4E635E]">void score(double *input, double *output)</code> secara langsung.
            </p>
          </div>

          <div role="group" aria-label="Preset Skenario Kebakaran Hutan" className="flex flex-wrap gap-2">
            {REAL_DATASET_PRESETS.map((preset) => {
              const isActive = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => onSelectPreset(preset.id)}
                  aria-pressed={isActive}
                  aria-label={`Pilih preset skenario ${preset.name}`}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E] ${
                    isActive
                      ? 'bg-[#4E635E] text-white border-[#4E635E] shadow-xs ring-2 ring-[#A6B49E]'
                      : 'bg-[#F5F4EE] text-[#263A35] border-[#E2E0CB] hover:bg-[#EFF3EF] hover:border-[#A6B49E]'
                  }`}
                >
                  {preset.shortName}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sliders + Live Output Vector Split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {sliders.map((s) => (
              <div key={s.field} className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors rounded-xl p-3.5 shadow-2xs flex flex-col justify-between min-h-[118px]">
                <div className="flex justify-between items-center mb-1 gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-[#263A35] block truncate">{s.label}</span>
                    <span className="text-[10px] font-mono text-[#50645F] block truncate">
                      {s.code} · {s.dataset}
                    </span>
                  </div>
                  <span className="text-sm font-bold font-tabular text-[#4E635E] bg-white px-2.5 py-1 rounded-lg border border-[#E2E0CB] shadow-2xs shrink-0 whitespace-nowrap">
                    {s.value.toFixed(1)} {s.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={s.value}
                  onChange={(e) => onChangeParam(s.field, parseFloat(e.target.value))}
                  aria-label={`Slider pengaturan nilai ${s.label} (${s.code})`}
                  aria-valuemin={s.min}
                  aria-valuemax={s.max}
                  aria-valuenow={s.value}
                  aria-valuetext={`${s.value.toFixed(1)} ${s.unit}`}
                  className="w-full accent-[#4E635E] cursor-pointer h-2 bg-[#E2E0CB] rounded-lg mt-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E]"
                />
                <div className="flex justify-between text-[10px] font-tabular text-[#50645F] mt-1">
                  <span>Min: {s.min}</span>
                  <span>
                    Mean: {s.mean} (±{s.std})
                  </span>
                  <span>Max: {s.max}</span>
                </div>
              </div>
            ))}

            {/* Derived FWI DC & ISI readouts */}
            <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors rounded-xl p-3.5 flex flex-col justify-between shadow-2xs min-h-[118px]">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-[#263A35]">Derived FWI Indices (DC &amp; ISI)</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white border border-[#E2E0CB] text-[#4E635E]">
                  Montesinho FWI
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 my-2">
                <div className="bg-white border border-[#E2E0CB] rounded-lg p-2">
                  <span className="text-[10px] text-[#50645F] block">Drought Code (DC)</span>
                  <span className="text-sm font-bold font-tabular text-[#263A35]">{dc.toFixed(1)}</span>
                  <span className="text-[9px] text-[#50645F] block">Range: 7.9 – 860.6</span>
                </div>
                <div className="bg-white border border-[#E2E0CB] rounded-lg p-2">
                  <span className="text-[10px] text-[#50645F] block">Initial Spread (ISI)</span>
                  <span className="text-sm font-bold font-tabular text-[#263A35]">{isi.toFixed(1)}</span>
                  <span className="text-[9px] text-[#50645F] block">Range: 0.0 – 56.1</span>
                </div>
              </div>
              <span className="text-[10px] text-[#50645F]">
                Mean dataset: DC = 547.94 (±248.07) · ISI = 9.02 (±4.56)
              </span>
            </div>
          </div>

          {/* C Header Output Terminal Box */}
          <div className="bg-[#23312E] text-white rounded-2xl p-5 border border-[#364844] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-[#364844] pb-3 mb-3.5">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#E2E0CB] block">
                    Live C Model Execution
                  </span>
                  <h3 className="text-sm font-bold font-mono text-white mt-0.5">score(input, output)</h3>
                </div>
                <span
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                    hazardResult.riskLevel === 'HIGH'
                      ? 'bg-[#FEEAEA] text-[#961C1C] border-[#FCCECE]'
                      : hazardResult.riskLevel === 'MODERATE'
                      ? 'bg-[#FEF7E8] text-[#8A570C] border-[#FDE3B5]'
                      : 'bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]'
                  }`}
                >
                  {hazardResult.riskLevel} HAZARD
                </span>
              </div>

              <div className="bg-[#1A2522] border border-[#364844] rounded-xl p-3 font-mono text-[11px] space-y-1.5 mb-4">
                <div className="text-[#A6B49E] text-[10px]">// Input Ciri [temp, RH, wind, rain, FFMC, DMC]</div>
                <div className="text-white break-all">
                  double input[6] = &#123; {temp.toFixed(1)}, {rh.toFixed(1)}, {wind.toFixed(1)}, {rain.toFixed(1)},{' '}
                  {ffmc.toFixed(1)}, {dmc.toFixed(1)} &#125;;
                </div>
                <div className="text-[#A6B49E] text-[10px] pt-1">// Output [P(High), P(Low), P(Moderate)]</div>
                <div className="text-[#E2E0CB] font-bold">
                  output[3] = &#123; {hazardResult.rawVector[0].toFixed(4)}, {hazardResult.rawVector[1].toFixed(4)},{' '}
                  {hazardResult.rawVector[2].toFixed(4)} &#125;;
                </div>
              </div>

              {/* Dual Model Comparison */}
              <div className="space-y-3">
                <div className="bg-[#1A2522] border border-[#364844] rounded-xl p-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[#E2E0CB] font-semibold">1. model_hazard.h (100 Trees RF)</span>
                    <span className="font-bold font-tabular text-white">{hazardResult.confidence.toFixed(1)}%</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-[10px] font-tabular mt-2">
                    <div className="bg-[#23312E] p-1.5 rounded border border-[#364844] text-center">
                      <span className="text-[#FCA5A5] block">High [0]</span>
                      <strong className="text-white">{hazardResult.highProbability.toFixed(1)}%</strong>
                    </div>
                    <div className="bg-[#23312E] p-1.5 rounded border border-[#364844] text-center">
                      <span className="text-[#86EFAC] block">Low [1]</span>
                      <strong className="text-white">{hazardResult.lowProbability.toFixed(1)}%</strong>
                    </div>
                    <div className="bg-[#23312E] p-1.5 rounded border border-[#364844] text-center">
                      <span className="text-[#FDE68A] block">Mod [2]</span>
                      <strong className="text-white">{hazardResult.moderateProbability.toFixed(1)}%</strong>
                    </div>
                  </div>
                </div>

                <div className="bg-[#1A2522] border border-[#364844] rounded-xl p-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[#E2E0CB] font-semibold">2. grenvis_sensor_model.h (MLP)</span>
                    <span className="font-bold font-tabular text-[#E2E0CB]">
                      {floraResult.sensorRisk.toUpperCase()} ({floraResult.sensorConfidence.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-[10px] font-tabular mt-2">
                    <div className="bg-[#23312E] p-1.5 rounded border border-[#364844] text-center">
                      <span className="text-[#FCA5A5] block">High [0]</span>
                      <strong className="text-white">{floraResult.highProbability.toFixed(1)}%</strong>
                    </div>
                    <div className="bg-[#23312E] p-1.5 rounded border border-[#364844] text-center">
                      <span className="text-[#86EFAC] block">Low [1]</span>
                      <strong className="text-white">{floraResult.lowProbability.toFixed(1)}%</strong>
                    </div>
                    <div className="bg-[#23312E] p-1.5 rounded border border-[#364844] text-center">
                      <span className="text-[#FDE68A] block">Mod [2]</span>
                      <strong className="text-white">{floraResult.moderateProbability.toFixed(1)}%</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#364844] flex items-center justify-between text-xs">
              <span className="text-[#A6B49E]">Kaggle Binary Class (0/1):</span>
              <span
                className={`px-2.5 py-0.5 rounded-md font-mono font-bold ${
                  hazardResult.kaggleBinaryPrediction === 'On Fire'
                    ? 'bg-[#DC2626] text-white'
                    : 'bg-[#4E635E] text-white'
                }`}
              >
                {hazardResult.kaggleBinaryPrediction === 'On Fire' ? "1: 'On Fire'" : "0: 'safe'"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Kaggle Notebook & Dataset Official Benchmarks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* Left: Forest Fire Area Classification Notebook Metrics */}
        <div className="flora-card p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex justify-between items-start gap-2 mb-4">
              <div>
                <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
                  Kaggle Reference 1 · Forest Fire Area Classification
                </span>
                <h3 className="text-base font-bold text-[#263A35] font-display mt-0.5">
                  Classifier Benchmark &amp; Holdout Evaluation (517 Samples)
                </h3>
              </div>
              <a
                href={KAGGLE_FOREST_FIRE_STATS.notebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-bold text-[#263A35] bg-[#EFF3EF] hover:bg-[#E2E0CB] px-2.5 py-1 rounded-lg border border-[#A6B49E] transition-colors shrink-0"
              >
                Kaggle Notebook ↗
              </a>
            </div>

            {/* Dataset Split Pill Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
              <div className="bg-[#F5F4EE] border border-[#E2E0CB] p-2.5 rounded-xl">
                <span className="text-[10px] font-bold text-[#50645F] uppercase block">Total Rows</span>
                <span className="text-base font-bold font-tabular text-[#263A35]">517</span>
                <span className="text-[10px] text-[#50645F] block">361 Train / 156 Test</span>
              </div>
              <div className="bg-[#F5F4EE] border border-[#E2E0CB] p-2.5 rounded-xl">
                <span className="text-[10px] font-bold text-[#50645F] uppercase block">Binary Label</span>
                <span className="text-base font-bold font-tabular text-[#263A35]">270 / 247</span>
                <span className="text-[10px] text-[#50645F] block">52.2% Fire · 47.8% Safe</span>
              </div>
              <div className="bg-[#F5F4EE] border border-[#E2E0CB] p-2.5 rounded-xl">
                <span className="text-[10px] font-bold text-[#50645F] uppercase block">model_hazard.h</span>
                <span className="text-base font-bold font-tabular text-[#961C1C]">338 High</span>
                <span className="text-[10px] text-[#50645F] block">146 Mod · 33 Low</span>
              </div>
              <div className="bg-[#F5F4EE] border border-[#E2E0CB] p-2.5 rounded-xl">
                <span className="text-[10px] font-bold text-[#50645F] uppercase block">Max Burned Area</span>
                <span className="text-base font-bold font-tabular text-[#263A35]">1090.84 ha</span>
                <span className="text-[10px] text-[#50645F] block">Mean: 12.85 ha</span>
              </div>
            </div>

            {/* Holdout Table */}
            <div
              className="overflow-x-auto border border-[#E2E0CB] rounded-xl flora-table-scroll focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E]"
              tabIndex={0}
              role="region"
              aria-label="Tabel Evaluasi Holdout Classifier Kaggle"
            >
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F5F4EE] border-b border-[#E2E0CB] text-[10px] font-bold text-[#50645F] uppercase">
                    <th className="py-2.5 px-3">Algorithm (test_size=0.3)</th>
                    <th className="py-2.5 px-2.5 text-right">Accuracy</th>
                    <th className="py-2.5 px-2.5 text-right">Precision</th>
                    <th className="py-2.5 px-2.5 text-right">Recall</th>
                    <th className="py-2.5 px-3 text-right">Confusion Matrix</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E0CB] font-tabular">
                  {KAGGLE_FOREST_FIRE_STATS.classifiersHoldout.map((clf) => (
                    <tr key={clf.name} className="hover:bg-[#EFF3EF]/80 transition-colors">
                      <td className="py-2 px-3 font-sans font-semibold text-[#263A35] whitespace-nowrap">{clf.name}</td>
                      <td className="py-2 px-2.5 text-right font-bold text-[#4E635E] whitespace-nowrap">{clf.accuracy.toFixed(2)}%</td>
                      <td className="py-2 px-2.5 text-right text-[#263A35] whitespace-nowrap">{clf.precision.toFixed(2)}%</td>
                      <td className="py-2 px-2.5 text-right text-[#263A35] whitespace-nowrap">{clf.recall.toFixed(2)}%</td>
                      <td className="py-2 px-3 text-right text-[11px] text-[#50645F] whitespace-nowrap font-mono">
                        {clf.confusionMatrix
                           ? `[[${clf.confusionMatrix[0][0]}, ${clf.confusionMatrix[0][1]}], [${clf.confusionMatrix[1][0]}, ${clf.confusionMatrix[1][1]}]]`
                          : 'Optimal K=19'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Official x_new test vector box */}
            <div className="mt-3.5 bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors rounded-xl p-3 shadow-2xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#4E635E]">
                  Notebook Test Sample (Cell 25, 27, 29, 30, 32)
                </span>
                <button
                  onClick={() => onSelectPreset('kaggle-xnew-benchmark')}
                  aria-label="Muat vektor sampel pengujian x_new ke simulator C header"
                  className="min-h-[30px] text-[10px] font-bold text-white bg-[#4E635E] hover:bg-[#3B4D49] px-2.5 py-1 rounded cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E]"
                >
                  Load x_new ke Simulator
                </button>
              </div>
              <code className="text-[11px] font-mono text-[#263A35] block break-all">
                x_new = [[1, 4, 9, 1, 91.5, 130.1, 807.1, 7.5, 21.3, 35, 2.2, 0]] → Output: &apos;On Fire&apos; (63.68% High Risk)
              </code>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#D6DCCE] text-[11px] text-[#50645F]">
            10-Fold Cross Validation (<code className="font-mono">seed=7</code>): SVM (0.4802) · KNN (0.4684) · MLP (0.4414) · CART (0.4373) · Bagging (0.4298) · GradientBoost (0.4279) · ExtraTrees (0.4086) · NB (0.3975) · AdaBoost (0.3969) · LR (0.3952) · RF (0.3911).
          </div>
        </div>

        {/* Right: FLORA Environmental Risk Dataset (9,000 Rows) & C Model Architecture */}
        <div className="flora-card p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex justify-between items-start gap-2 mb-4">
              <div>
                <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
                  Kaggle Reference 2 · FLORA Environmental Risk Dataset
                </span>
                <h3 className="text-base font-bold text-[#263A35] font-display mt-0.5">
                  Microclimate Sensor Distribution (9,000 Balanced Samples)
                </h3>
              </div>
              <a
                href={KAGGLE_FLORA_DATASET_STATS.datasetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-bold text-[#263A35] bg-[#EFF3EF] hover:bg-[#E2E0CB] px-2.5 py-1 rounded-lg border border-[#A6B49E] transition-colors shrink-0"
              >
                Kaggle Dataset ↗
              </a>
            </div>

            <div className="grid grid-cols-3 gap-2.5 mb-4">
              <div className="bg-[#EFF3EF] border border-[#A6B49E] p-3 rounded-xl text-center">
                <span className="text-[10px] font-bold text-[#263A35] uppercase block">Low Risk Class</span>
                <span className="text-lg font-bold font-tabular text-[#263A35]">3,000</span>
                <span className="text-[10px] text-[#50645F] block">33.33% Balanced</span>
              </div>
              <div className="bg-[#FEF7E8] border border-[#FDE3B5] p-3 rounded-xl text-center">
                <span className="text-[10px] font-bold text-[#8A570C] uppercase block">Moderate Risk</span>
                <span className="text-lg font-bold font-tabular text-[#8A570C]">3,000</span>
                <span className="text-[10px] text-[#8A570C]/80 block">33.33% Balanced</span>
              </div>
              <div className="bg-[#FEEAEA] border border-[#FCCECE] p-3 rounded-xl text-center">
                <span className="text-[10px] font-bold text-[#961C1C] uppercase block">High Risk Class</span>
                <span className="text-lg font-bold font-tabular text-[#961C1C]">3,000</span>
                <span className="text-[10px] text-[#961C1C]/80 block">33.33% Balanced</span>
              </div>
            </div>

            <div className="space-y-2.5 mb-4">
              <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-3 flex justify-between items-center">
                <div>
                  <span className="text-xs font-bold text-[#263A35] block">
                    temperature_c · Suhu Udara Ambien (DHT22)
                  </span>
                  <span className="text-[11px] text-[#50645F]">StandardScaler Normalization Parameter</span>
                </div>
                <div className="text-right font-tabular">
                  <span className="text-sm font-bold text-[#263A35] block">Mean: 28.62 °C</span>
                  <span className="text-[11px] text-[#4E635E] font-semibold">Std: ±4.91 °C</span>
                </div>
              </div>

              <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-3 flex justify-between items-center">
                <div>
                  <span className="text-xs font-bold text-[#263A35] block">
                    humidity_percent · Kelembapan Udara Relatif (DHT22)
                  </span>
                  <span className="text-[11px] text-[#50645F]">StandardScaler Normalization Parameter</span>
                </div>
                <div className="text-right font-tabular">
                  <span className="text-sm font-bold text-[#263A35] block">Mean: 59.83 %</span>
                  <span className="text-[11px] text-[#4E635E] font-semibold">Std: ±14.31 %</span>
                </div>
              </div>

              <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-3 flex justify-between items-center">
                <div>
                  <span className="text-xs font-bold text-[#263A35] block">
                    soil_moisture_percent · Kelembapan Tanah (Capacitive)
                  </span>
                  <span className="text-[11px] text-[#50645F]">StandardScaler Normalization Parameter</span>
                </div>
                <div className="text-right font-tabular">
                  <span className="text-sm font-bold text-[#263A35] block">Mean: 67.15 %</span>
                  <span className="text-[11px] text-[#4E635E] font-semibold">Std: ±17.56 %</span>
                </div>
              </div>
            </div>

            <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-3.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#4E635E] block mb-1">
                Dual Edge-AI Firmware Architecture (C Header Models)
              </span>
              <p className="text-xs text-[#263A35] leading-relaxed m-0">
                Sistem menggabungkan <strong>model_hazard.h</strong> (100-Tree Random Forest <code className="font-mono">m2cgen</code>, 19.591 baris kode C untuk prediksi bahaya api <code className="font-mono">[temp, RH, wind, rain, FFMC, DMC]</code>) dan <strong>grenvis_sensor_model.h</strong> (TFLite Micro Neural Network 3→16→8→3 <code className="font-mono">2.988 bytes</code> untuk evaluasi stres mikroklimat tanah &amp; kanopi).
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#D6DCCE] text-[11px] text-[#50645F]">
            Kedua model C header dieksekusi langsung di memori browser dengan bobot dan pohon keputusan asli tanpa pembulatan.
          </div>
        </div>
      </div>
    </section>
  );
});
