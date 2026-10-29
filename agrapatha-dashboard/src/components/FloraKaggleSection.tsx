import React from 'react';
import {
  KAGGLE_FOREST_FIRE_STATS,
  KAGGLE_FLORA_DATASET_STATS,
} from '../lib/aiModels';

interface KaggleDatasetSectionProps {
  className?: string;
}

export const FloraKaggleSection: React.FC<KaggleDatasetSectionProps> = React.memo(({ className = '' }) => {
  return (
    <section id="benchmarks" className={`scroll-mt-6 sm:scroll-mt-8 space-y-6 ${className}`}>
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-[#D6DCCE]">
        <div>
          <span className="text-[10px] font-bold text-[#4E8577] uppercase tracking-widest block font-mono">
            Repository Evidence &amp; Dataset Provenance
          </span>
          <h2 className="text-xl font-bold text-[#2C2922] font-display mt-0.5">
            Kaggle Dataset Information &amp; Model Benchmarks
          </h2>
        </div>
        <span className="text-xs font-semibold px-3 py-1 rounded-full border bg-[#F1F5F3] text-[#4E8577] border-[#DCE4E1]">
          Verifiable Repository Artifacts
        </span>
      </div>

      {/* 2-Column Grid: Dataset 1 (Montesinho forestfires.csv) & Dataset 2 (Microclimate grenvis_sensor_model) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* Left: Forest Fire Area Classification Notebook Metrics */}
        <div className="flora-card p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex justify-between items-start gap-2 mb-4">
              <div>
                <span className="text-[10px] font-bold text-[#4E8577] uppercase tracking-widest block font-mono">
                  Verified Dataset 1 · Montesinho Park (forestfires.csv)
                </span>
                <h3 className="text-base font-bold text-[#2C2922] font-display mt-0.5">
                  Forest Fire Area Classification &amp; Holdout Evaluation
                </h3>
              </div>
              <a
                href={KAGGLE_FOREST_FIRE_STATS.notebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-bold text-[#2C2922] bg-[#F1F5F3] hover:bg-[#E5EBE8] px-2.5 py-1 rounded-lg border border-[#DCE4E1] transition-colors shrink-0"
              >
                Kaggle Notebook ↗
              </a>
            </div>

            {/* Repository Evidence Box */}
            <div className="mb-4 bg-[#F8FAF9] border border-[#DCE4E1] p-3 rounded-xl text-xs text-[#2C2922] space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[#4D6A75]">
                <span className="font-semibold text-[#56612E]">Berkas Repositori Terverifikasi:</span>
                <span className="font-mono">forestfires.csv (25.996 B)</span>
              </div>
              <p className="text-[11px] text-[#4D6A75] m-0 leading-relaxed">
                Digunakan untuk melatih <code className="font-mono text-[#4E8577]">model_hazard.h</code> (100-Tree Random Forest via m2cgen, 19.591 baris C). Notebook pelatihan <code className="font-mono text-[#4E8577]">forest-fire-area-classification.ipynb</code> tersimpan di root direktori.
              </p>
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
                      <td className="py-2 px-2.5 text-right font-bold text-[#4E8577] whitespace-nowrap">{clf.accuracy.toFixed(2)}%</td>
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

            {/* Official x_new test vector reference */}
            <div className="mt-3.5 bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-3 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#4E8577] block mb-1">
                Notebook Test Vector Reference (Cell 25, 27, 29, 30, 32)
              </span>
              <code className="text-[11px] font-mono text-[#263A35] block break-all">
                x_new = [[1, 4, 9, 1, 91.5, 130.1, 807.1, 7.5, 21.3, 35, 2.2, 0]] → Output: &apos;On Fire&apos; (63.68% High Risk)
              </code>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#D6DCCE] text-[11px] text-[#50645F]">
            10-Fold Cross Validation (<code className="font-mono">seed=7</code>): SVM (0.4802) · KNN (0.4684) · MLP (0.4414) · CART (0.4373) · Bagging (0.4298) · GradientBoost (0.4279) · ExtraTrees (0.4086) · NB (0.3975) · AdaBoost (0.3969) · LR (0.3952) · RF (0.3911).
          </div>
        </div>

        {/* Right: Microclimate Environmental Dataset & Model Architecture */}
        <div className="flora-card p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex justify-between items-start gap-2 mb-4">
              <div>
                <span className="text-[10px] font-bold text-[#4E8577] uppercase tracking-widest block font-mono">
                  Verified Dataset 2 · Microclimate Neural Network
                </span>
                <h3 className="text-base font-bold text-[#263A35] font-display mt-0.5">
                  Microclimate Sensor Distribution &amp; Normalization Parameters
                </h3>
              </div>
              <a
                href={KAGGLE_FLORA_DATASET_STATS.datasetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-bold text-[#263A35] bg-[#F1F5F3] hover:bg-[#E5EBE8] px-2.5 py-1 rounded-lg border border-[#DCE4E1] transition-colors shrink-0"
              >
                Kaggle Dataset ↗
              </a>
            </div>

            {/* Provenance Box */}
            <div className="mb-4 bg-[#F8FAF9] border border-[#DCE4E1] p-3 rounded-xl text-xs text-[#263A35] space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[#4D6A75]">
                <span className="font-semibold text-[#56612E]">Artefak Firmware Terverifikasi:</span>
                <span className="font-mono">grenvis_sensor_model.h (19.187 B)</span>
              </div>
              <p className="text-[11px] text-[#4D6A75] m-0 leading-relaxed">
                Model TFLite Micro berukuran 2.988 bytes array C yang dieksekusi langsung di memori untuk evaluasi mikroklimat tanah dan udara perakaran.
              </p>
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
                Sistem AGRAPATHA mengintegrasikan <strong>model_hazard.h</strong> (100-Tree Random Forest <code className="font-mono">m2cgen</code>, 19.591 baris C untuk fitur input <code className="font-mono">[temp, RH, wind, rain, FFMC, DMC]</code>) dan <strong>grenvis_sensor_model.h</strong> (TFLite Micro Neural Network 3→16→8→3 <code className="font-mono">2.988 bytes</code> untuk evaluasi stres mikroklimat).
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#D6DCCE] text-[11px] text-[#50645F]">
            Kedua model C header dieksekusi secara deterministik langsung di memori perangkat edge dan browser tanpa pembulatan.
          </div>
        </div>
      </div>
    </section>
  );
});

export const KaggleDatasetSection = FloraKaggleSection;
