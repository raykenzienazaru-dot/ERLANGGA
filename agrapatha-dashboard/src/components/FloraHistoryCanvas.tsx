import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Flame,
  ThermometerSun,
  Sprout,
  ShieldAlert,
} from 'lucide-react';

export interface TelemetryHistoryPoint {
  timestamp: string;
  temperature: number;
  humidity: number;
  soil_moisture: number;
  wind: number;
  rain: number;
  ffmc: number;
  dmc: number;
  dc: number;
  isi: number;
  sensor_risk: 'LOW' | 'MODERATE' | 'HIGH';
  sensor_confidence: number;
  vision_prediction: string;
}

export interface FloraHistoryCanvasProps {
  history: TelemetryHistoryPoint[];
  liveTemp?: number | null;
  liveRh?: number | null;
  liveSoil?: number | null;
  liveFfmc?: number | null;
  liveRisk?: 'LOW' | 'MODERATE' | 'HIGH' | null;
  liveVisionPrediction?: string | null;
  liveFlameDetected?: number | null;
  isLive?: boolean;
}

function formatTimeShort(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

export const FloraHistoryCanvas: React.FC<FloraHistoryCanvasProps> = React.memo(({
  history,
  liveTemp,
  liveRh,
  liveSoil,
  liveFfmc,
  liveRisk,
  liveVisionPrediction,
  liveFlameDetected,
  isLive,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [timeRange, setTimeRange] = useState<'LIVE' | '1H' | '6H' | '24H'>('24H');
  const [channelFilter, setChannelFilter] = useState<'ALL' | 'TEMP' | 'HUM' | 'FFMC' | 'SOIL'>('ALL');
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    record: TelemetryHistoryPoint;
  } | null>(null);

  // Isolate crosshair X from tooltip Y to prevent canvas redraws on vertical cursor movement
  const hoverX = hoverInfo ? hoverInfo.x : null;

  const visiblePoints = React.useMemo(() => {
    if (!history || history.length === 0) return [];
    if (timeRange === 'LIVE') return history.slice(-20);
    if (timeRange === '1H') return history.slice(-30);
    if (timeRange === '6H') return history.slice(-40);
    return history.slice(-50);
  }, [history, timeRange]);

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height || 280;
    if (w === 0) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const padL = 46;
    const padR = 46;
    const padT = 24;
    const padB = 30;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#D6DCCE';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();

      ctx.fillStyle = '#50645F';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${100 - i * 25}%`, padL - 8, y + 3.5);

      ctx.fillStyle = '#D97706';
      ctx.textAlign = 'left';
      ctx.fillText(`${(40 - i * 10).toFixed(0)}°C`, w - padR + 8, y + 3.5);
    }

    if (!visiblePoints || visiblePoints.length === 0) {
      ctx.fillStyle = '#50645F';
      ctx.font = '12px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Menunggu rekaman telemetri riwayat sensor...', w / 2, h / 2);
      return;
    }

    const series = [
      {
        field: 'humidity' as const,
        color: '#0284C7',
        show: channelFilter === 'ALL' || channelFilter === 'HUM',
        scaleMax: 100,
      },
      {
        field: 'ffmc' as const,
        color: '#DC2626',
        show: channelFilter === 'ALL' || channelFilter === 'FFMC',
        scaleMax: 100,
      },
      {
        field: 'soil_moisture' as const,
        color: '#4E635E',
        show: channelFilter === 'ALL' || channelFilter === 'SOIL',
        scaleMax: 100,
      },
      {
        field: 'temperature' as const,
        color: '#D97706',
        show: channelFilter === 'ALL' || channelFilter === 'TEMP',
        scaleMax: 40,
      },
    ];

    series.forEach(({ field, color, show, scaleMax }) => {
      if (!show) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      visiblePoints.forEach((pt, idx) => {
        const raw = Number(pt[field]);
        const clamped = Math.min(scaleMax, Math.max(0, isNaN(raw) ? 0 : raw));
        const x = padL + (plotW * idx) / Math.max(1, visiblePoints.length - 1);
        const y = padT + plotH * (1 - clamped / scaleMax);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    if (visiblePoints.length >= 2) {
      ctx.fillStyle = '#50645F';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(formatTimeShort(visiblePoints[0].timestamp), padL, h - 8);

      ctx.textAlign = 'center';
      const mid = Math.floor(visiblePoints.length / 2);
      ctx.fillText(formatTimeShort(visiblePoints[mid].timestamp), padL + plotW / 2, h - 8);

      ctx.textAlign = 'right';
      ctx.fillText(formatTimeShort(visiblePoints[visiblePoints.length - 1].timestamp), w - padR, h - 8);
    }

    if (hoverX !== null) {
      ctx.strokeStyle = '#4E635E';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverX, padT);
      ctx.lineTo(hoverX, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [visiblePoints, hoverX, channelFilter]);

  const drawChartRef = useRef(drawChart);
  drawChartRef.current = drawChart;

  // Render chart on canvas via RAF when dependencies update
  useEffect(() => {
    const animId = requestAnimationFrame(() => {
      drawChart();
    });
    return () => cancelAnimationFrame(animId);
  }, [drawChart]);

  // Window resize handler: bound only once on mount, debounced with RAF
  useEffect(() => {
    let animId = 0;
    const onResize = () => {
      setHoverInfo(null);
      cancelAnimationFrame(animId);
      animId = requestAnimationFrame(() => {
        drawChartRef.current();
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animId);
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !visiblePoints || visiblePoints.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const padL = 46;
    const plotW = rect.width - padL - 46;
    const clampedX = Math.max(0, Math.min(plotW, relX - padL));
    const idx = Math.round((clampedX / plotW) * (visiblePoints.length - 1));
    const rec = visiblePoints[idx];
    if (rec) {
      const newX = padL + (plotW * idx) / Math.max(1, visiblePoints.length - 1);
      const newY = e.clientY - rect.top;
      setHoverInfo((prev) => {
        if (prev && prev.record === rec && Math.abs(prev.y - newY) < 3) {
          return prev;
        }
        return { x: newX, y: newY, record: rec };
      });
    }
  };

  // Compute summary stats with useMemo so they are NOT recalculated on every mouse move
  const { avgTemp, avgHum, avgFfmc, avgSoil, latestRec } = React.useMemo(() => {
    const len = Math.max(1, visiblePoints.length);
    const aTemp = visiblePoints.reduce((acc, r) => acc + r.temperature, 0) / len;
    const aHum = visiblePoints.reduce((acc, r) => acc + r.humidity, 0) / len;
    const aFfmc = visiblePoints.reduce((acc, r) => acc + r.ffmc, 0) / len;
    const aSoil = visiblePoints.reduce((acc, r) => acc + r.soil_moisture, 0) / len;
    const lRec = visiblePoints[visiblePoints.length - 1];
    return { avgTemp: aTemp, avgHum: aHum, avgFfmc: aFfmc, avgSoil: aSoil, latestRec: lRec };
  }, [visiblePoints]);

  return (
    <>
      <section id="history" className="scroll-mt-6 sm:scroll-mt-8 flora-card p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 mb-4">
          <div>
            <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
              Telemetry Archive
            </span>
            <h2 className="text-lg font-bold text-[#263A35] font-display mt-0.5">
              Multi-Sensor &amp; FWI Historical Trends
            </h2>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <div
              className="flex rounded-xl bg-[#F5F4EE] p-1 border border-[#E2E0CB] text-xs font-semibold"
              role="group"
              aria-label="Filter Channel Metrik Grafik Telemetri"
            >
              <button
                onClick={() => setChannelFilter('ALL')}
                aria-pressed={channelFilter === 'ALL'}
                aria-label="Tampilkan semua channel metrik (All)"
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E] ${
                  channelFilter === 'ALL'
                    ? 'bg-white text-[#263A35] shadow-xs font-bold'
                    : 'text-[#50645F] hover:text-[#263A35]'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setChannelFilter('TEMP')}
                aria-pressed={channelFilter === 'TEMP'}
                aria-label="Filter channel Temperatur (°C)"
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#D97706] ${
                  channelFilter === 'TEMP'
                    ? 'bg-white text-[#D97706] shadow-xs font-bold'
                    : 'text-[#50645F] hover:text-[#D97706]'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-[#D97706]" aria-hidden="true" />
                <span>Temp (°C)</span>
              </button>
              <button
                onClick={() => setChannelFilter('HUM')}
                aria-pressed={channelFilter === 'HUM'}
                aria-label="Filter channel Kelembaban Udara RH (%)"
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#0284C7] ${
                  channelFilter === 'HUM'
                    ? 'bg-white text-[#0284C7] shadow-xs font-bold'
                    : 'text-[#50645F] hover:text-[#0284C7]'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-[#0284C7]" aria-hidden="true" />
                <span>RH (%)</span>
              </button>
              <button
                onClick={() => setChannelFilter('FFMC')}
                aria-pressed={channelFilter === 'FFMC'}
                aria-label="Filter channel Indeks FFMC"
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#DC2626] ${
                  channelFilter === 'FFMC'
                    ? 'bg-white text-[#DC2626] shadow-xs font-bold'
                    : 'text-[#50645F] hover:text-[#DC2626]'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-[#DC2626]" aria-hidden="true" />
                <span>FFMC (idx)</span>
              </button>
              <button
                onClick={() => setChannelFilter('SOIL')}
                aria-pressed={channelFilter === 'SOIL'}
                aria-label="Filter channel Kelembaban Tanah (%)"
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E] ${
                  channelFilter === 'SOIL'
                    ? 'bg-white text-[#4E635E] shadow-xs font-bold'
                    : 'text-[#50645F] hover:text-[#4E635E]'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-[#4E635E]" aria-hidden="true" />
                <span>Soil (%)</span>
              </button>
            </div>

            <div
              className="flex rounded-xl bg-[#F5F4EE] p-1 border border-[#E2E0CB] text-xs font-semibold"
              role="group"
              aria-label="Filter Rentang Waktu Grafik"
            >
              {(['LIVE', '1H', '6H', '24H'] as const).map((rng) => (
                <button
                  key={rng}
                  onClick={() => setTimeRange(rng)}
                  aria-pressed={timeRange === rng}
                  aria-label={`Pilih rentang waktu riwayat ${rng}`}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E] ${
                    timeRange === rng
                      ? 'bg-white text-[#4E635E] shadow-xs font-bold'
                      : 'text-[#50645F] hover:text-[#263A35]'
                  }`}
                >
                  {rng}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Dual Axis Metric Legend Strip */}
        <div className="flex items-center justify-between text-[11px] font-mono text-[#50645F] pb-2 border-b border-[#D6DCCE] mb-2 px-1 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-[#263A35]">Y1 Axis (Left):</span>
            <span className="flex items-center gap-1 text-[#0284C7] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0284C7]" />
              RH %
            </span>
            <span className="text-[#CCD7CE]">·</span>
            <span className="flex items-center gap-1 text-[#DC2626] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
              FFMC
            </span>
            <span className="text-[#CCD7CE]">·</span>
            <span className="flex items-center gap-1 text-[#4E635E] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4E635E]" />
              Soil %
            </span>
            <span className="text-[10px] text-[#50645F]">(0 – 100%)</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#D97706] font-semibold">
            <span className="font-bold text-[#263A35]">Y2 Axis (Right):</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />
            <span>Temp °C (0 – 40°C)</span>
          </div>
        </div>

        {/* Canvas Container */}
        <div className="relative w-full h-[260px] lg:h-[285px] xl:h-[300px] my-2 bg-white rounded-xl border border-[#D6DCCE] overflow-hidden">
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverInfo(null)}
            role="img"
            aria-label={`Grafik riwayat multi-sensor dan FWI untuk rentang waktu ${timeRange} dengan filter channel ${channelFilter}`}
            tabIndex={0}
            className="w-full h-[260px] lg:h-[285px] xl:h-[300px] block cursor-crosshair focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E]"
          />
          {hoverInfo && (
            <div
              className="absolute z-20 pointer-events-none bg-[#23312E] text-white p-3.5 rounded-xl shadow-xl text-xs border border-[#364844] -translate-x-1/2 -translate-y-full mb-2 min-w-[215px] backdrop-blur-sm"
              style={{ left: hoverInfo.x, top: Math.max(70, hoverInfo.y) }}
            >
              <div className="text-[10px] font-bold text-[#E2E0CB] font-tabular border-b border-[#364844] pb-1.5 mb-2 flex items-center justify-between">
                <span>Time Recorded</span>
                <span>{formatTimeShort(hoverInfo.record.timestamp)}</span>
              </div>
              <div className="space-y-1.5 font-tabular">
                <div className="flex justify-between items-center">
                  <span className="text-[#F0F4E8] flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#D97706]" />
                    Temperature:
                  </span>
                  <span className="font-bold text-[#FDE68A]">{hoverInfo.record.temperature.toFixed(1)} °C</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#F0F4E8] flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#0284C7]" />
                    Air Humidity:
                  </span>
                  <span className="font-bold text-[#BAE6FD]">{hoverInfo.record.humidity.toFixed(1)} %</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#F0F4E8] flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#DC2626]" />
                    FFMC / DMC:
                  </span>
                  <span className="font-bold text-[#FCA5A5]">
                    {hoverInfo.record.ffmc.toFixed(1)} / {hoverInfo.record.dmc.toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#F0F4E8] flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#4E635E]" />
                    Soil Moisture:
                  </span>
                  <span className="font-bold text-[#E2E0CB]">{hoverInfo.record.soil_moisture.toFixed(1)} %</span>
                </div>
                <div className="pt-1.5 mt-1.5 border-t border-[#364844] flex justify-between items-center">
                  <span className="text-[#A6B49E]">model_hazard.h:</span>
                  <span className="font-bold text-white">
                    {hoverInfo.record.sensor_risk} ({hoverInfo.record.sensor_confidence.toFixed(1)}%)
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom 3 Trend Boxes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-4 pt-3 border-t border-[#D6DCCE]">
          <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors p-3.5 rounded-xl shadow-2xs flex flex-col justify-between min-h-[92px]">
            <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block font-mono">
              Fine Fuel Moisture (FFMC) Trend
            </span>
            <span
              className={`text-sm font-bold font-display block mt-1.5 ${
                (latestRec?.ffmc ?? 0) >= 89.5 ? 'text-[#B43E1F]' : 'text-[#4E635E]'
              }`}
            >
              {(latestRec?.ffmc ?? 0) >= 89.5
                ? `Critical Ignition Zone (${latestRec?.ffmc.toFixed(1)})`
                : `Stable Fuel Moisture (${latestRec?.ffmc.toFixed(1)})`}
            </span>
          </div>
          <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors p-3.5 rounded-xl shadow-2xs flex flex-col justify-between min-h-[92px]">
            <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block font-mono">
              Soil Moisture Momentum
            </span>
            <span
              className={`text-sm font-bold font-display block mt-1.5 ${
                (latestRec?.soil_moisture ?? 50) < 30 ? 'text-[#D97706]' : 'text-[#4E635E]'
              }`}
            >
              {(latestRec?.soil_moisture ?? 50) < 30 ? 'Decreasing / Dry Stress' : 'Optimal Hydration'}
            </span>
          </div>
          <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors p-3.5 rounded-xl shadow-2xs flex flex-col justify-between min-h-[92px]">
            <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block font-mono">
              ESP32-CAM Optical Detection Trend
            </span>
            <span
              className={`text-sm font-bold font-display block mt-1.5 ${
                latestRec?.vision_prediction.toLowerCase().includes('fire')
                  ? 'text-[#B43E1F]'
                  : latestRec?.vision_prediction.toLowerCase().includes('smoke')
                  ? 'text-[#EA580C]'
                  : 'text-[#4E635E]'
              }`}
            >
              {latestRec?.vision_prediction || 'Healthy Forest Canopy'}
            </span>
          </div>
        </div>

        {/* =========================================================================
            PANDUAN PENANGANAN & REKOMENDASI SOLUSI CERDAS (DI BAWAH GRAFIK MULTISENSOR)
            Otomatis aktif saat ada problem kebakaran, suhu-kelembapan, dan tanah kering/basah
           ========================================================================= */}
        {(() => {
          // Effective parameters: prioritize live telemetry, fallback to latest historical point
          const currentTemp = typeof liveTemp === 'number' ? liveTemp : latestRec?.temperature ?? null;
          const currentRh = typeof liveRh === 'number' ? liveRh : latestRec?.humidity ?? null;
          const currentSoil = typeof liveSoil === 'number' ? liveSoil : latestRec?.soil_moisture ?? null;
          const currentFfmc = typeof liveFfmc === 'number' ? liveFfmc : latestRec?.ffmc ?? null;
          const currentRisk = liveRisk || latestRec?.sensor_risk || null;
          const currentVision = liveVisionPrediction || latestRec?.vision_prediction || null;
          const currentFlame = typeof liveFlameDetected === 'number' ? liveFlameDetected : null;

          // 1. Fire Diagnostic State
          const isFireAlert =
            currentFlame === 1 ||
            (currentVision && currentVision.toLowerCase().includes('fire')) ||
            (currentVision && currentVision.toLowerCase().includes('smoke')) ||
            (currentFfmc !== null && currentFfmc >= 89.5) ||
            currentRisk === 'HIGH';
          const isFireWarning = !isFireAlert && ((currentFfmc !== null && currentFfmc >= 82) || currentRisk === 'MODERATE');

          // 2. Microclimate Diagnostic State
          const isMicroclimateHotDry = (currentTemp !== null && currentTemp >= 30) || (currentRh !== null && currentRh <= 40);
          const isMicroclimateColdWet = !isMicroclimateHotDry && ((currentRh !== null && currentRh >= 88) || (currentTemp !== null && currentTemp <= 14));

          // 3. Soil Moisture Diagnostic State
          const isSoilDry = currentSoil !== null && currentSoil < 30;
          const isSoilWet = currentSoil !== null && currentSoil > 75;

          return (
            <div className="mt-6 pt-5 border-t border-[#D6DCCE]">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
                <div>
                  <span className="text-[10px] font-bold text-[#56612E] uppercase tracking-widest block font-mono">
                    Panduan Tindakan &amp; Mitigasi Operasional
                  </span>
                  <h3 className="text-base sm:text-lg font-bold text-[#2C2922] font-display flex items-center gap-2 mt-0.5">
                    <ShieldAlert size={18} className="text-[#56612E] shrink-0" />
                    <span>Solusi Penanganan Masalah (Multisensor Mitigation Protocol)</span>
                  </h3>
                </div>
                <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#FAF9F5] border border-[#DCE4E1] text-[#2C2922] shadow-2xs font-mono">
                  {isLive ? '● Live Telemetri Aktif' : '○ Standby & Protokol Kontingensi'}
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* ---------------- CARD 1: MITIGASI MASALAH KEBAKARAN ---------------- */}
                <div
                  className={`rounded-2xl p-4 sm:p-5 flex flex-col justify-between border transition-all duration-300 ${
                    isFireAlert
                      ? 'bg-[#FEF2F2] border-[#F87171] shadow-md ring-1 ring-[#EF4444]/20'
                      : isFireWarning
                      ? 'bg-[#FFFBEB] border-[#FBBF24] shadow-xs ring-1 ring-[#F59E0B]/20'
                      : 'bg-[#F9F8F5] border-[#DCE4E1] shadow-2xs'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-black/10">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-xl flex items-center justify-center text-white shrink-0 ${
                            isFireAlert ? 'bg-[#DC2626]' : isFireWarning ? 'bg-[#D97706]' : 'bg-[#56612E]'
                          }`}
                        >
                          <Flame size={15} />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider block text-[#2C2922]/70 font-mono">
                            Domain 1 · Kebakaran
                          </span>
                          <h4 className="text-sm font-bold text-[#2C2922] font-display">
                            Bahaya Api &amp; Serasah
                          </h4>
                        </div>
                      </div>
                      <span
                        className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full font-mono shrink-0 ${
                          isFireAlert
                            ? 'bg-[#DC2626] text-white animate-pulse'
                            : isFireWarning
                            ? 'bg-[#D97706] text-white'
                            : 'bg-[#56612E] text-white'
                        }`}
                      >
                        {isFireAlert ? 'KRITIS' : isFireWarning ? 'WASPADA' : 'AMAN'}
                      </span>
                    </div>

                    <div className="mt-3 text-xs">
                      <p className="text-[11px] text-[#2C2922]/90 leading-relaxed font-medium">
                        {isFireAlert
                          ? 'Terdeteksi anomali api/asap atau indeks FFMC ≥ 89.5 (Zona Mudah Menyala). Eksekusi protokol mitigasi darurat sekarang!'
                          : isFireWarning
                          ? 'Bahan bakar halus serasah mengalami pengeringan aktif (FFMC 82–89). Api mudah menyebar jika terkena percikan.'
                          : 'Kondisi kelembapan bahan bakar halus (FFMC < 82) dan prediksi model AI berada dalam zona aman.'}
                      </p>

                      <div className="my-2.5 px-2.5 py-1.5 rounded-lg bg-white/70 border border-black/5 text-[11px] font-mono text-[#2C2922] flex items-center justify-between">
                        <span>Status: FFMC {currentFfmc !== null ? currentFfmc.toFixed(1) : '--'} · Risk: {currentRisk || 'STANDBY'}</span>
                        <span className="font-bold">{isFireAlert ? 'PERLU TINDAKAN' : 'NORMAL'}</span>
                      </div>

                      <div className="space-y-1.5 mt-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#56612E] block">
                          Instruksi Solusi Penanganan:
                        </span>
                        <ul className="space-y-1.5 text-[11px] text-[#2C2922]/90">
                          <li className="flex items-start gap-1.5">
                            <span className="font-bold text-[#56612E] shrink-0">1.</span>
                            <span><strong>Aktivasi Misting Rel L298N:</strong> Nyalakan semprotan air kabut rel ke koordinat anomali panas/api.</span>
                          </li>
                          <li className="flex items-start gap-1.5">
                            <span className="font-bold text-[#56612E] shrink-0">2.</span>
                            <span><strong>Peringatan &amp; Evakuasi:</strong> Bunyikan alarm pos dan evakuasi tim ke arah berlawanan mata angin (<em>upwind</em>).</span>
                          </li>
                          <li className="flex items-start gap-1.5">
                            <span className="font-bold text-[#56612E] shrink-0">3.</span>
                            <span><strong>Pembuatan Sekat Bakar (Firebreak):</strong> Bersihkan serasah kering 15–20 m di perimeter rambatan api.</span>
                          </li>
                          <li className="flex items-start gap-1.5">
                            <span className="font-bold text-[#56612E] shrink-0">4.</span>
                            <span><strong>Eskalasi Posko:</strong> Laporkan telemetri konsol ke posko penjaga hutan dan armada tangki pemadam.</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ---------------- CARD 2: KONDISI SUHU & KELEMBAPAN ---------------- */}
                <div
                  className={`rounded-2xl p-4 sm:p-5 flex flex-col justify-between border transition-all duration-300 ${
                    isMicroclimateHotDry
                      ? 'bg-[#FFFBEB] border-[#FBBF24] shadow-xs ring-1 ring-[#F59E0B]/20'
                      : isMicroclimateColdWet
                      ? 'bg-[#F0F9FF] border-[#7DD3FC] shadow-xs ring-1 ring-[#0284C7]/20'
                      : 'bg-[#F9F8F5] border-[#DCE4E1] shadow-2xs'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-black/10">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-xl flex items-center justify-center text-white shrink-0 ${
                            isMicroclimateHotDry
                              ? 'bg-[#D97706]'
                              : isMicroclimateColdWet
                              ? 'bg-[#0284C7]'
                              : 'bg-[#56612E]'
                          }`}
                        >
                          <ThermometerSun size={15} />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider block text-[#2C2922]/70 font-mono">
                            Domain 2 · Mikroklimat
                          </span>
                          <h4 className="text-sm font-bold text-[#2C2922] font-display">
                            Suhu &amp; Kelembapan Udara
                          </h4>
                        </div>
                      </div>
                      <span
                        className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full font-mono shrink-0 ${
                          isMicroclimateHotDry
                            ? 'bg-[#D97706] text-white'
                            : isMicroclimateColdWet
                            ? 'bg-[#0284C7] text-white'
                            : 'bg-[#56612E] text-white'
                        }`}
                      >
                        {isMicroclimateHotDry
                          ? 'PANAS & KERING'
                          : isMicroclimateColdWet
                          ? 'LEMBAP JENUH'
                          : 'OPTIMAL'}
                      </span>
                    </div>

                    <div className="mt-3 text-xs">
                      <p className="text-[11px] text-[#2C2922]/90 leading-relaxed font-medium">
                        {isMicroclimateHotDry
                          ? 'Suhu udara tinggi (≥ 30°C) atau kelembapan udara rendah (≤ 40%) memicu stres termal dan dehidrasi cepat vegetasi kanopi.'
                          : isMicroclimateColdWet
                          ? 'Kelembapan udara sangat tinggi (≥ 88%) berisiko menimbulkan embun kondensasi dan pertumbuhan jamur patogen daun.'
                          : 'Temperatur dan kelembapan berada pada kesetimbangan ideal fotosintesis (20–28°C, RH 50–80%).'}
                      </p>

                      <div className="my-2.5 px-2.5 py-1.5 rounded-lg bg-white/70 border border-black/5 text-[11px] font-mono text-[#2C2922] flex items-center justify-between">
                        <span>Kondisi: {currentTemp !== null ? `${currentTemp.toFixed(1)}°C` : '--'} · RH {currentRh !== null ? `${currentRh.toFixed(0)}%` : '--'}</span>
                        <span className="font-bold">{isMicroclimateHotDry || isMicroclimateColdWet ? 'ADAPTASI MIKRO' : 'STABIL'}</span>
                      </div>

                      <div className="space-y-1.5 mt-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#56612E] block">
                          Instruksi Solusi Penanganan:
                        </span>
                        <ul className="space-y-1.5 text-[11px] text-[#2C2922]/90">
                          {isMicroclimateHotDry ? (
                            <>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#D97706] shrink-0">1.</span>
                                <span><strong>Pengkabutan Kanopi (Misting):</strong> Semprotkan kabut air mikro 10–15 menit untuk meredam suhu 3–5°C dan meningkatkan kelembapan.</span>
                              </li>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#D97706] shrink-0">2.</span>
                                <span><strong>Hindari Jam Terik Ekstrem:</strong> Tunda aktivitas patroli fisik berat di lapangan antara pukul 11:00 – 15:00 WIB.</span>
                              </li>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#D97706] shrink-0">3.</span>
                                <span><strong>Pemasangan Naungan Sementara:</strong> Berikan naungan parsial pada bibit muda di persemaian agar terhindar dari stres respirasi.</span>
                              </li>
                            </>
                          ) : isMicroclimateColdWet ? (
                            <>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#0284C7] shrink-0">1.</span>
                                <span><strong>Pencegahan Jamur Daun:</strong> Waspadai spora embun tepung (<em>powdery mildew</em>) dan karat daun saat daun basah berkepanjangan.</span>
                              </li>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#0284C7] shrink-0">2.</span>
                                <span><strong>Hentikan Misting Buatan:</strong> Matikan suplai pengkabutan kanopi hingga kelembapan udara turun di bawah 80%.</span>
                              </li>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#0284C7] shrink-0">3.</span>
                                <span><strong>Aerasi Tajuk Bawah:</strong> Pangkas ranting bawah yang terlalu rapat agar udara lembap dapat tersirkulasi keluar.</span>
                              </li>
                            </>
                          ) : (
                            <>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#56612E] shrink-0">1.</span>
                                <span><strong>Pertahankan Ventilasi Alami:</strong> Mikroklimat alami seimbang, tidak diperlukan intervensi buatan.</span>
                              </li>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#56612E] shrink-0">2.</span>
                                <span><strong>Pantau Siklus Diurnal:</strong> Amati tren grafik multi-sensor harian untuk mendeteksi anomali cuaca mikro mendadak.</span>
                              </li>
                            </>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ---------------- CARD 3: KONDISI TANAH KERING ATAU BASAH ---------------- */}
                <div
                  className={`rounded-2xl p-4 sm:p-5 flex flex-col justify-between border transition-all duration-300 ${
                    isSoilDry
                      ? 'bg-[#FEF3C7] border-[#FCD34D] shadow-xs ring-1 ring-[#D97706]/20'
                      : isSoilWet
                      ? 'bg-[#EFF6FF] border-[#93C5FD] shadow-xs ring-1 ring-[#0284C7]/20'
                      : 'bg-[#F9F8F5] border-[#DCE4E1] shadow-2xs'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-black/10">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-xl flex items-center justify-center text-white shrink-0 ${
                            isSoilDry ? 'bg-[#D97706]' : isSoilWet ? 'bg-[#0284C7]' : 'bg-[#56612E]'
                          }`}
                        >
                          <Sprout size={15} />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider block text-[#2C2922]/70 font-mono">
                            Domain 3 · Hidrasi Tanah
                          </span>
                          <h4 className="text-sm font-bold text-[#2C2922] font-display">
                            Kondisi Tanah &amp; Irigasi
                          </h4>
                        </div>
                      </div>
                      <span
                        className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full font-mono shrink-0 ${
                          isSoilDry
                            ? 'bg-[#D97706] text-white'
                            : isSoilWet
                            ? 'bg-[#0284C7] text-white'
                            : 'bg-[#56612E] text-white'
                        }`}
                      >
                        {isSoilDry ? 'TANAH KERING' : isSoilWet ? 'BASAH JENUH' : 'OPTIMAL'}
                      </span>
                    </div>

                    <div className="mt-3 text-xs">
                      <p className="text-[11px] text-[#2C2922]/90 leading-relaxed font-medium">
                        {isSoilDry
                          ? 'Kelembapan tanah < 30%, berada di bawah kapasitas lapang dan mendekati titik layu tanaman (wilting point). Lakukan irigasi!'
                          : isSoilWet
                          ? 'Kelembapan tanah > 75%, terjadi kejenuhan air berisiko anoksia (kekurangan oksigen akar) dan busuk akar (root rot).'
                          : 'Kelembapan tanah berada pada kapasitas lapang optimal (35% – 70%) untuk penyerapan air dan hara botani.'}
                      </p>

                      <div className="my-2.5 px-2.5 py-1.5 rounded-lg bg-white/70 border border-black/5 text-[11px] font-mono text-[#2C2922] flex items-center justify-between">
                        <span>Sensor v1.2: {currentSoil !== null ? `${currentSoil.toFixed(1)}%` : '--'}</span>
                        <span className="font-bold">{isSoilDry ? 'IRIGASI DIPERLUKAN' : isSoilWet ? 'DRAINASE DIPERLUKAN' : 'NORMAL'}</span>
                      </div>

                      <div className="space-y-1.5 mt-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#56612E] block">
                          Instruksi Solusi Penanganan:
                        </span>
                        <ul className="space-y-1.5 text-[11px] text-[#2C2922]/90">
                          {isSoilDry ? (
                            <>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#D97706] shrink-0">1.</span>
                                <span><strong>Irigasi Tetes Segera (Drip Irrigation):</strong> Alirkan air langsung ke zona perakaran dalam untuk mengembalikan kelembapan ke 50–60%.</span>
                              </li>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#D97706] shrink-0">2.</span>
                                <span><strong>Aplikasi Mulsa Organik:</strong> Tebarkan serasah daun atau jerami di atas permukaan tanah guna menahan laju evaporasi.</span>
                              </li>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#D97706] shrink-0">3.</span>
                                <span><strong>Jadwal Penyiraman Pagi/Sore:</strong> Lakukan pengairan sebelum pukul 08:00 atau setelah 17:00 untuk penyerapan maksimal.</span>
                              </li>
                            </>
                          ) : isSoilWet ? (
                            <>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#0284C7] shrink-0">1.</span>
                                <span><strong>Hentikan Suplai Irigasi Otomatis:</strong> Kunci seluruh katup solenoid air (<em>fail-closed</em>) dan tunda siklus pengairan berikutnya.</span>
                              </li>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#0284C7] shrink-0">2.</span>
                                <span><strong>Buka Saluran Parit &amp; Rorak:</strong> Bersihkan endapan tanah pada parit drainase agar genangan air permukaan lekas terbuang.</span>
                              </li>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#0284C7] shrink-0">3.</span>
                                <span><strong>Aerasi Media Tanah:</strong> Berikan jeda pengeringan tanah alami untuk mencegah pembusukan akar dan memulihkan sirkulasi O2.</span>
                              </li>
                            </>
                          ) : (
                            <>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#56612E] shrink-0">1.</span>
                                <span><strong>Pertahankan Siklus Irigasi Terjadwal:</strong> Lanjutkan pemberian air dengan debit reguler sesuai kebutuhan jenis tanaman.</span>
                              </li>
                              <li className="flex items-start gap-1.5">
                                <span className="font-bold text-[#56612E] shrink-0">2.</span>
                                <span><strong>Verifikasi Kedalaman Probe:</strong> Pastikan sensor kelembapan tanah tertancap stabil pada kedalaman 10–15 cm zona rizosfer.</span>
                              </li>
                            </>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      {/* 24-Hour Statistical Summary Rollup */}
      <section className="flora-card p-5 sm:p-6 mt-8 shadow-xs">
        <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
          <div>
            <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block font-mono">
              Aggregation Archive · Montesinho Reference
            </span>
            <h2 className="text-base font-bold text-[#263A35] font-display mt-0.5">
              24-Hour Statistical Summary &amp; Dataset Rollup
            </h2>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#EFF3EF] text-[#263A35] border border-[#A6B49E] shadow-2xs">
            {visiblePoints.length} Data Points · 517 FWI Reference
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors p-3 rounded-xl shadow-2xs flex flex-col justify-between">
            <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block truncate">
              Session Avg Temp
            </span>
            <span className="text-sm font-bold font-tabular text-[#263A35] block mt-1">
              {avgTemp.toFixed(1)}°C
            </span>
          </div>
          <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors p-3 rounded-xl shadow-2xs flex flex-col justify-between">
            <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block truncate">
              Session Avg RH
            </span>
            <span className="text-sm font-bold font-tabular text-[#263A35] block mt-1">
              {avgHum.toFixed(1)}%
            </span>
          </div>
          <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors p-3 rounded-xl shadow-2xs flex flex-col justify-between">
            <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block truncate">
              Session Avg FFMC
            </span>
            <span className="text-sm font-bold font-tabular text-[#263A35] block mt-1">
              {avgFfmc.toFixed(1)}
            </span>
          </div>
          <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors p-3 rounded-xl shadow-2xs flex flex-col justify-between">
            <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block truncate">
              Session Avg Soil
            </span>
            <span className="text-sm font-bold font-tabular text-[#263A35] block mt-1">
              {avgSoil.toFixed(1)}%
            </span>
          </div>
          <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors p-3 rounded-xl shadow-2xs flex flex-col justify-between">
            <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block truncate">
              Dominant Vision
            </span>
            <span className="text-sm font-bold font-display text-[#263A35] block mt-1 truncate">
              {latestRec?.vision_prediction || 'Healthy Canopy'}
            </span>
          </div>
          <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors p-3 rounded-xl shadow-2xs flex flex-col justify-between">
            <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block truncate">
              Dominant Risk
            </span>
            <span className="text-sm font-bold font-tabular text-[#4E635E] block mt-1">
              {latestRec?.sensor_risk || 'LOW'}
            </span>
          </div>
        </div>
      </section>
    </>
  );
});
