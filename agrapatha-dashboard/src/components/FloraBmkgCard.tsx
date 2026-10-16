/**
 * Flora AI Dashboard — BMKG Regional Weather Card
 * Standalone UI component displaying external macro-weather forecast and early warnings.
 * Strictly isolated from local microclimate sensor models and safety interlocks.
 */

import React, { useEffect, useId, useMemo, useState } from 'react';
import type {
  BmkgForecastStepNormalized,
  BmkgNormalizedAlert,
  BmkgRegionRecord,
  BmkgServiceState,
} from '../types/bmkg.ts';
import {
  formatDataAge,
  getBmkgRegionalData,
} from '../lib/bmkgService.ts';
import VERIFIED_PRESETS from '../data/indonesiaAdm4Presets.json';

interface FloraBmkgCardProps {
  /** Optional custom initial region */
  initialRegion?: BmkgRegionRecord;
  /** Optional mock forecast for testing / offline demo */
  mockFixtureForecast?: unknown;
  /** Optional mock warning XML for testing / offline demo */
  mockFixtureWarningXml?: string;
  /** Class name overrides */
  className?: string;
}

import { getTimezoneLabel } from '../lib/bmkgForecastParser.ts';

export const FloraBmkgCard: React.FC<FloraBmkgCardProps> = ({
  initialRegion,
  mockFixtureForecast,
  mockFixtureWarningXml,
  className = '',
}) => {
  const regionSelectId = useId();
  const presets: BmkgRegionRecord[] = useMemo(() => VERIFIED_PRESETS as BmkgRegionRecord[], []);
  const [selectedAdm4, setSelectedAdm4] = useState<string>(
    initialRegion?.adm4 || presets[0]?.adm4 || '31.71.01.1001'
  );

  const activeRegion = useMemo(() => {
    return presets.find((p) => p.adm4 === selectedAdm4) || presets[0];
  }, [presets, selectedAdm4]);

  const [state, setState] = useState<BmkgServiceState>({
    status: 'LOADING',
    forecast: null,
    alerts: [],
    selectedRegion: activeRegion,
    retrievalTimestamp: null,
    sourceAnalysisDate: null,
    errorMessage: null,
    staleReason: null,
  });

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Fetch or revalidate on region change or manual refresh
  const loadData = React.useCallback(
    async (force = false) => {
      setIsRefreshing(true);
      setState((prev) => ({ ...prev, status: 'LOADING' }));
      try {
        const result = await getBmkgRegionalData(activeRegion, {
          forceRefresh: force,
          mockFixtureForecast,
          mockFixtureWarningXml,
        });
        setState(result);
      } catch (err) {
        setState((prev) => ({
          ...prev,
          status: 'ERROR',
          errorMessage: err instanceof Error ? err.message : 'Gagal memuat data BMKG',
        }));
      } finally {
        setIsRefreshing(false);
      }
    },
    [activeRegion, mockFixtureForecast, mockFixtureWarningXml]
  );

  useEffect(() => {
    let isMounted = true;
    loadData(false).catch(() => {
      if (isMounted) {
        setState((prev) => ({ ...prev, status: 'ERROR', errorMessage: 'Gagal menghubungi BMKG' }));
      }
    });
    return () => {
      isMounted = false;
    };
  }, [loadData]);

  const formatRetrievalTime = (timestamp: number | null): string => {
    if (!timestamp) return 'Belum tersedia';
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const tz = getTimezoneLabel(activeRegion.timezone);
    return `${hours}:${minutes} (Lokal / ${tz}) · ${formatDataAge(timestamp)}`;
  };

  const currentStep: BmkgForecastStepNormalized | null = state.forecast?.currentStep || null;
  const activeAlerts: BmkgNormalizedAlert[] = state.alerts || [];

  return (
    <section
      id="bmkg"
      aria-label="BMKG Regional Weather Context"
      className={`scroll-mt-6 sm:scroll-mt-8 bg-white border border-[#D6DCCE] rounded-2xl p-5 sm:p-6 lg:p-7 shadow-xs transition-all ${className}`}
    >
      {/* Header & Region Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-[#D6DCCE]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-[#4E635E] animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#4E635E]">
              External Macro-Weather Context · Open Data BMKG
            </span>
          </div>
          <h2 className="text-xl font-bold text-[#263A35] font-display tracking-tight flex items-center gap-2 flex-wrap">
            <span>BMKG Regional Forecast &amp; Nowcast Alerts</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E8EDE6] text-[#364844] border border-[#D6DCCE]">
              adm4: {activeRegion.adm4}
            </span>
            {!activeRegion.isVerified && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FEF7E8] text-[#8A570C] border border-[#FDE3B5]">
                Koordinat Belum Terverifikasi
              </span>
            )}
          </h2>
        </div>

        {/* Controls: Region Picker + Refresh */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label htmlFor={regionSelectId} className="text-xs font-semibold text-[#50645F] whitespace-nowrap">
              Wilayah:
            </label>
            <select
              id={regionSelectId}
              value={selectedAdm4}
              onChange={(e) => setSelectedAdm4(e.target.value)}
              className="bg-[#F7F8F5] border border-[#D6DCCE] text-[#263A35] text-xs font-semibold rounded-xl px-3 py-1.5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E] cursor-pointer"
            >
              {presets.map((preset) => (
                <option key={preset.adm4} value={preset.adm4}>
                  {preset.desa}, {preset.kecamatan} ({preset.kotkab}) {preset.isVerified ? '✓' : '(Belum Terverifikasi)'}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="px-3 py-1.5 rounded-xl bg-[#4E635E] hover:bg-[#3D4F4B] text-white text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            aria-label="Perbarui data BMKG"
          >
            <span className={isRefreshing ? 'animate-spin' : ''}>↻</span>
            <span>{isRefreshing ? 'Menyinkron...' : 'Perbarui'}</span>
          </button>
        </div>
      </div>

      {/* Freshness Status Strip */}
      <div className="mt-3.5 mb-4 flex items-center justify-between text-[11px] text-[#50645F] flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {state.status === 'SUCCESS_FRESH' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EBF4EC] text-[#226330] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#226330]" />
              <span>Diambil dari BMKG: {formatRetrievalTime(state.retrievalTimestamp)}</span>
            </span>
          )}
          {state.status === 'SUCCESS_STALE' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FEF7E8] text-[#8A570C] font-semibold border border-[#FDE3B5]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
              <span>Data Tersimpan (Stale): {formatRetrievalTime(state.retrievalTimestamp)}</span>
            </span>
          )}
          {state.status === 'EXPIRED' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FEE2E2] text-[#991B1B] font-semibold">
              <span>⚠ Prakiraan Kedaluwarsa (&gt;60 menit)</span>
            </span>
          )}
          {state.status === 'LOADING' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#F0F2ED] text-[#50645F] font-semibold">
              <span>Menghubungi layanan BMKG...</span>
            </span>
          )}
          {state.status === 'ERROR' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FEE2E2] text-[#991B1B] font-semibold">
              <span>Gagal memuat: {state.errorMessage}</span>
            </span>
          )}
        </div>

        {state.sourceAnalysisDate && (
          <span className="font-mono text-[10px] text-[#50645F]">
            Model Analysis: {state.sourceAnalysisDate}
          </span>
        )}
      </div>

      {/* Stale Warning Banner if applicable */}
      {state.staleReason && (
        <div className="mb-4 p-3 rounded-xl bg-[#FEF7E8] border border-[#FDE3B5] text-[#8A570C] text-xs leading-relaxed flex items-center gap-2">
          <span className="text-base">⚠</span>
          <span>{state.staleReason}</span>
        </div>
      )}

      {/* Early Weather Warnings Banner */}
      {activeAlerts.length > 0 && (
        <div className="mb-6 space-y-3">
          {activeAlerts.map((alert) => (
            <aside
              key={alert.id}
              className="p-4 rounded-xl bg-[#FFF5F5] border border-[#FED7D7] text-[#9B2C2C] shadow-xs"
              aria-label={`Peringatan Cuaca: ${alert.event}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#E53E3E] animate-ping" />
                  <span className="font-bold text-xs sm:text-sm font-display tracking-tight text-[#9B2C2C]">
                    ⚠ {alert.event}: {alert.headline}
                  </span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FED7D7] text-[#9B2C2C] uppercase tracking-wider">
                  {alert.applicability === 'GEOGRAPHIC_MATCH' ? 'Area Terverifikasi' : 'Peringatan Regional'}
                </span>
              </div>

              <p className="text-xs text-[#742A2A] mt-2 leading-relaxed">
                {alert.description}
              </p>

              <div className="mt-3 pt-2.5 border-t border-[#FED7D7] flex items-center justify-between text-[11px] text-[#9B2C2C]/80 flex-wrap gap-2">
                <div>
                  <span>Berlaku: </span>
                  <span className="font-semibold">
                    {alert.validityStatus === 'UNKNOWN_EXPIRY'
                      ? 'Waktu kedaluwarsa tidak dispesifikasikan oleh BMKG'
                      : `Hingga ${alert.expiresTime || 'N/A'}`}
                  </span>
                </div>
                <span className="text-[10px] bg-white/70 px-2 py-0.5 rounded border border-[#FED7D7] font-medium">
                  {alert.applicability === 'GEOGRAPHIC_MATCH'
                    ? 'Koordinat titik kanopi cocok dengan poligon BMKG'
                    : 'Peringatan tingkat regional — keterkaitan spesifik ke desa/kelurahan belum terverifikasi secara spasial.'}
                </span>
              </div>
            </aside>
          ))}
        </div>
      )}

      {/* Main Forecast Cards Display */}
      {state.status === 'LOADING' && !state.forecast ? (
        <div className="animate-pulse space-y-4 py-6">
          <div className="h-20 bg-[#F0F2ED] rounded-xl" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="h-24 bg-[#F0F2ED] rounded-xl" />
            <div className="h-24 bg-[#F0F2ED] rounded-xl" />
            <div className="h-24 bg-[#F0F2ED] rounded-xl" />
            <div className="h-24 bg-[#F0F2ED] rounded-xl" />
          </div>
        </div>
      ) : currentStep ? (
        <div className="space-y-6">
          {/* Current Observed Conditions Box */}
          <div className="bg-[#23312E] text-white p-5 rounded-2xl shadow-xs border border-[#364844] flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold tracking-widest text-[#E2E0CB] block">
                Kondisi Cuaca Terkini · {activeRegion.desa}, {activeRegion.kecamatan}
              </span>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl lg:text-4xl font-extrabold font-display tracking-tight text-white">
                  {currentStep.temperatureC}°C
                </span>
                <span className="text-sm font-semibold text-[#A6B49E]">
                  {currentStep.weatherDesc} ({currentStep.weatherDescEn})
                </span>
              </div>
              <span className="text-[11px] text-[#E2E0CB]/80 block font-mono">
                Waktu Interval: {currentStep.localDatetime} {getTimezoneLabel(state.forecast?.timezone || activeRegion.timezone)}
              </span>
            </div>

            {/* Weather Metrics Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 w-full md:w-auto">
              <div className="bg-[#1A2522] border border-[#364844] px-3 py-2 rounded-xl text-center">
                <span className="text-[10px] text-[#E2E0CB]/80 block">Kelembapan</span>
                <span className="text-sm font-bold text-white font-tabular">{currentStep.humidityPercent}%</span>
              </div>
              <div className="bg-[#1A2522] border border-[#364844] px-3 py-2 rounded-xl text-center">
                <span className="text-[10px] text-[#E2E0CB]/80 block">Angin</span>
                <span className="text-sm font-bold text-white font-tabular">
                  {currentStep.windSpeedKmh} km/h {currentStep.windDirectionCardinal || ''}
                </span>
              </div>
              <div className="bg-[#1A2522] border border-[#364844] px-3 py-2 rounded-xl text-center">
                <span className="text-[10px] text-[#E2E0CB]/80 block">Awan</span>
                <span className="text-sm font-bold text-white font-tabular">
                  {currentStep.cloudCoverPercent !== undefined ? `${currentStep.cloudCoverPercent}%` : 'N/A'}
                </span>
              </div>
              <div className="bg-[#1A2522] border border-[#364844] px-3 py-2 rounded-xl text-center">
                <span className="text-[10px] text-[#E2E0CB]/80 block">Presipitasi</span>
                <span className="text-sm font-bold text-white font-tabular">
                  {currentStep.precipitationMm !== undefined ? `${currentStep.precipitationMm} mm` : '0 mm'}
                </span>
              </div>
            </div>
          </div>

          {/* 3-Hour Forecast Progression Timeline */}
          {state.forecast && state.forecast.allSteps.length > 1 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-bold text-[#263A35] font-display uppercase tracking-wider">
                  Proyeksi Prakiraan Cuaca 3-Harian BMKG (Interval 3-Jam)
                </span>
                <span className="text-[11px] text-[#50645F] font-mono">
                  Total {state.forecast.allSteps.length} Titik Data
                </span>
              </div>

              <div className="overflow-x-auto pb-2 flex gap-2.5 scrollbar-thin">
                {state.forecast.allSteps.slice(0, 12).map((step, idx) => (
                  <div
                    key={`${step.utcDatetime}-${idx}`}
                    className="min-w-[130px] bg-[#F7F8F5] border border-[#D6DCCE] p-3 rounded-xl flex flex-col justify-between shrink-0 shadow-2xs hover:border-[#4E635E] transition-colors"
                  >
                    <div>
                      <span className="text-[10px] text-[#50645F] block font-mono">
                        {step.localDatetime.split(' ')[1] || step.localDatetime}
                      </span>
                      <span className="text-sm font-bold text-[#263A35] font-tabular block mt-0.5">
                        {step.temperatureC}°C
                      </span>
                    </div>
                    <div className="mt-2 pt-2 border-t border-[#D6DCCE]/60 text-[10px] text-[#50645F]">
                      <span className="font-semibold block truncate" title={step.weatherDesc}>
                        {step.weatherDesc}
                      </span>
                      <div className="flex justify-between mt-1 text-[9px] text-[#50645F]/80">
                        <span>RH: {step.humidityPercent}%</span>
                        <span>{step.windSpeedKmh}km/h</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 bg-[#F7F8F5] rounded-xl border border-dashed border-[#D6DCCE]">
          <p className="text-xs text-[#50645F] font-medium">
            Data prakiraan cuaca belum tersedia untuk wilayah ini.
          </p>
        </div>
      )}

      {/* Mandatory Attribution & Safety Firewall Disclaimer */}
      <footer className="mt-6 pt-4 border-t border-[#D6DCCE] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[10px] text-[#50645F]">
        <div>
          <span className="font-bold text-[#263A35]">Sumber Resmi: </span>
          <span>Badan Meteorologi, Klimatologi, dan Geofisika (BMKG) · Open Data API</span>
        </div>
        <div className="text-left sm:text-right max-w-md text-[#50645F]/80">
          Informasi makro-regional eksternal. Beroperasi secara independen dari sensor mikroklimat lokal dan model inferensi C header Flora.
        </div>
      </footer>
    </section>
  );
};
