import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeFwiComponents,
  evaluateFloraSensorModel,
  evaluateModelHazard,
} from './lib/aiModels';
import { FloraSplash } from './components/FloraSplash';
import { FloraKaggleSection } from './components/FloraKaggleSection';
import { FloraHistoryCanvas, type TelemetryHistoryPoint } from './components/FloraHistoryCanvas';
import { FloraBmkgCard } from './components/FloraBmkgCard';
import { Model1HazardView } from './components/Model1HazardView';
import { Model2BotanicalView } from './components/Model2BotanicalView';
import {
  Camera,
  Upload,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Flame,
  Leaf,
  Video,
  VideoOff,
  Sparkles,
  Info,
  LayoutGrid,
  Layers,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/components/ui/navigation-menu';
import type {
  CameraStatus,
  CaptureSource,
  InferenceStatus,
  LeafDiseasePredictionData,
  VisionDomain,
  WildfirePredictionData,
} from './types/vision';
import {
  captureFrameFromVideo,
  startCameraStream,
  stopMediaStream,
  validateImageFile,
} from './lib/cameraCapture';
import { predictWildfireImage } from './lib/wildfireService';
import { isLeafDiseaseApiConfigured, predictLeafDiseaseImage } from './lib/leafDiseaseService';
import {
  subscribeGatewayTelemetry,
  fetchLatestCameraFrame,
  checkGatewayHealth,
  type GatewayTelemetryPayload,
  type GatewayConnectionStatus,
  type GatewayHealthResponse,
} from './lib/gatewayService';
import {
  formatSensorValue,
  getSensorStatusLabel,
  getDeviceConnectivityStatus,
} from './lib/sensorDisplay';

const SECTION_IDS = [
  'overview',
  'bmkg',
  'monitoring',
  'analysis',
  'benchmarks',
  'cameraCapture',
  'device-control',
  'treatment',
  'history',
  'devices',
] as const;

interface WateringLogEvent {
  id: number;
  timestamp: string;
  soilBefore: number;
  note: string;
}

// Leaf component for clock to isolate 1-second interval re-renders from the dashboard tree
const LiveClockBadge: React.FC<{ isGlassy: boolean }> = React.memo(({ isGlassy }) => {
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
  useEffect(() => {
    const timer = setInterval(() => {
      setClockText(
        new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span
      className={`hidden sm:inline-block px-3 py-1.5 rounded-xl border text-xs font-medium text-[#F1D2A1] font-tabular shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-sm cursor-default select-none ${
        isGlassy
          ? 'bg-[#5E682B]/85 backdrop-blur-md border-[#869440]'
          : 'bg-[#5E682B] border-[#869440]'
      }`}
    >
      {clockText}
    </span>
  );
});

export type ActiveDashboardTab = 'overview' | 'model_hazard' | 'model_botanical' | 'model_vision' | 'all';

export const App: React.FC = () => {
  // Boot splash state ('boot' shows the 3D Welcome screen just like flora-six-zeta.vercel.app)
  const [viewMode, setViewMode] = useState<'boot' | 'dashboard'>('boot');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('overview');
  const [currentTab, setCurrentTab] = useState<ActiveDashboardTab>('overview');
  const [isDashboard1Open, setIsDashboard1Open] = useState(true);
  const isDashboard1Active = currentTab === 'overview' || currentTab === 'model_hazard' || currentTab === 'model_botanical' || currentTab === 'model_vision';
  const [isScrolled, setIsScrolled] = useState(() => typeof window !== 'undefined' && window.scrollY > 0);
  const headerRef = useRef<HTMLDivElement | null>(null);

  // Live telemetry parameters initialized to null (strict live-only data integrity)
  const [temp, setTemp] = useState<number | null>(null);
  const [rh, setRh] = useState<number | null>(null);
  const [wind, setWind] = useState<number | null>(null);
  const [rain, setRain] = useState<number | null>(null);
  const [ffmc, setFfmc] = useState<number | null>(null);
  const [dmc, setDmc] = useState<number | null>(null);
  const [dc, setDc] = useState<number | null>(null);
  const [isi, setIsi] = useState<number | null>(null);
  const [soilMoisture, setSoilMoisture] = useState<number | null>(null);

  // Vision & Camera state
  const [visionPrediction, setVisionPrediction] = useState<string>('Standby / Belum Dianalisis');
  const [visionProbs, setVisionProbs] = useState({ healthy: 0, smoke: 0, fire: 0 });
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastCaptureTime, setLastCaptureTime] = useState<string | null>(null);

  // Phase 2B: Real Camera, Upload & Dual-Domain Inference State
  const [visionDomain, setVisionDomain] = useState<VisionDomain>('wildfire');
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [captureSource, setCaptureSource] = useState<CaptureSource>('none');
  const [capturedBlob, setCapturedBlob] = useState<Blob | File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [inferenceStatus, setInferenceStatus] = useState<InferenceStatus>('idle');
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [wildfireResult, setWildfireResult] = useState<WildfirePredictionData | null>(null);
  const [leafResult, setLeafResult] = useState<LeafDiseasePredictionData | null>(null);
  const [leafPrediction, setLeafPrediction] = useState<string | null>(null);
  const [leafProbs, setLeafProbs] = useState({ healthy: 0, powdery: 0, rust: 0 });
  const [isVideoReady, setIsVideoReady] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeInferenceAbortRef = useRef<AbortController | null>(null);


  // Actuator / Rail L298N state
  const [movementStatus, setMovementStatus] = useState<
    'idle' | 'left_command_sent' | 'right_command_sent' | 'stop_command_sent' | 'capture_command_sent'
  >('idle');
  const [lastCommand, setLastCommand] = useState<string | null>('C');
  const [limitLeft, setLimitLeft] = useState<boolean>(false);
  const [limitRight, setLimitRight] = useState<boolean>(false);
  const railPositionMm = limitLeft ? 0 : limitRight ? 1200 : null;

  // Watering / Suppression log state initialized empty (live session logs only)
  const [wateringEvents, setWateringEvents] = useState<WateringLogEvent[]>([]);

  // Toast state
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({
    message: '',
    visible: false,
  });

  const showToast = useCallback((msg: string) => {
    setToast({ message: msg, visible: true });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 3200);
  }, []);


  // Backend Gateway SSE Telemetry State (/api/telemetry/stream)
  const [gatewayStatus, setGatewayStatus] = useState<GatewayConnectionStatus>('connecting');
  const [isLiveTelemetry, setIsLiveTelemetry] = useState<boolean>(false);
  const [isTelemetryStale, setIsTelemetryStale] = useState<boolean>(false);
  const [lastLiveTelemetryTime, setLastLiveTelemetryTime] = useState<Date | null>(null);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealthResponse | null>(null);
  const [, setGatewayUptimeSeconds] = useState<number | null>(null);
  const [, setSoilRaw] = useState<number | null>(null);
  const [gasPpm, setGasPpm] = useState<number | null>(null);
  const [mq135Raw, setMq135Raw] = useState<number | null>(null);
  const [flameDetected, setFlameDetected] = useState<number | null>(null);
  const [, setFlameRaw] = useState<number | null>(null);
  const [motorDriverInfo, setMotorDriverInfo] = useState<string>('L298N OUT3 & OUT4');
  const [activeNodeId] = useState<string | null>(null);
  const [edgePrediction, setEdgePrediction] = useState<string | null>(null);
  const [edgeConfidence, setEdgeConfidence] = useState<number | null>(null);

  // Gateway Camera Frame State (/api/vision/latest-frame.jpg)
  const [gatewayFrameMeta, setGatewayFrameMeta] = useState<{
    byteLength: number;
    receivedAt: number | null;
    ageSeconds: number | null;
    isStale: boolean;
  } | null>(null);
  const [isFetchingGatewayFrame, setIsFetchingGatewayFrame] = useState<boolean>(false);
  const [gatewayFrameStatus, setGatewayFrameStatus] = useState<'idle' | 'standby' | 'ready' | 'error'>('idle');
  const isFetchingFrameRef = useRef(false);

  // Stable references to decouple effect lifecycle from reactive sensor updates
  const lastTelemetryTimestampRef = useRef<number | null>(null);
  const sensorValuesRef = useRef<{
    temp: number | null;
    rh: number | null;
    wind: number | null;
    rain: number | null;
    soilMoisture: number | null;
  }>({ temp, rh, wind, rain, soilMoisture });
  useEffect(() => {
    sensorValuesRef.current = { temp, rh, wind, rain, soilMoisture };
  });

  // Fetch latest camera JPEG frame from backend cache (/api/vision/latest-frame.jpg)
  const handleFetchGatewayFrame = useCallback(async (manual = false) => {
    if (isFetchingFrameRef.current) return;
    isFetchingFrameRef.current = true;
    setIsFetchingGatewayFrame(true);

    try {
      const res = await fetchLatestCameraFrame();
      if (res.hasFrame && res.frame) {
        const newUrl = URL.createObjectURL(res.frame.blob);
        setGatewayFrameMeta({
          byteLength: res.frame.byteLength,
          receivedAt: res.frame.receivedAt,
          ageSeconds: res.frame.ageSeconds,
          isStale: res.frame.isStale,
        });
        setGatewayFrameStatus('ready');
        setLastCaptureTime(new Date(res.frame.receivedAt || Date.now()).toISOString());

        // Make frame available for AI visual inference (previewUrl effect handles single-owner lifecycle)
        setCapturedBlob(res.frame.blob);
        setPreviewUrl(newUrl);
        setCaptureSource('gateway');
        setCameraStatus('captured');
        setInferenceStatus('idle');
        setInferenceError(null);

        if (manual) {
          showToast(`Frame gateway berhasil dimuat (${(res.frame.byteLength / 1024).toFixed(1)} KB${res.frame.isStale ? ' · STALE' : ''})`);
        }
      } else {
        setGatewayFrameStatus('standby');
        if (manual) {
          showToast('Belum ada frame kamera di cache gateway (HTTP 204 Standby). Menunggu transmisi ESP32-CAM.');
        }
      }
    } catch (err: unknown) {
      setGatewayFrameStatus('error');
      if (manual) {
        const msg = err instanceof Error ? err.message : 'Gagal mengambil frame dari gateway';
        showToast(msg);
      }
    } finally {
      isFetchingFrameRef.current = false;
      setIsFetchingGatewayFrame(false);
    }
  }, [showToast]);

  const fetchGatewayFrameRef = useRef(handleFetchGatewayFrame);
  useEffect(() => {
    fetchGatewayFrameRef.current = handleFetchGatewayFrame;
  });

  // Subscribe to read-only Backend Gateway Server-Sent Events (/api/telemetry/stream)
  // Stable lifecycle: does NOT reconnect on sensor state updates (F-01 fix)
  useEffect(() => {
    const unsubscribe = subscribeGatewayTelemetry({
      onTelemetry: (payload: GatewayTelemetryPayload) => {
        const now = Date.now();
        lastTelemetryTimestampRef.current = now;
        setLastLiveTelemetryTime(new Date(now));
        setIsLiveTelemetry(true);
        setIsTelemetryStale(payload.freshness === 'STALE');

        const newTemp = typeof payload.temp === 'number' && Number.isFinite(payload.temp) ? Number(payload.temp.toFixed(1)) : null;
        const newRh = typeof payload.rh === 'number' && Number.isFinite(payload.rh) ? Number(payload.rh.toFixed(1)) : null;
        const newSoil = typeof payload.soilMoisture === 'number' && Number.isFinite(payload.soilMoisture) ? Number(payload.soilMoisture.toFixed(1)) : null;
        const newRain = typeof payload.rain === 'number' && Number.isFinite(payload.rain) ? Number(payload.rain.toFixed(2)) : null;
        const newWind = typeof payload.wind === 'number' && Number.isFinite(payload.wind) ? Number(payload.wind.toFixed(1)) : null;

        if (newTemp !== null) setTemp(newTemp);
        if (newRh !== null) setRh(newRh);
        if (newSoil !== null) setSoilMoisture(newSoil);
        if (typeof payload.soilRaw === 'number' && Number.isFinite(payload.soilRaw)) {
          setSoilRaw(payload.soilRaw);
        }
        setRain(newRain);
        setWind(newWind);
        if (typeof payload.gasPpm === 'number' && Number.isFinite(payload.gasPpm)) {
          setGasPpm(Math.round(payload.gasPpm));
        } else {
          setGasPpm(null);
        }
        if (typeof payload.mq135Raw === 'number' && Number.isFinite(payload.mq135Raw)) {
          setMq135Raw(Math.round(payload.mq135Raw));
        } else {
          setMq135Raw(null);
        }
        if (typeof payload.flameDetected === 'number' && Number.isFinite(payload.flameDetected)) {
          setFlameDetected(payload.flameDetected);
        } else {
          setFlameDetected(null);
        }
        if (typeof payload.flameRaw === 'number' && Number.isFinite(payload.flameRaw)) {
          setFlameRaw(Math.round(payload.flameRaw));
        } else {
          setFlameRaw(null);
        }
        if (typeof payload.motorDriver === 'string' && payload.motorDriver.trim() !== '') {
          setMotorDriverInfo(payload.motorDriver.trim());
        }
        if (typeof payload.uptimeSeconds === 'number' && Number.isFinite(payload.uptimeSeconds)) {
          setGatewayUptimeSeconds(payload.uptimeSeconds);
        }

        if (typeof payload.limitLeft === 'boolean') setLimitLeft(payload.limitLeft);
        if (typeof payload.limitRight === 'boolean') setLimitRight(payload.limitRight);

        if (typeof payload.motorState === 'string') {
          if (payload.motorState === 'LEFT') setMovementStatus('left_command_sent');
          else if (payload.motorState === 'RIGHT') setMovementStatus('right_command_sent');
          else if (payload.motorState === 'STOPPED') setMovementStatus('stop_command_sent');
        }

        // Dynamically compute FWI components using latest values without stale closures or reconnecting SSE
        const currentSensors = sensorValuesRef.current;
        const currentTemp = newTemp !== null ? newTemp : currentSensors.temp;
        const currentRh = newRh !== null ? newRh : currentSensors.rh;
        const currentRain = newRain;
        const currentSoil = newSoil !== null ? newSoil : currentSensors.soilMoisture;

        if (currentTemp !== null && currentRh !== null && newWind !== null && currentRain !== null) {
          const fwi = computeFwiComponents({
            temp: currentTemp,
            rh: currentRh,
            wind: newWind,
            rain: currentRain,
            soilMoisture: currentSoil !== null ? currentSoil : undefined,
          });
          setFfmc(Number(fwi.ffmc.toFixed(1)));
          setDmc(Number(fwi.dmc.toFixed(1)));
          setDc(Number(fwi.dc.toFixed(1)));
          setIsi(Number(fwi.isi.toFixed(1)));

          // Record genuine incoming telemetry point to history
          const evalRes = evaluateModelHazard({
            temp: currentTemp,
            rh: currentRh,
            wind: newWind,
            rain: currentRain,
            ffmc: fwi.ffmc,
            dmc: fwi.dmc,
            dc: fwi.dc,
            isi: fwi.isi,
          });
          if (evalRes && currentSoil !== null) {
            const genuinePoint: TelemetryHistoryPoint = {
              timestamp: new Date().toISOString(),
              temperature: currentTemp,
              humidity: currentRh,
              soil_moisture: currentSoil,
              wind: newWind,
              rain: currentRain,
              ffmc: Number(fwi.ffmc.toFixed(1)),
              dmc: Number(fwi.dmc.toFixed(1)),
              dc: Number(fwi.dc.toFixed(1)),
              isi: Number(fwi.isi.toFixed(1)),
              sensor_risk: evalRes.riskLevel,
              sensor_confidence: evalRes.confidence,
              vision_prediction: typeof payload.visionPrediction === 'string' ? payload.visionPrediction : 'No Detection',
            };
            setHistory((prev) => [...prev.slice(-49), genuinePoint]);
          }
        } else {
          setFfmc(null);
          setDmc(null);
          setDc(null);
          setIsi(null);
        }

        // Record genuine edge AI predictions without overwriting cloud vision probability distributions
        if (payload.visionPrediction) {
          setEdgePrediction(payload.visionPrediction);
          setEdgeConfidence(payload.visionConfidence);
        }

        // Trigger camera frame fetch when backend signals a new image frame is ready
        if (payload.imageReady === true) {
          fetchGatewayFrameRef.current(false);
        }
      },
      onStatusChange: (status) => {
        setGatewayStatus(status);
        if (status === 'error' || status === 'closed') {
          setIsLiveTelemetry(false);
          setIsTelemetryStale(false);
          setTemp(null);
          setRh(null);
          setWind(null);
          setRain(null);
          setFfmc(null);
          setDmc(null);
          setDc(null);
          setIsi(null);
          setSoilMoisture(null);
          setSoilRaw(null);
          setGasPpm(null);
          setFlameDetected(null);
          setEdgePrediction(null);
          setEdgeConfidence(null);
        }
      },
      onError: () => {
        setGatewayStatus('error');
        setIsLiveTelemetry(false);
        setIsTelemetryStale(false);
        setTemp(null);
        setRh(null);
        setWind(null);
        setRain(null);
        setFfmc(null);
        setDmc(null);
        setDc(null);
        setIsi(null);
        setSoilMoisture(null);
        setSoilRaw(null);
        setGasPpm(null);
        setFlameDetected(null);
        setEdgePrediction(null);
        setEdgeConfidence(null);
      },
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Periodic Telemetry Freshness Watchdog (10s threshold) (F-02 fix)
  useEffect(() => {
    const timer = setInterval(() => {
      const lastTime = lastTelemetryTimestampRef.current;
      if (!lastTime) return;
      const age = Date.now() - lastTime;
      if (age > 10000) {
        setIsTelemetryStale((prev) => (prev ? prev : true));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Periodic Gateway Health Check (/health) (F-03 fix)
  useEffect(() => {
    let active = true;
    let abortController: AbortController | null = null;

    const performHealthCheck = async () => {
      abortController?.abort();
      abortController = new AbortController();

      try {
        const health = await checkGatewayHealth({ signal: abortController.signal });
        if (active) {
          setGatewayHealth(health);
          if (typeof health.uptimeSeconds === 'number') {
            setGatewayUptimeSeconds(health.uptimeSeconds);
          }
        }
      } catch (err: unknown) {
        if (active) {
          if (err instanceof Error && err.name === 'AbortError') return;
          setGatewayHealth((prev) => (prev ? { ...prev, mqttConnected: false } : null));
        }
      }
    };

    performHealthCheck();
    const interval = setInterval(performHealthCheck, 15000);

    return () => {
      active = false;
      abortController?.abort();
      clearInterval(interval);
    };
  }, []);

  // Close mobile drawer on Escape key press for keyboard accessibility (WCAG 2.1)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  // Real-time C Header AI Model 1: model_hazard.h (100-Tree Random Forest)
  // Evaluated ONLY when genuine live telemetry is actively connected, fresh, and complete
  const hazardResult = useMemo(
    () => {
      if (!isLiveTelemetry || isTelemetryStale) return null;
      if (
        temp === null ||
        rh === null ||
        wind === null ||
        rain === null ||
        ffmc === null ||
        dmc === null
      ) {
        return null;
      }
      return evaluateModelHazard({
        temp,
        rh,
        wind,
        rain,
        ffmc,
        dmc,
        dc: typeof dc === 'number' && Number.isFinite(dc) ? dc : undefined,
        isi: typeof isi === 'number' && Number.isFinite(isi) ? isi : undefined,
      });
    },
    [isLiveTelemetry, isTelemetryStale, temp, rh, wind, rain, ffmc, dmc, dc, isi]
  );

  // Real-time C Header AI Model 2: grenvis_sensor_model.h (FLORA Neural Network)
  // Evaluated ONLY when genuine live telemetry is actively connected, fresh, and complete
  const floraResult = useMemo(
    () => {
      if (!isLiveTelemetry || isTelemetryStale) return null;
      if (temp === null || rh === null || soilMoisture === null) return null;
      return evaluateFloraSensorModel(temp, rh, soilMoisture);
    },
    [isLiveTelemetry, isTelemetryStale, temp, rh, soilMoisture]
  );

  // Historical telemetry buffer initialized empty (populated solely by genuine telemetry)
  const [history, setHistory] = useState<TelemetryHistoryPoint[]>([]);

  // Push new point into history when genuine inference or telemetry arrives
  const appendSnapshotToHistory = useCallback(
    (
      tVal = temp,
      rhVal = rh,
      soilVal = soilMoisture,
      wVal = wind,
      rVal = rain,
      ffmcVal = ffmc,
      dmcVal = dmc,
      dcVal = dc,
      isiVal = isi,
      visPred = visionPrediction
    ) => {
      if (!isLiveTelemetry || isTelemetryStale) return;
      if (
        tVal === null ||
        rhVal === null ||
        soilVal === null ||
        wVal === null ||
        rVal === null ||
        ffmcVal === null ||
        dmcVal === null
      ) {
        return;
      }
      const res = evaluateModelHazard({
        temp: tVal,
        rh: rhVal,
        wind: wVal,
        rain: rVal,
        ffmc: ffmcVal,
        dmc: dmcVal,
        dc: typeof dcVal === 'number' && Number.isFinite(dcVal) ? dcVal : undefined,
        isi: typeof isiVal === 'number' && Number.isFinite(isiVal) ? isiVal : undefined,
      });
      if (!res) return;
      const pt: TelemetryHistoryPoint = {
        timestamp: new Date().toISOString(),
        temperature: tVal,
        humidity: rhVal,
        soil_moisture: soilVal,
        wind: wVal,
        rain: rVal,
        ffmc: Number(ffmcVal.toFixed(1)),
        dmc: Number(dmcVal.toFixed(1)),
        dc: typeof dcVal === 'number' && Number.isFinite(dcVal) ? Number(dcVal.toFixed(1)) : 0,
        isi: typeof isiVal === 'number' && Number.isFinite(isiVal) ? Number(isiVal.toFixed(1)) : 0,
        sensor_risk: res.riskLevel,
        sensor_confidence: res.confidence,
        vision_prediction: typeof visPred === 'string' ? visPred : 'No Detection',
      };
      setHistory((prev) => [...prev.slice(-49), pt]);
    },
    [isLiveTelemetry, isTelemetryStale, temp, rh, soilMoisture, wind, rain, ffmc, dmc, dc, isi, visionPrediction]
  );

  // Scroll spy for sidebar with requestAnimationFrame throttling to eliminate layout thrashing
  useEffect(() => {
    let ticking = false;
    let rafId = 0;
    const onScroll = () => {
      if (!ticking) {
        rafId = window.requestAnimationFrame(() => {
          setIsScrolled(window.scrollY > 0);
          if (window.scrollY < 80) {
            setActiveSection((prev) => (prev !== SECTION_IDS[0] ? SECTION_IDS[0] : prev));
          } else {
            let current = SECTION_IDS[0] as string;
            for (const id of SECTION_IDS) {
              const el = document.getElementById(id);
              if (el && el.getBoundingClientRect().top <= 160) {
                current = id;
              }
            }
            setActiveSection((prev) => (prev !== current ? current : prev));
          }
          ticking = false;
          rafId = 0;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      ticking = false;
    };
  }, []);

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    setMobileMenuOpen(false);

    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return true;
      }
      return false;
    };

    if (tryScroll()) return;

    // If element is not rendered in current tab (e.g. filtered view), return to overview and poll
    if (currentTab !== 'overview' && currentTab !== 'all') {
      setCurrentTab('overview');
    }

    let attempts = 0;
    const maxAttempts = 15;
    const interval = setInterval(() => {
      attempts++;
      if (tryScroll() || attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 40);
  };

  // Phase 2B.2: Stop active camera stream and abort pending inference strictly on unmount
  useEffect(() => {
    return () => {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      if (activeInferenceAbortRef.current) {
        activeInferenceAbortRef.current.abort();
        activeInferenceAbortRef.current = null;
      }
    };
  }, []);

  // Phase 2B.2: Revoke preview object URL when it changes or on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Phase 2B.2: Synchronize stream attachment when cameraStatus transitions to 'streaming'
  useEffect(() => {
    if (cameraStatus === 'streaming' && videoRef.current && streamRef.current) {
      const video = videoRef.current;
      if (video.srcObject !== streamRef.current) {
        video.srcObject = streamRef.current;
      }
      video.muted = true;
      video.play().catch((playErr: unknown) => {
        if (playErr instanceof DOMException && playErr.name === 'AbortError') return;
        const msg = playErr instanceof Error ? playErr.message : 'Browser memblokir pemutaran otomatis.';
        setInferenceError(`Gagal memutar preview kamera: ${msg}`);
      });
    }
  }, [cameraStatus]);

  // Phase 2B.2: Callback ref to attach stream immediately as soon as the <video> element mounts in DOM
  const setVideoElement = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      if (node.srcObject !== streamRef.current) {
        node.srcObject = streamRef.current;
      }
      node.muted = true;
      node.play().catch((playErr: unknown) => {
        if (playErr instanceof DOMException && playErr.name === 'AbortError') return;
        const msg = playErr instanceof Error ? playErr.message : 'Browser memblokir pemutaran otomatis.';
        setInferenceError(`Gagal memutar preview kamera: ${msg}`);
      });
    }
  }, []);

  // Handle switching domain: clear domain-specific states without mixing results
  const handleDomainChange = (newDomain: VisionDomain) => {
    if (newDomain === visionDomain) return;
    if (activeInferenceAbortRef.current) {
      activeInferenceAbortRef.current.abort();
      activeInferenceAbortRef.current = null;
    }
    setVisionDomain(newDomain);
    setInferenceStatus('idle');
    setInferenceError(null);
    if (newDomain === 'leaf_disease') {
      setLeafResult(null);
      setLeafPrediction(null);
      setLeafProbs({ healthy: 0, powdery: 0, rust: 0 });
    }
  };

  // Start live device camera stream
  const handleStartCamera = async () => {
    setInferenceError(null);
    setIsVideoReady(false);
    setPreviewUrl(null);
    setCapturedBlob(null);
    setCaptureSource('none');

    // Prevent duplicate streams or orphaned tracks
    if (streamRef.current) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraStatus('requesting');

    try {
      const stream = await startCameraStream();
      streamRef.current = stream;
      setCameraStatus('streaming');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.play().catch((playErr: unknown) => {
          if (playErr instanceof DOMException && playErr.name === 'AbortError') return;
          const msg = playErr instanceof Error ? playErr.message : 'Browser memblokir pemutaran otomatis.';
          setInferenceError(`Gagal memutar preview kamera: ${msg}`);
        });
      }
    } catch (err: unknown) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      setIsVideoReady(false);
      const isDenied = err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'PERMISSION_DENIED';
      setCameraStatus(isDenied ? 'permission_denied' : 'device_error');
      const msg = err instanceof Error ? err.message : 'Gagal membuka kamera perangkat.';
      setInferenceError(msg);
      showToast(msg);
    }
  };

  // Stop camera stream
  const handleStopCamera = () => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsVideoReady(false);
    setCameraStatus('idle');
  };

  // Capture frame from active video stream
  const handleCaptureFromVideo = async () => {
    if (!videoRef.current || cameraStatus !== 'streaming') return;
    const v = videoRef.current;
    if (!isVideoReady || v.videoWidth <= 0 || v.videoHeight <= 0) {
      showToast('Kamera sedang mempersiapkan frame, harap tunggu sebentar...');
      return;
    }
    try {
      const blob = await captureFrameFromVideo(v);
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setIsVideoReady(false);
      const url = URL.createObjectURL(blob);
      setCapturedBlob(blob);
      setPreviewUrl(url);
      setCaptureSource('camera');
      setCameraStatus('captured');
      setInferenceStatus('idle');
      setInferenceError(null);
      showToast('Frame foto berhasil diambil dari kamera.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil frame foto.';
      setInferenceError(msg);
      showToast(msg);
    }
  };

  // Handle file upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    handleStopCamera();
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setInferenceError(validation.error || 'File tidak valid.');
      showToast(validation.error || 'File tidak valid.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const url = URL.createObjectURL(file);
    setCapturedBlob(file);
    setPreviewUrl(url);
    setCaptureSource('upload');
    setCameraStatus('captured');
    setInferenceStatus('idle');
    setInferenceError(null);
    showToast(`Gambar dipilih: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
  };

  // Reset / retake photo
  const handleRetake = () => {
    handleStopCamera();
    setPreviewUrl(null);
    setCapturedBlob(null);
    setCaptureSource('none');
    setCameraStatus('idle');
    setInferenceStatus('idle');
    setInferenceError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Run real inference on capturedBlob
  const handleAnalyzeImage = async () => {
    if (!capturedBlob || isCapturing) return;

    setIsCapturing(true);
    setInferenceStatus('analyzing');
    setInferenceError(null);

    const abortController = new AbortController();
    activeInferenceAbortRef.current = abortController;

    if (visionDomain === 'wildfire') {
      const res = await predictWildfireImage(capturedBlob, abortController.signal);
      setIsCapturing(false);
      activeInferenceAbortRef.current = null;

      if (res.success && res.data) {
        setWildfireResult(res.data);
        const labelMap: Record<string, 'Healthy Forest Canopy' | 'Smoke Plume Detected' | 'Active Surface Fire'> = {
          'Non-Fire': 'Healthy Forest Canopy',
          'Smoke': 'Smoke Plume Detected',
          'Fire': 'Active Surface Fire',
        };
        const mappedLabel = labelMap[res.data.predicted_label] || 'Healthy Forest Canopy';
        setVisionPrediction(mappedLabel);
        setVisionProbs({
          healthy: res.data.scores['Non-Fire'] * 100,
          smoke: res.data.scores['Smoke'] * 100,
          fire: res.data.scores['Fire'] * 100,
        });
        const ts = res.data.timestamp || new Date().toISOString();
        setLastCaptureTime(ts);
        appendSnapshotToHistory(temp, rh, soilMoisture, wind, rain, ffmc, dmc, dc, isi, mappedLabel);
        setInferenceStatus('success');
        showToast(`Inferensi Karhutla Sukses: ${res.data.predicted_label} (${res.data.confidence_percentage.toFixed(1)}%)`);
      } else {
        setInferenceStatus('error');
        setInferenceError(res.error || 'Gagal memproses inferensi citra karhutla.');
        showToast(res.error || 'Inferensi gagal.');
      }
    } else {
      // Leaf Disease domain (isolated from wildfire endpoint)
      const res = await predictLeafDiseaseImage(capturedBlob, abortController.signal);
      setIsCapturing(false);
      activeInferenceAbortRef.current = null;

      if (res.success && res.data) {
        setLeafResult(res.data);
        setLeafPrediction(res.data.predicted_label);
        setLeafProbs({
          healthy: (res.data.scores['Healthy'] || 0) * 100,
          powdery: (res.data.scores['Powdery Mildew'] || 0) * 100,
          rust: (res.data.scores['Leaf Rust'] || 0) * 100,
        });
        const ts = res.data.timestamp || new Date().toISOString();
        setLastCaptureTime(ts);
        setInferenceStatus('success');
        showToast(`Diagnosa Daun Sukses: ${res.data.predicted_label}`);
      } else {
        setInferenceStatus('error');
        setInferenceError(res.error || 'Layanan inferensi penyakit daun tidak tersedia.');
        showToast(res.error || 'Layanan daun belum terhubung.');
      }
    }
  };


  // L298N Rail Carriage commands (OUT3 & OUT4) — Fail-Closed Safety Gate
  const handleRailCommand = (cmd: 'L' | 'R' | 'S' | 'C') => {
    setLastCommand(cmd);
    showToast(
      "Kontrol aktuator dinonaktifkan (Fail-Closed Gate). Dashboard beroperasi dalam mode Read-Only via Backend Gateway."
    );
  };

  // Record manual watering / suppression
  const handleRecordWatering = () => {
    const newEvt: WateringLogEvent = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      soilBefore: typeof soilMoisture === 'number' ? soilMoisture : 0,
      note: 'Penyiraman manual & pendinginan zona kanopi tercatat dari konsol',
    };
    setWateringEvents((prev) => [newEvt, ...prev.slice(0, 8)]);
    showToast('Penyiraman dicatat — Log pemeliharaan diperbarui');
  };

  // Dynamic Alert Banner Config
  const alertBanner = useMemo(() => {
    if (!isLiveTelemetry || isTelemetryStale || !hazardResult || !floraResult) {
      return {
        severity: 'STANDBY',
        title: isTelemetryStale ? 'Device Offline · Telemetri Stale' : 'Device Offline · Menunggu Data Telemetri',
        description: 'Konsol siap menerima stream telemetri real time dari backend gateway (/api/telemetry/stream). Model AI model_hazard.h dan grenvis_sensor_model.h akan mengevaluasi risiko segera setelah data sensor aktif diterima.',
        wrapper: 'bg-[#F1F5F3] border-[#DCE4E1] text-[#2C2922]',
        badge: 'bg-[#E5EBE8] text-[#4D6A75] border border-[#DCE4E1]',
        btn: 'bg-[#4E8577] text-white hover:bg-[#3D6E62]',
        actionText: 'Lihat Status Sensor',
        actionTarget: 'monitoring',
      };
    }
    if (hazardResult.riskLevel === 'HIGH') {
      return {
        severity: 'CRITICAL',
        title: `Peringatan Bahaya Kebakaran Tinggi (model_hazard.h: ${hazardResult.confidence.toFixed(1)}% High Risk)`,
        description: `FFMC (${typeof ffmc === 'number' ? ffmc.toFixed(1) : '--'}) dan DMC (${typeof dmc === 'number' ? dmc.toFixed(1) : '--'}) berada di zona penyalaan aktif (Prediksi Kaggle: '${hazardResult.kaggleBinaryPrediction}'). Segera periksa kamera kanopi dan aktifkan protokol mitigasi.`,
        wrapper: 'bg-[#FEEAEA] border-[#FCCECE] text-[#961C1C]',
        badge: 'bg-[#FCCECE] text-[#961C1C]',
        btn: 'bg-[#961C1C] text-white hover:bg-[#7D1515]',
        actionText: 'Lihat Dataset & SOP',
        actionTarget: 'benchmarks',
      };
    }
    if (hazardResult.riskLevel === 'MODERATE' || floraResult.sensorRisk === 'Moderate') {
      return {
        severity: 'WARNING',
        title: `Status Waspada Mikroklimat & Serasah (Confidence: ${hazardResult.confidence.toFixed(1)}%)`,
        description: `Kelembapan bahan bakar halus FFMC = ${typeof ffmc === 'number' ? ffmc.toFixed(1) : '--'} dan kelembapan tanah = ${typeof soilMoisture === 'number' ? soilMoisture.toFixed(1) : '--'}%. Pantau tren suhu (${typeof temp === 'number' ? temp.toFixed(1) : '--'}°C) dan kelembapan udara (${typeof rh === 'number' ? rh.toFixed(0) : '--'}%).`,
        wrapper: 'bg-[#FEF7E8] border-[#FDE3B5] text-[#8A570C]',
        badge: 'bg-[#FDE3B5] text-[#8A570C]',
        btn: 'bg-[#8A570C] text-white hover:bg-[#704508]',
        actionText: 'Analisis Risiko',
        actionTarget: 'analysis',
      };
    }
    return {
      severity: 'NORMAL',
      title: `Kondisi Hutan & Mikroklimat Kanopi Optimal (Low Risk: ${hazardResult.lowProbability.toFixed(1)}%)`,
      description: `Seluruh parameter telemetri berada dalam batas aman Montesinho (FFMC: ${typeof ffmc === 'number' ? ffmc.toFixed(1) : '--'}, Soil: ${typeof soilMoisture === 'number' ? soilMoisture.toFixed(1) : '--'}%, Prediksi Kaggle: 'safe').`,
      wrapper: 'bg-[#EFF3EF] border-[#A6B49E] text-[#263A35]',
      badge: 'bg-[#A6B49E]/30 text-[#263A35] border border-[#A6B49E]',
      btn: 'bg-[#4E635E] text-white hover:bg-[#3D4F4B]',
      actionText: 'Lihat Telemetri',
      actionTarget: 'monitoring',
    };
  }, [isLiveTelemetry, isTelemetryStale, hazardResult, floraResult, ffmc, dmc, soilMoisture, temp, rh]);

  const navItems = useMemo(
    () => [
      { id: 'overview', label: 'Overview Status', badge: hazardResult ? hazardResult.riskLevel : undefined },
      { id: 'bmkg', label: 'BMKG Macro Weather', badge: 'BMKG' },
      { id: 'monitoring', label: 'Live Sensors (FWI & ADC)' },
      { id: 'analysis', label: 'AI Model Analysis (.h)' },
      { id: 'benchmarks', label: 'Kaggle Dataset Information', badge: 'AI.H' },
      { id: 'cameraCapture', label: 'ESP32-CAM Vision' },
      { id: 'device-control', label: 'L298N Rail Control' },
      { id: 'treatment', label: 'Mitigation & Irrigation' },
      { id: 'history', label: 'Historical Trends' },
      { id: 'devices', label: 'Hardware Topology' },
    ],
    [hazardResult]
  );

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col justify-between h-full p-4 select-none">
      {/* Brand Box */}
      <div className="flex items-center justify-between pb-3.5 mb-3 border-b border-[#5E682B] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#5E682B] border border-[#869440] flex items-center justify-center shadow-xs shrink-0 p-1 overflow-hidden">
            <img
              src="/agrapatha-logo.png"
              alt="Logo AGRAPATHA"
              className="w-full h-full object-contain drop-shadow-sm"
            />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-white tracking-wider uppercase block font-display truncate">
              AGRAPATHA
            </span>
            <span className="text-[10px] text-[#F1D2A1]/90 block truncate font-medium">
              Edge AI Forest &amp; Botanical
            </span>
          </div>
        </div>
        {isMobile && (
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="text-[#F1D2A1] hover:text-white w-9 h-9 flex items-center justify-center rounded-lg text-base shrink-0 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#F1D2A1]"
            aria-label="Tutup navigasi"
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      {/* Middle Scrollable Section */}
      <div className="flex-1 overflow-y-auto min-h-0 flora-sidebar-scroll pr-1 space-y-5">
        {/* Primary Dashboards & Models */}
        <nav aria-label="Primary Dashboards &amp; Models" className="space-y-1">
          <span className="px-2.5 text-[10px] font-bold uppercase tracking-widest text-[#F1D2A1]/80 block mb-2">
            Primary Views &amp; Models
          </span>

          {/* Dashboard 1 with Collapsible Sub-Menus */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => {
                setIsDashboard1Open((prev) => !prev);
                if (!isDashboard1Open && currentTab === 'all') {
                  setCurrentTab('overview');
                }
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#F1D2A1] border ${
                isDashboard1Active
                  ? 'bg-[#5E682B] text-white shadow-xs border-[#869440]'
                  : 'text-[#F1D2A1]/90 border-transparent hover:bg-[#5E682B]/60 hover:text-white'
              }`}
              aria-expanded={isDashboard1Open}
              aria-label="Toggle Dashboard 1 Sub Menu"
            >
              <span className="flex items-center gap-2 truncate">
                <LayoutGrid size={14} className="shrink-0 text-[#F1D2A1]" />
                <span className="truncate">Dashboard 1</span>
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-[#EAD39D] text-[#2C2922] border border-[#D6BC7C] font-mono">
                  3-MODEL
                </span>
                <ChevronDown
                  size={14}
                  className={`text-[#F1D2A1] transition-transform duration-200 ${
                    isDashboard1Open ? 'rotate-0' : '-rotate-90'
                  }`}
                />
              </div>
            </button>

            {/* Sub Menu Items: Overview, Model 1, Model 2, Model 3 */}
            {isDashboard1Open && (
              <div className="ml-3 pl-2.5 border-l-2 border-[#5E682B] space-y-1 pt-1 pb-1 transition-all">
                {/* Sub Menu 0: Overview */}
                <button
                  type="button"
                  onClick={() => {
                    setCurrentTab('overview');
                    if (isMobile) setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#F1D2A1] border ${
                    currentTab === 'overview'
                      ? 'bg-[#5E682B] text-white shadow-xs font-bold border-[#869440]'
                      : 'text-[#F1D2A1]/85 border-transparent hover:bg-[#5E682B]/60 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#F1D2A1] shadow-[0_0_6px_#F1D2A1]" />
                    <span className="truncate">Overview (Ringkasan)</span>
                  </span>
                  <span className="text-[8px] font-mono uppercase px-1 py-0.5 rounded bg-[#2C2922] text-[#F1D2A1]">
                    ALL
                  </span>
                </button>

                {/* Sub Menu 1: Model 1 Forest Fire */}
                <button
                  type="button"
                  onClick={() => {
                    setCurrentTab('model_hazard');
                    if (isMobile) setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#F1D2A1] border ${
                    currentTab === 'model_hazard'
                      ? 'bg-[#5E682B] text-white shadow-xs font-bold border-l-2 border-l-[#DC2626] border-y-[#869440] border-r-[#869440]'
                      : 'text-[#F1D2A1]/85 border-transparent hover:bg-[#5E682B]/60 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Flame size={13} className="shrink-0 text-[#DC2626]" />
                    <span className="truncate">Model 1: Forest Fire</span>
                  </span>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${
                    !hazardResult ? 'bg-[#2C2922] text-[#F1D2A1]' : hazardResult.riskLevel === 'HIGH' ? 'bg-[#DC2626] text-white' : hazardResult.riskLevel === 'MODERATE' ? 'bg-[#D97706] text-white' : 'bg-[#2C2922] text-[#F1D2A1]'
                  }`}>
                    {hazardResult ? hazardResult.riskLevel : 'STANDBY'}
                  </span>
                </button>

                {/* Sub Menu 2: Model 2 Botanical */}
                <button
                  type="button"
                  onClick={() => {
                    setCurrentTab('model_botanical');
                    if (isMobile) setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#F1D2A1] border ${
                    currentTab === 'model_botanical'
                      ? 'bg-[#5E682B] text-white shadow-xs font-bold border-l-2 border-l-[#F1D2A1] border-y-[#869440] border-r-[#869440]'
                      : 'text-[#F1D2A1]/85 border-transparent hover:bg-[#5E682B]/60 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Leaf size={13} className="shrink-0 text-[#F1D2A1]" />
                    <span className="truncate">Model 2: Botanical</span>
                  </span>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${floraResult ? 'bg-[#2C2922] text-[#F1D2A1]' : 'bg-[#2C2922] text-[#F1D2A1]'}`}>
                    {floraResult ? floraResult.sensorRisk.toUpperCase() : 'STANDBY'}
                  </span>
                </button>

                {/* Sub Menu 3: Model 3 Computer Vision */}
                <button
                  type="button"
                  onClick={() => {
                    setCurrentTab('model_vision');
                    if (isMobile) setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#F1D2A1] border ${
                    currentTab === 'model_vision'
                      ? 'bg-[#5E682B] text-white shadow-xs font-bold border-l-2 border-l-[#4D6A75] border-y-[#869440] border-r-[#869440]'
                      : 'text-[#F1D2A1]/85 border-transparent hover:bg-[#5E682B]/60 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Camera size={13} className="shrink-0 text-[#4D6A75]" />
                    <span className="truncate">Model 3: Computer Vision</span>
                  </span>
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 bg-[#4D6A75] text-white">
                    AI.OPT
                  </span>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              setCurrentTab('all');
              if (isMobile) setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#F1D2A1] border ${
              currentTab === 'all'
                ? 'bg-[#2C2922] text-[#F1D2A1] shadow-xs border-[#2C2922]'
                : 'text-[#F1D2A1]/80 border-transparent hover:bg-[#5E682B]/60 hover:text-white'
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <Layers size={13} className="shrink-0" />
              <span className="truncate">All Views (Combined)</span>
            </span>
          </button>
        </nav>

        {/* Navigation Links */}
        <nav aria-label="Console Sections" className="space-y-1 pt-3 border-t border-[#5E682B]">
          <span className="px-2.5 text-[10px] font-bold uppercase tracking-widest text-[#F1D2A1]/80 block mb-2">
            Section Quick Links
          </span>
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  scrollToSection(item.id);
                  if (isMobile) setMobileMenuOpen(false);
                }}
                aria-current={isActive ? 'location' : undefined}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#F1D2A1] border ${
                  isActive
                    ? 'bg-[#5E682B] text-white shadow-xs font-bold border-[#869440]'
                    : 'text-[#F1D2A1]/90 border-transparent hover:bg-[#5E682B]/60 hover:text-white'
                }`}
              >
                <span className="truncate">{item.label}</span>
                {item.badge && (
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ml-1.5 ${
                      isActive ? 'bg-[#2C2922] text-[#F1D2A1]' : 'bg-[#2C2922]/80 text-[#F1D2A1]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom System Channel Status */}
      <div className="bg-[#5E682B] p-3 rounded-xl border border-[#869440] flex items-center gap-2.5 mt-3 shrink-0">
        <span className="w-2 h-2 rounded-full shrink-0 bg-[#F1D2A1] shadow-[0_0_6px_rgba(241,210,161,0.8)] animate-pulse" />
        <div className="min-w-0 flex-1">
          <span className="block text-[9px] text-[#F1D2A1]/80 font-semibold uppercase tracking-wider truncate">
            Edge Kernel Channel
          </span>
          <div className="flex items-center justify-between gap-1 mt-0.5">
            <span className="block text-xs font-bold text-white uppercase tracking-wider truncate">
              LIVE · C HEADER AI
            </span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-[#EAD39D] text-[#2C2922] border border-[#D6BC7C] font-mono shrink-0">
              100 Trees
            </span>
          </div>
          <span className="block text-[10px] text-[#F1D2A1]/80 truncate mt-0.5">
            model_hazard.h + grenvis_sensor
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F7F8F5] text-[#263A35] flex flex-col font-sans">
      {/* 3D Boot Splash Screen */}
      {viewMode === 'boot' && <FloraSplash onComplete={() => setViewMode('dashboard')} />}

      {/* TOP NAVIGATION BAR (Olive Green #737F35 Theme) */}
      <header className={`sticky top-0 z-40 w-full border-b transition-all duration-300 select-none animate-navbar-slide-down ${
        isScrolled
          ? 'bg-[#737F35]/95 backdrop-blur-md border-[#5E682B] shadow-lg shadow-black/25'
          : 'bg-[#737F35] border-[#5E682B] shadow-md'
      }`}>
        {/* Top Accent Strip - Peach #F1D2A1 with smooth shimmer animation */}
        <div className="h-0.5 w-full animate-nav-shimmer shadow-[0_1px_8px_rgba(241,210,161,0.6)] shrink-0" />

        {/* Tier 1: Main Top Navbar Row */}
        <div className="w-full px-4 sm:px-6 lg:px-8 py-2.5">
          <div className="flex items-center justify-between gap-3">
            {/* Left: Mobile Toggle & Brand */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden text-[#F1D2A1] hover:text-white w-9 h-9 flex items-center justify-center rounded-xl bg-[#5E682B] border border-[#869440] text-base shrink-0 cursor-pointer hover:bg-[#525B25] hover:-translate-y-0.5 active:translate-y-0 active:scale-95 transition-all duration-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#F1D2A1] shadow-xs hover:shadow-sm"
                aria-label="Buka menu navigasi"
                aria-expanded={mobileMenuOpen}
              >
                <span aria-hidden="true">☰</span>
              </button>

              <div
                className="flex items-center gap-2.5 group cursor-pointer"
                onClick={() => scrollToSection('overview')}
                title="Kembali ke Ringkasan AGRAPATHA"
              >
                <div className="w-9 h-9 rounded-xl bg-[#5E682B] border border-[#869440] flex items-center justify-center shadow-xs shrink-0 transition-all duration-300 group-hover:scale-105 group-hover:shadow-[0_0_10px_rgba(241,210,161,0.4)] p-1 overflow-hidden">
                  <img
                    src="/agrapatha-logo.png"
                    alt="Logo AGRAPATHA"
                    className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-110 drop-shadow-sm"
                  />
                </div>
                <div className="min-w-0">
                  <span className="text-xs sm:text-sm font-bold text-white tracking-wider uppercase block font-display truncate transition-colors duration-200 group-hover:text-[#F1D2A1]">
                    AGRAPATHA
                  </span>
                  <span className="text-[10px] text-[#F1D2A1]/90 font-medium block truncate">
                    Edge AI Forest &amp; Botanical
                  </span>
                </div>
              </div>
            </div>

            {/* Middle: Primary Views & Models Tabs/Dropdown (Desktop) */}
            <nav aria-label="Primary Views & Models" className="hidden lg:flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#F1D2A1]/80 mr-1 shrink-0">
                Primary Views &amp; Models
              </span>

              {/* NavigationMenu for Dashboard 1 Options */}
              <NavigationMenu>
                <NavigationMenuList>
                  <NavigationMenuItem>
                    <NavigationMenuTrigger
                      className="h-9 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer border bg-[#5E682B] text-[#F1D2A1] border-[#869440] hover:bg-[#525B25] hover:text-white hover:-translate-y-0.5 active:translate-y-0 hover:shadow-sm data-[state=open]:bg-[#2C2922] data-[state=open]:text-[#F1D2A1] data-[state=open]:border-[#2C2922] backdrop-blur-md"
                    >
                      <LayoutGrid size={14} className="shrink-0 mr-1.5 text-current" />
                      <span>Dashboard 1</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase font-mono ml-1.5 mr-0.5 bg-[#EAD39D] text-[#2C2922] border border-[#D6BC7C]">
                        {currentTab === 'model_hazard'
                          ? 'MODEL 1'
                          : currentTab === 'model_botanical'
                          ? 'MODEL 2'
                          : currentTab === 'model_vision'
                          ? 'MODEL 3'
                          : '3-MODEL'}
                      </span>
                    </NavigationMenuTrigger>

                    <NavigationMenuContent className="p-2.5 w-64 space-y-1">
                      {/* Sub Menu 0: Overview */}
                      <NavigationMenuLink asChild>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('overview')}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left border ${
                            currentTab === 'overview'
                              ? 'bg-[#737F35]/12 text-[#2C2922] shadow-xs font-bold border-[#737F35]/40'
                              : 'text-[#2C2922]/80 border-transparent hover:bg-[#737F35]/10 hover:text-[#2C2922] hover:border-[#737F35]/20'
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#737F35] shadow-[0_0_6px_rgba(115,127,53,0.6)]" />
                            <span className="truncate">Overview (Ringkasan)</span>
                          </span>
                          <span className="text-[8px] font-mono uppercase px-1 py-0.5 rounded bg-[#EAEFED] border border-[#DCE4E1] text-[#56612E]">
                            ALL
                          </span>
                        </button>
                      </NavigationMenuLink>

                      {/* Sub Menu 1: Model 1 Forest Fire */}
                      <NavigationMenuLink asChild>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('model_hazard')}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left border ${
                            currentTab === 'model_hazard'
                              ? 'bg-[#737F35]/12 text-[#2C2922] shadow-xs font-bold border-l-2 border-[#DC2626] border-y-[#DCE4E1] border-r-[#DCE4E1]'
                              : 'text-[#2C2922]/80 border-transparent hover:bg-[#737F35]/10 hover:text-[#2C2922] hover:border-[#737F35]/20'
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <Flame size={13} className="shrink-0 text-[#DC2626]" />
                            <span className="truncate">Model 1: Forest Fire</span>
                          </span>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 border ${
                            !hazardResult ? 'bg-[#EAEFED] text-[#2C2922] border-[#DCE4E1]' : hazardResult.riskLevel === 'HIGH' ? 'bg-[#DC2626] text-white border-transparent' : hazardResult.riskLevel === 'MODERATE' ? 'bg-[#D97706] text-white border-transparent' : 'bg-[#56612E] text-white border-transparent'
                          }`}>
                            {hazardResult ? hazardResult.riskLevel : 'STANDBY'}
                          </span>
                        </button>
                      </NavigationMenuLink>

                      {/* Sub Menu 2: Model 2 Botanical */}
                      <NavigationMenuLink asChild>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('model_botanical')}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left border ${
                            currentTab === 'model_botanical'
                              ? 'bg-[#737F35]/12 text-[#2C2922] shadow-xs font-bold border-l-2 border-[#56612E] border-y-[#DCE4E1] border-r-[#DCE4E1]'
                              : 'text-[#2C2922]/80 border-transparent hover:bg-[#737F35]/10 hover:text-[#2C2922] hover:border-[#737F35]/20'
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <Leaf size={13} className="shrink-0 text-[#56612E]" />
                            <span className="truncate">Model 2: Botanical</span>
                          </span>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 border ${floraResult ? 'bg-[#56612E] text-white border-transparent' : 'bg-[#EAEFED] text-[#2C2922] border-[#DCE4E1]'}`}>
                            {floraResult ? floraResult.sensorRisk.toUpperCase() : 'STANDBY'}
                          </span>
                        </button>
                      </NavigationMenuLink>

                      {/* Sub Menu 3: Model 3 Computer Vision */}
                      <NavigationMenuLink asChild>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('model_vision')}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left border ${
                            currentTab === 'model_vision'
                              ? 'bg-[#737F35]/12 text-[#2C2922] shadow-xs font-bold border-l-2 border-[#4D6A75] border-y-[#DCE4E1] border-r-[#DCE4E1]'
                              : 'text-[#2C2922]/80 border-transparent hover:bg-[#737F35]/10 hover:text-[#2C2922] hover:border-[#737F35]/20'
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <Camera size={13} className="shrink-0 text-[#4D6A75]" />
                            <span className="truncate">Model 3: Computer Vision</span>
                          </span>
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 bg-[#EAEFED] text-[#4D6A75] border border-[#DCE4E1]">
                            AI.OPT
                          </span>
                        </button>
                      </NavigationMenuLink>
                    </NavigationMenuContent>
                  </NavigationMenuItem>

                  {/* Anak Bar: Navigation Menu Item for Section Quick Links */}
                  <NavigationMenuItem>
                    <NavigationMenuTrigger
                      className="h-9 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer border bg-[#5E682B] text-[#F1D2A1] border-[#869440] hover:bg-[#525B25] hover:text-white hover:-translate-y-0.5 active:translate-y-0 hover:shadow-sm data-[state=open]:bg-[#2C2922] data-[state=open]:text-[#F1D2A1] data-[state=open]:border-[#2C2922] backdrop-blur-md"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#F1D2A1] mr-1.5 shadow-[0_0_6px_#F1D2A1]" />
                      <span>Anak Bar Seksi</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-[#EAD39D] text-[#2C2922] border border-[#D6BC7C] font-mono ml-1.5 mr-0.5">
                        {navItems.length} SEKSI
                      </span>
                    </NavigationMenuTrigger>

                    <NavigationMenuContent className="p-3.5 w-[420px] sm:w-[520px] md:w-[600px]">
                      <div className="mb-2.5 px-1.5 pb-2 border-b border-[#E2E8E5] flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#56612E] flex items-center gap-1.5 font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#737F35] shadow-[0_0_6px_rgba(115,127,53,0.6)]" />
                          <span>Anak Bar · Navigasi Cepat Seksi Konsol</span>
                        </span>
                        <span className="text-[9px] text-[#7E694F] font-mono">
                          Lompat langsung ke seksi
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[360px] overflow-y-auto pr-1 flora-sidebar-scroll">
                        {navItems.map((item) => {
                          const isActive = activeSection === item.id;
                          return (
                            <NavigationMenuLink asChild key={item.id}>
                              <button
                                type="button"
                                onClick={() => scrollToSection(item.id)}
                                className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left border ${
                                  isActive
                                    ? 'bg-[#737F35]/12 text-[#2C2922] shadow-xs font-bold border-[#737F35]/40'
                                    : 'text-[#2C2922]/80 border-transparent hover:bg-[#737F35]/10 hover:text-[#2C2922] hover:border-[#737F35]/20'
                                }`}
                              >
                                <span className="truncate">{item.label}</span>
                                {item.badge && (
                                  <span
                                    className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ml-1.5 border ${
                                      isActive ? 'bg-[#737F35] text-white border-transparent' : 'bg-[#EAEFED] text-[#56612E] border border-[#DCE4E1]'
                                    }`}
                                  >
                                    {item.badge}
                                  </span>
                                )}
                              </button>
                            </NavigationMenuLink>
                          );
                        })}
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>
            </nav>

            {/* Right: Edge Kernel Channel + Connectivity + 3D Welcome + Clock */}
            <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
              {/* Edge Kernel Channel */}
              <div className="hidden lg:flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-[#5E682B] border border-[#869440] shrink-0 transition-transform duration-200 hover:-translate-y-0.5 shadow-xs hover:shadow-sm">
                <span className="w-2 h-2 rounded-full shrink-0 bg-[#F1D2A1] shadow-[0_0_6px_rgba(241,210,161,0.8)] animate-pulse" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider truncate">
                      LIVE · C HEADER AI
                    </span>
                    <span className="text-[9px] text-[#2C2922] font-mono font-bold px-1.5 py-0.5 rounded bg-[#EAD39D] border border-[#D6BC7C] shrink-0">
                      100 Trees
                    </span>
                  </div>
                  <span className="text-[9px] text-[#F1D2A1]/80 font-medium block truncate max-w-[130px] xl:max-w-[160px]">
                    model_hazard.h + grenvis_sensor
                  </span>
                </div>
              </div>

              {/* Connectivity status */}
              {(() => {
                const deviceConn = getDeviceConnectivityStatus(
                  isLiveTelemetry,
                  isTelemetryStale,
                  gatewayStatus,
                  gatewayHealth?.mqttConnected ?? false
                );
                return (
                  <div
                    className={`flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm backdrop-blur-md ${
                      deviceConn.isOnline
                        ? 'bg-[#5E682B] border-[#869440] text-white'
                        : isTelemetryStale
                        ? 'bg-[#5E682B] border-[#D97706]/70 text-[#D97706]'
                        : 'bg-[#5E682B] border-[#869440] text-white'
                    }`}
                    title={`Status Gateway SSE (/api/telemetry/stream): ${gatewayStatus.toUpperCase()} · Broker EMQX: ${gatewayHealth ? (gatewayHealth.mqttConnected ? 'CONNECTED' : 'DISCONNECTED') : 'CHECKING'}${isTelemetryStale ? ' · TELEMETRI STALE' : ''}`}
                    aria-label="Status Gateway Telemetri"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${deviceConn.dotClass}`} />
                    <span className="font-bold font-display text-[11px] uppercase tracking-wider text-white">
                      {deviceConn.text}
                    </span>
                    <span className="text-[11px] text-[#F1D2A1]/80 font-tabular border-l border-[#869440] pl-2 hidden sm:inline-block">
                      {isLiveTelemetry && !isTelemetryStale && lastLiveTelemetryTime
                        ? lastLiveTelemetryTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : 'SSE'}
                    </span>
                  </div>
                );
              })()}

              <button
                type="button"
                onClick={() => setViewMode('boot')}
                className="group px-2.5 sm:px-3 py-1.5 rounded-xl text-[#F1D2A1] hover:bg-[#525B25] hover:text-white border border-[#869440] bg-[#5E682B] text-xs font-bold transition-all duration-200 cursor-pointer flex items-center gap-1.5 shadow-xs hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 active:scale-95 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#F1D2A1]"
                title="Buka tampilan 3D Welcome Screen"
                aria-label="Buka kembali tampilan 3D Welcome Screen"
              >
                <span aria-hidden="true" className="text-[#F1D2A1] transition-transform duration-300 group-hover:rotate-45">✦</span>
                <span className="hidden sm:inline">3D Welcome</span>
              </button>

              <LiveClockBadge isGlassy={isScrolled} />
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-screen">
        {/* Mobile Drawer Sidebar */}
        {mobileMenuOpen && (
          <div
            id="mobile-navigation-drawer"
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 lg:hidden flex"
            onClick={() => setMobileMenuOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Navigasi AGRAPATHA"
          >
            <div
              className="w-70 h-full bg-[#737F35] border-r border-[#5E682B] shadow-2xl flex flex-col z-50"
              onClick={(e) => e.stopPropagation()}
            >
              {renderSidebarContent(true)}
            </div>
          </div>
        )}

        {/* Main Console Workspace */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-7 xl:p-8 2xl:p-9 max-w-360 xl:max-w-[1560px] 2xl:max-w-[1680px] mx-auto w-full overflow-x-clip">
          {/* Top Console Header Banner */}
          <div
            ref={headerRef}
            className="rounded-2xl border border-[#5E682B] bg-[#737F35] p-4 sm:p-5 mb-5 shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden"
          >
            {/* Top Accent Strip - Peach #F1D2A1 */}
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#F1D2A1] shadow-[0_1px_6px_rgba(241,210,161,0.5)]" />

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-widest text-[#F1D2A1] uppercase flex items-center gap-1.5 truncate font-mono">
                  <img src="/agrapatha-logo.png" alt="Logo AGRAPATHA" className="w-3.5 h-3.5 object-contain shrink-0 inline-block drop-shadow-xs" />
                  <span className="truncate">AGRAPATHA · Botanical &amp; Forest Fire Intelligence</span>
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white mt-1 tracking-tight font-display">
                Forest Fire Hazard &amp; Microclimate Console
              </h1>
              <p className="text-xs text-[#F1D2A1]/90 mt-1 leading-relaxed">
                Realtime FWI sensor telemetry,{' '}
                <code className="font-mono text-[#F1D2A1] px-1.5 py-0.5 rounded border border-[#869440] bg-[#5E682B]">
                  model_hazard.h
                </code>{' '}
                Random Forest (100 trees), and{' '}
                <code className="font-mono text-[#F1D2A1] px-1.5 py-0.5 rounded border border-[#869440] bg-[#5E682B]">
                  grenvis_sensor_model.h
                </code>{' '}
                evaluation.
              </p>
            </div>
          </div>

          {/* Realtime Status Alert Banner */}
          <div className="mb-6">
            <aside
              aria-label="Realtime Forest Status Alert"
              className={`p-3.5 sm:p-4 rounded-xl border transition-all duration-300 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${alertBanner.wrapper}`}
            >
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div className="mt-0.5 sm:mt-0">
                  <svg
                    className="w-4 h-4 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-xs sm:text-sm tracking-tight font-display">
                      {alertBanner.title}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${alertBanner.badge}`}
                    >
                      {alertBanner.severity}
                    </span>
                  </div>
                  <p className="text-xs opacity-90 mt-0.5 leading-snug">{alertBanner.description}</p>
                </div>
              </div>
              <button
                onClick={() => scrollToSection(alertBanner.actionTarget)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5 self-end sm:self-auto cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-current ${alertBanner.btn}`}
                aria-label={`${alertBanner.actionText}: Menuju seksi ${alertBanner.actionTarget}`}
              >
                <span>{alertBanner.actionText}</span>
                <span className="text-[11px]">→</span>
              </button>
            </aside>
          </div>

          <div className="space-y-8 sm:space-y-10">
            {/* THREE-MODEL SUMMARIES (DASHBOARD 1 OVERVIEW & NAVIGATION) */}
            {(currentTab === 'overview' || currentTab === 'all') && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Model 1 Card */}
                <div className="agra-card p-4 sm:p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-[#4E8577] uppercase tracking-wider flex items-center gap-1.5">
                        <Flame size={12} className="text-[#DC2626]" />
                        <span>Model 1 · Edge RF</span>
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          !isLiveTelemetry || isTelemetryStale || !hazardResult
                            ? 'bg-[#E5EBE8] text-[#4D6A75] border border-[#DCE4E1]'
                            : hazardResult.riskLevel === 'HIGH'
                            ? 'agra-badge-high'
                            : hazardResult.riskLevel === 'MODERATE'
                            ? 'agra-badge-moderate'
                            : 'agra-badge-safe'
                        }`}
                      >
                        {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.riskLevel} RISK` : 'STANDBY'}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-[#2C2922] font-display">
                      Forest Fire Hazard (<code className="text-xs font-mono text-[#4E8577]">model_hazard.h</code>)
                    </h3>
                    <p className="text-[11px] text-[#4D6A75] mt-1 leading-snug">
                      {isLiveTelemetry && !isTelemetryStale && typeof ffmc === 'number' && typeof dmc === 'number' && typeof isi === 'number'
                        ? `100-Tree Random Forest · FFMC ${ffmc.toFixed(1)}, DMC ${dmc.toFixed(1)}, ISI ${isi.toFixed(1)}`
                        : 'Menunggu pembacaan telemetri aktif gateway untuk inferensi model_hazard.h'}
                    </p>

                    {/* Probability Mini-Bar */}
                    <div className="space-y-1.5 mt-3 pt-2 border-t border-[#DCE4E1]">
                      <div className="flex justify-between text-[10px] font-medium text-[#4D6A75]">
                        <span>Proba High: {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.highProbability.toFixed(1)}%` : '--'}</span>
                        <span>Conf: {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.confidence.toFixed(1)}%` : '--'}</span>
                      </div>
                      <div className="h-1.5 bg-[#E5EBE8] rounded-full overflow-hidden flex">
                        <div
                          style={{ width: `${isLiveTelemetry && !isTelemetryStale && hazardResult ? hazardResult.lowProbability : 0}%` }}
                          className="bg-[#56612E]"
                          title={`Low: ${isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.lowProbability.toFixed(1)}%` : '--'}`}
                        />
                        <div
                          style={{ width: `${isLiveTelemetry && !isTelemetryStale && hazardResult ? hazardResult.moderateProbability : 0}%` }}
                          className="bg-[#D97706]"
                          title={`Moderate: ${isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.moderateProbability.toFixed(1)}%` : '--'}`}
                        />
                        <div
                          style={{ width: `${isLiveTelemetry && !isTelemetryStale && hazardResult ? hazardResult.highProbability : 0}%` }}
                          className="bg-[#DC2626]"
                          title={`High: ${isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.highProbability.toFixed(1)}%` : '--'}`}
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCurrentTab('model_hazard');
                    }}
                    className="mt-4 pt-2.5 border-t border-[#DCE4E1] text-[11px] font-bold text-[#4E8577] hover:text-[#56612E] flex items-center justify-between cursor-pointer"
                  >
                    <span>Buka Model 1 Hazard &amp; Detail</span>
                    <ChevronRight size={13} />
                  </button>
                </div>

                {/* Model 2 Card */}
                <div className="agra-card p-4 sm:p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-[#56612E] uppercase tracking-wider flex items-center gap-1.5">
                        <Leaf size={12} className="text-[#56612E]" />
                        <span>Model 2 · ANN Microclimate</span>
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        !isLiveTelemetry || isTelemetryStale || !floraResult ? 'bg-[#E5EBE8] text-[#4D6A75] border border-[#DCE4E1]' : 'agra-badge-safe'
                      }`}>
                        {isLiveTelemetry && !isTelemetryStale && floraResult ? floraResult.sensorRisk.toUpperCase() : 'STANDBY'}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-[#2C2922] font-display">
                      Botanical &amp; Soil Risk (<code className="text-xs font-mono text-[#4E8577]">grenvis_sensor_model.h</code>)
                    </h3>
                    <p className="text-[11px] text-[#4D6A75] mt-1 leading-snug">
                      {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' && typeof temp === 'number'
                        ? `ANN Health Index · Soil ${soilMoisture.toFixed(1)}% (${soilMoisture >= 30 ? 'Hidrasi Aman' : 'Defisit'}), Temp ${temp.toFixed(1)}°C`
                        : 'Menunggu pembacaan sensor tanah dan DHT22 untuk evaluasi grenvis_sensor_model.h'}
                    </p>

                    {/* Hydration / Confidence Indicator */}
                    <div className="space-y-1.5 mt-3 pt-2 border-t border-[#DCE4E1]">
                      <div className="flex justify-between text-[10px] font-medium text-[#4D6A75]">
                        <span>Hydration: {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? (soilMoisture >= 30 ? 'Optimal' : 'Defisit Hidrasi') : '--'}</span>
                        <span>Conf: {isLiveTelemetry && !isTelemetryStale && floraResult ? `${floraResult.sensorConfidence.toFixed(1)}%` : '--'}</span>
                      </div>
                      <div className="h-1.5 bg-[#E5EBE8] rounded-full overflow-hidden">
                        <div
                          style={{ width: `${isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? Math.min(100, Math.max(0, soilMoisture)) : 0}%` }}
                          className={`h-full ${
                            typeof soilMoisture === 'number'
                              ? soilMoisture < 25 ? 'bg-[#DC2626]' : soilMoisture < 35 ? 'bg-[#D97706]' : 'bg-[#56612E]'
                              : 'bg-[#94A3B8]'
                          }`}
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCurrentTab('model_botanical');
                    }}
                    className="mt-4 pt-2.5 border-t border-[#DCE4E1] text-[11px] font-bold text-[#4E8577] hover:text-[#56612E] flex items-center justify-between cursor-pointer"
                  >
                    <span>Buka Model 2 Botani &amp; Irigasi</span>
                    <ChevronRight size={13} />
                  </button>
                </div>

                {/* Model 3 Card */}
                <div className="agra-card p-4 sm:p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-[#4D6A75] uppercase tracking-wider flex items-center gap-1.5">
                        <Camera size={12} className="text-[#4D6A75]" />
                        <span>Model 3 · Vision TFLite</span>
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full agra-badge-skyline">
                        {visionPrediction.includes('Fire')
                          ? 'FIRE DETECTED'
                          : visionPrediction.includes('Smoke')
                          ? 'SMOKE DETECTED'
                          : 'OPTICAL CLEAR'}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-[#2C2922] font-display">
                      Computer Vision (<code className="text-xs font-mono text-[#4E8577]">mobilenetv2.tflite</code>)
                    </h3>
                    <p className="text-[11px] text-[#4D6A75] mt-1 leading-snug">
                      Railway Cloud API · Frame Status: {cameraStatus === 'streaming' ? 'Live Stream' : previewUrl ? 'Captured Frame' : 'Standby / Ready'}
                    </p>

                    {/* Optical Proba Mini-Bar */}
                    <div className="space-y-1.5 mt-3 pt-2 border-t border-[#DCE4E1]">
                      <div className="flex justify-between text-[10px] font-medium text-[#4D6A75]">
                        <span>Smoke: {visionProbs.smoke.toFixed(1)}%</span>
                        <span>Fire: {visionProbs.fire.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 bg-[#E5EBE8] rounded-full overflow-hidden flex">
                        <div
                          style={{ width: `${visionProbs.healthy}%` }}
                          className="bg-[#56612E]"
                          title={`Healthy: ${visionProbs.healthy.toFixed(1)}%`}
                        />
                        <div
                          style={{ width: `${visionProbs.smoke}%` }}
                          className="bg-[#D97706]"
                          title={`Smoke: ${visionProbs.smoke.toFixed(1)}%`}
                        />
                        <div
                          style={{ width: `${visionProbs.fire}%` }}
                          className="bg-[#DC2626]"
                          title={`Fire: ${visionProbs.fire.toFixed(1)}%`}
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCurrentTab('model_vision');
                    }}
                    className="mt-4 pt-2.5 border-t border-[#DCE4E1] text-[11px] font-bold text-[#4E8577] hover:text-[#56612E] flex items-center justify-between cursor-pointer"
                  >
                    <span>Buka Model 3 Kamera &amp; Inferensi</span>
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* 1. OVERVIEW HERO CARD (Olive Green Glassmorphism Theme) */}
            {(currentTab === 'overview' || currentTab === 'all') && (
              <>
                <section
                  id="overview"
                  className="scroll-mt-6 sm:scroll-mt-8 rounded-2xl border border-[#869440]/60 bg-[#737F35]/75 backdrop-blur-xl backdrop-saturate-150 p-5 sm:p-6 lg:p-7 flex flex-col justify-between gap-6 transition-all shadow-[0_8px_32px_0_rgba(44,41,34,0.18)] relative overflow-hidden text-white ring-1 ring-white/10"
                >
                  {/* Glassmorphic Ambient Highlight & Shimmer Strip */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-black/[0.1] pointer-events-none" />
                  <div className="absolute top-0 left-0 right-0 h-0.5 animate-nav-shimmer shadow-[0_1px_8px_rgba(241,210,161,0.6)] z-10" />

                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-white/10 relative z-1">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#F1D2A1] block font-mono">
                        AGRAPATHA · Montesinho FWI &amp; Microclimate Overview
                      </span>
                      <h2 className="text-xl lg:text-2xl font-bold font-display text-white tracking-tight mt-1">
                        Forest Fire Hazard &amp; Environmental Intelligence
                      </h2>
                    </div>
                    <div className="flex items-center gap-2 self-start md:self-auto shrink-0 flex-wrap">
                      <span className="text-[11px] text-[#F1D2A1] font-tabular px-2.5 py-1 rounded-xl bg-[#5E682B]/60 backdrop-blur-md border border-[#869440]/60 shadow-2xs">
                        Kaggle Label: {isLiveTelemetry && !isTelemetryStale && hazardResult ? hazardResult.kaggleBinaryPrediction : 'STANDBY'}
                      </span>
                      <span className="text-[11px] font-bold px-2.5 py-1 rounded-xl bg-[#EAD39D]/90 backdrop-blur-md text-[#2C2922] border border-[#D6BC7C] shadow-2xs font-mono uppercase">
                        {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.riskLevel} Priority` : 'STANDBY'}
                      </span>
                    </div>
                  </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start relative z-1">
                <div className="lg:col-span-2 space-y-3.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#F1D2A1] shadow-[0_0_6px_rgba(241,210,161,0.7)] animate-pulse" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#F1D2A1]">
                      Current Forest &amp; Botanical Status
                    </span>
                  </div>
                  <h3 className="text-lg lg:text-xl font-bold font-display text-white leading-snug">
                    {isLiveTelemetry && !isTelemetryStale && hazardResult
                      ? hazardResult.riskLevel === 'HIGH'
                        ? 'Bahaya Kebakaran Hutan Tinggi — Zona Kritis Penyalaan Serasah (FFMC ≥ 89.5)'
                        : hazardResult.riskLevel === 'MODERATE'
                        ? 'Risiko Kebakaran Menengah — Transisi Pengeringan Bahan Bakar Halus'
                        : 'Kondisi Kanopi & Serasah Hutan Stabil — Risiko Penyalaan Rendah'
                      : 'Sistem Monitoring Siaga — Menunggu Telemetri Live Gateway'}
                  </h3>
                  <p className="text-xs lg:text-sm text-[#F1D2A1]/90 leading-relaxed max-w-2xl">
                    {isLiveTelemetry && !isTelemetryStale && hazardResult && typeof temp === 'number' && typeof rh === 'number' && typeof wind === 'number' && typeof rain === 'number' && typeof ffmc === 'number' && typeof dmc === 'number' ? (
                      <>
                        Berdasarkan eksekusi langsung 100 pohon keputusan pada <code className="text-[#F1D2A1] font-mono px-1 py-0.5 rounded bg-[#5E682B]/60 border border-[#869440]/60">model_hazard.h</code> dengan vektor input <code className="text-[#F1D2A1] font-mono px-1 py-0.5 rounded bg-[#5E682B]/60 border border-[#869440]/60">[{temp.toFixed(1)}°C, {rh.toFixed(0)}%, {wind.toFixed(1)} km/h, {rain.toFixed(1)} mm, FFMC {ffmc.toFixed(1)}, DMC {dmc.toFixed(1)}]</code>, probabilitas kelas adalah <strong>High {hazardResult.highProbability.toFixed(1)}%</strong>, <strong>Moderate {hazardResult.moderateProbability.toFixed(1)}%</strong>, dan <strong>Low {hazardResult.lowProbability.toFixed(1)}%</strong>.
                      </>
                    ) : (
                      'Evaluasi live model_hazard.h dan model_botanical.h menunggu aliran data telemetri valid dari gateway. Hasil prediksi tidak ditampilkan saat disconnected atau stale.'
                    )}
                  </p>

                  {/* Telemetry Pill Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-2.5 pt-1 w-full">
                    <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/75 hover:border-[#F1D2A1]/70 px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-200 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] shrink-0" />
                        <span className="text-[#F1D2A1] text-[11px] font-semibold truncate">1. Suhu (DHT22)</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{isLiveTelemetry && !isTelemetryStale && typeof temp === 'number' ? `${temp.toFixed(1)}°C` : 'Unavailable'}</span>
                    </div>
                    <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/75 hover:border-[#F1D2A1]/70 px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-200 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#0284C7] shrink-0" />
                        <span className="text-[#F1D2A1] text-[11px] font-semibold truncate">2. RH Udara</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{isLiveTelemetry && !isTelemetryStale && typeof rh === 'number' ? `${rh.toFixed(1)}%` : 'Unavailable'}</span>
                    </div>
                    <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/75 hover:border-[#F1D2A1]/70 px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-200 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#84CC16] shrink-0" />
                        <span className="text-[#F1D2A1] text-[11px] font-semibold truncate">3. Tanah (v1.2)</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? `${soilMoisture.toFixed(1)}%` : 'Unavailable'}</span>
                    </div>
                    <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/75 hover:border-[#F1D2A1]/70 px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-200 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#A855F7] shrink-0" />
                        <span className="text-[#F1D2A1] text-[11px] font-semibold truncate">4. Gas (MQ-135)</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{isLiveTelemetry && !isTelemetryStale ? (typeof gasPpm === 'number' ? `${gasPpm.toFixed(0)} ppm` : typeof mq135Raw === 'number' ? `${mq135Raw.toFixed(0)} ADC` : 'Unavailable') : 'Unavailable'}</span>
                    </div>
                    <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/75 hover:border-[#F1D2A1]/70 px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-200 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] shrink-0" />
                        <span className="text-[#F1D2A1] text-[11px] font-semibold truncate">5. Flame Sensor</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{isLiveTelemetry && !isTelemetryStale && typeof flameDetected === 'number' ? (flameDetected > 0 ? 'FLAME' : 'SAFE') : 'Unavailable'}</span>
                    </div>
                    <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/75 hover:border-[#F1D2A1]/70 px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-200 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#14B8A6] shrink-0" />
                        <span className="text-[#F1D2A1] text-[11px] font-semibold truncate">Angin Ambien</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{isLiveTelemetry && !isTelemetryStale && typeof wind === 'number' ? `${wind.toFixed(1)} km/h` : 'Unavailable'}</span>
                    </div>
                    <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/75 hover:border-[#F1D2A1]/70 px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-200 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] shrink-0" />
                        <span className="text-[#F1D2A1] text-[11px] font-semibold truncate">FFMC Serasah</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{isLiveTelemetry && !isTelemetryStale && typeof ffmc === 'number' ? ffmc.toFixed(1) : 'Unavailable'}</span>
                    </div>
                    <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/75 hover:border-[#F1D2A1]/70 px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-200 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#A855F7] shrink-0" />
                        <span className="text-[#F1D2A1] text-[11px] font-semibold truncate">Rel L298N OUT3/4</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{movementStatus === 'idle' ? 'STANDBY' : movementStatus.replace(/_command_sent|_command/g, '').toUpperCase()}</span>
                    </div>
                  </div>
                </div>

                {/* Right Risk Index Box */}
                <div className="bg-[#5E682B]/50 backdrop-blur-md border border-[#869440]/60 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center text-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_4px_16px_rgba(0,0,0,0.2)] ring-1 ring-white/10">
                  <span className="text-[10px] text-[#F1D2A1] uppercase tracking-widest font-bold block mb-1 font-mono">
                    model_hazard.h Risk Index
                  </span>
                  <div
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border my-2 font-display ${
                      !isLiveTelemetry || isTelemetryStale || !hazardResult
                        ? 'bg-[#2C2922]/80 backdrop-blur-sm text-[#EAD39D] border-[#D6BC7C]/80 shadow-xs'
                        : hazardResult.riskLevel === 'HIGH'
                        ? 'bg-[#FEEAEA] text-[#961C1C] border-[#FCCECE]'
                        : hazardResult.riskLevel === 'MODERATE'
                        ? 'bg-[#FEF7E8] text-[#8A570C] border-[#FDE3B5]'
                        : 'bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]'
                    }`}
                  >
                    {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.riskLevel} RISK` : 'STANDBY'}
                  </div>
                  <span className="text-[11px] text-[#F1D2A1]/90 font-tabular mt-0.5">
                    {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.confidence.toFixed(2)}% confidence` : '--'}
                  </span>
                  <p className="text-[10px] text-[#F1D2A1]/80 mt-2 m-0 leading-tight">
                    {isLiveTelemetry && !isTelemetryStale && hazardResult && floraResult
                      ? <>Evaluated via 100-Tree C Random Forest (<code className="font-mono text-[#F1D2A1] bg-[#525B25]/60 border border-[#869440]/60 px-1 py-0.5 rounded">model_hazard.h</code>) &amp; Botanical MLP (<code className="font-mono text-[#F1D2A1] bg-[#525B25]/60 border border-[#869440]/60 px-1 py-0.5 rounded">{floraResult.sensorRisk}</code>).</>
                      : 'Inference Standby · Menunggu Telemetri'}
                  </p>
                </div>
              </div>

              {/* 4 Bottom Pillar Boxes */}
              <div className="pt-4 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 relative z-1">
                <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/70 hover:border-[#F1D2A1]/60 transition-all duration-200 p-3 rounded-xl flex flex-col justify-between min-h-20.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                  <span className="text-[10px] font-bold text-[#F1D2A1] uppercase tracking-wider block font-mono">
                    1. Meteorology (Montesinho)
                  </span>
                  <span className="text-xs font-bold text-white block mt-1">
                    {isLiveTelemetry && !isTelemetryStale && typeof temp === 'number'
                      ? temp >= 28 ? 'Hot / Dry Air' : temp <= 12 ? 'Cool Canopy' : 'Temperate Optimal'
                      : 'STANDBY'}
                  </span>
                  <span className="text-[10px] text-[#F1D2A1]/85 block font-tabular mt-0.5">
                    {isLiveTelemetry && !isTelemetryStale && typeof temp === 'number' && typeof rh === 'number' && typeof wind === 'number'
                      ? `${temp.toFixed(1)}°C · RH ${rh.toFixed(0)}% · Wind ${wind.toFixed(1)} km/h`
                      : 'Menunggu Telemetri'}
                  </span>
                </div>
                <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/70 hover:border-[#F1D2A1]/60 transition-all duration-200 p-3 rounded-xl flex flex-col justify-between min-h-20.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                  <span className="text-[10px] font-bold text-[#F1D2A1] uppercase tracking-wider block font-mono">
                    2. FWI Fuel Codes
                  </span>
                  <span className="text-xs font-bold text-white block mt-1">
                    {isLiveTelemetry && !isTelemetryStale && typeof ffmc === 'number'
                      ? ffmc >= 90 ? 'Flammable Litter' : ffmc >= 82 ? 'Moderate Drying' : 'Moist Litter'
                      : 'STANDBY'}
                  </span>
                  <span className="text-[10px] text-[#F1D2A1]/85 block font-tabular mt-0.5">
                    {isLiveTelemetry && !isTelemetryStale && typeof ffmc === 'number' && typeof dmc === 'number' && typeof isi === 'number'
                      ? `FFMC ${ffmc.toFixed(1)} · DMC ${dmc.toFixed(1)} · ISI ${isi.toFixed(1)}`
                      : 'FWI Engine Standby'}
                  </span>
                </div>
                <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/70 hover:border-[#F1D2A1]/60 transition-all duration-200 p-3 rounded-xl flex flex-col justify-between min-h-20.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                  <span className="text-[10px] font-bold text-[#F1D2A1] uppercase tracking-wider block font-mono">
                    3. Edge AI (model_hazard.h)
                  </span>
                  <span className="text-xs font-bold text-white block mt-1">
                    {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.riskLevel} (${hazardResult.confidence.toFixed(1)}%)` : 'STANDBY'}
                  </span>
                  <span className="text-[10px] text-[#F1D2A1]/85 block font-tabular mt-0.5">
                    {isLiveTelemetry && !isTelemetryStale && hazardResult ? `Kaggle Label: ${hazardResult.kaggleBinaryPrediction}` : 'Model Standby'}
                  </span>
                </div>
                <div className="bg-[#5E682B]/45 backdrop-blur-md border border-[#869440]/60 hover:bg-[#5E682B]/70 hover:border-[#F1D2A1]/60 transition-all duration-200 p-3 rounded-xl flex flex-col justify-between min-h-20.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                  <span className="text-[10px] font-bold text-[#F1D2A1] uppercase tracking-wider block font-mono">
                    4. Soil Moisture &amp; Vision
                  </span>
                  <span className="text-xs font-bold text-white block mt-1">
                    {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' && floraResult
                      ? `Soil ${soilMoisture.toFixed(1)}% (${floraResult.sensorRisk})`
                      : 'Soil -- (STANDBY)'}
                  </span>
                  <span className="text-[10px] text-[#F1D2A1]/85 block font-tabular mt-0.5">
                    {wildfireResult && inferenceStatus === 'success' ? visionPrediction : 'Vision Standby'}
                  </span>
                </div>
              </div>
            </section>

            {/* BMKG Regional Macro-Weather Context */}
            <FloraBmkgCard />

            {/* 2. LIVE ENVIRONMENTAL SENSORS (6-Card Grid with exact Kaggle Dataset Ranges) */}
            <section id="monitoring" className="scroll-mt-6 sm:scroll-mt-8">
              <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                <div>
                  <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
                    Telemetry Stream · 6 C-Model Inputs + Soil Moisture
                  </span>
                  <h2 className="text-lg font-bold text-[#263A35] tracking-tight font-display">
                    Live Environmental &amp; FWI Sensors
                  </h2>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EFF3EF] border border-[#A6B49E] text-xs font-semibold text-[#263A35]">
                  <span className="w-2 h-2 rounded-full bg-[#4E635E] animate-pulse" />
                  <span>Calibrated to forestfires.csv (517) &amp; FWI Reference</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    title: '1. Suhu Udara (Air Temperature)',
                    shortTitle: 'Suhu Udara (DHT22)',
                    channelTag: 'Sensor 1',
                    value: formatSensorValue(temp, isLiveTelemetry && !isTelemetryStale, 1),
                    unit: isLiveTelemetry && !isTelemetryStale ? '°C' : '',
                    statusLabel: getSensorStatusLabel('temp', temp, isLiveTelemetry && !isTelemetryStale, undefined, isTelemetryStale),
                    isWarn: isLiveTelemetry && !isTelemetryStale && typeof temp === 'number' && temp >= 28,
                    percent: isLiveTelemetry && !isTelemetryStale && typeof temp === 'number' ? Math.min(100, Math.max(0, (temp / 45) * 100)) : 0,
                    minLabel: '0°C',
                    maxLabel: '45°C',
                    barColor: isLiveTelemetry && !isTelemetryStale && typeof temp === 'number' ? (temp >= 28 ? 'bg-[#DC2626]' : temp <= 15 ? 'bg-[#0284C7]' : 'bg-[#4E635E]') : 'bg-[#94A3B8]',
                    explanation: '',
                    reference: '',
                    extra: '',
                  },
                  {
                    title: '2. Kelembapan Udara (Relative Humidity)',
                    shortTitle: 'Kelembapan Udara',
                    channelTag: 'Sensor 2',
                    value: formatSensorValue(rh, isLiveTelemetry && !isTelemetryStale, 1),
                    unit: isLiveTelemetry && !isTelemetryStale ? '%' : '',
                    statusLabel: getSensorStatusLabel('rh', rh, isLiveTelemetry && !isTelemetryStale, undefined, isTelemetryStale),
                    isWarn: isLiveTelemetry && !isTelemetryStale && typeof rh === 'number' && rh < 35,
                    percent: isLiveTelemetry && !isTelemetryStale && typeof rh === 'number' ? Math.min(100, Math.max(0, rh)) : 0,
                    minLabel: '0%',
                    maxLabel: '100%',
                    barColor: isLiveTelemetry && !isTelemetryStale && typeof rh === 'number' ? (rh < 35 ? 'bg-[#DC2626]' : rh > 80 ? 'bg-[#0284C7]' : 'bg-[#4E635E]') : 'bg-[#94A3B8]',
                    explanation: '',
                    reference: '',
                    extra: '',
                  },
                  {
                    title: '3. Kelembapan Tanah (Soil Moisture)',
                    shortTitle: 'Kelembapan Tanah',
                    channelTag: 'Sensor 3',
                    value: formatSensorValue(soilMoisture, isLiveTelemetry && !isTelemetryStale, 1),
                    unit: isLiveTelemetry && !isTelemetryStale ? '%' : '',
                    statusLabel: getSensorStatusLabel('soil', soilMoisture, isLiveTelemetry && !isTelemetryStale, undefined, isTelemetryStale),
                    isWarn: isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' && soilMoisture < 25,
                    percent: isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? Math.min(100, Math.max(0, soilMoisture)) : 0,
                    minLabel: '0%',
                    maxLabel: '100%',
                    barColor: isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? (soilMoisture < 25 ? 'bg-[#DC2626]' : soilMoisture > 75 ? 'bg-[#0284C7]' : 'bg-[#84CC16]') : 'bg-[#94A3B8]',
                    explanation: '',
                    reference: '',
                    extra: '',
                  },
                  {
                    title: '4. Kualitas Udara & Gas (MQ-135)',
                    shortTitle: 'MQ-135 Gas / Air Quality',
                    channelTag: 'Sensor 4 · Hardware Terkonfirmasi',
                    value: isLiveTelemetry && !isTelemetryStale
                      ? (typeof gasPpm === 'number'
                          ? formatSensorValue(gasPpm, true, 0)
                          : typeof mq135Raw === 'number'
                            ? formatSensorValue(mq135Raw, true, 0)
                            : 'Unavailable')
                      : 'Unavailable',
                    unit: isLiveTelemetry && !isTelemetryStale ? (typeof gasPpm === 'number' ? 'ppm' : typeof mq135Raw === 'number' ? 'ADC' : '') : '',
                    statusLabel: isLiveTelemetry && !isTelemetryStale
                      ? (typeof gasPpm === 'number'
                          ? getSensorStatusLabel('mq135', gasPpm, true)
                          : typeof mq135Raw === 'number'
                            ? 'RAW ADC'
                            : (isTelemetryStale ? 'STALE' : 'NOT CONNECTED'))
                      : (isTelemetryStale ? 'STALE' : 'NOT CONNECTED'),
                    isWarn: isLiveTelemetry && !isTelemetryStale && ((typeof gasPpm === 'number' && gasPpm >= 800) || (typeof mq135Raw === 'number' && mq135Raw >= 2500)),
                    percent: isLiveTelemetry && !isTelemetryStale
                      ? (typeof gasPpm === 'number'
                          ? Math.min(100, Math.max(0, (gasPpm / 2000) * 100))
                          : typeof mq135Raw === 'number'
                            ? Math.min(100, Math.max(0, (mq135Raw / 4095) * 100))
                            : 0)
                      : 0,
                    minLabel: isLiveTelemetry && !isTelemetryStale && typeof gasPpm === 'number' ? '0 ppm' : '0 ADC',
                    maxLabel: isLiveTelemetry && !isTelemetryStale && typeof gasPpm === 'number' ? '2000 ppm' : '4095 ADC',
                    barColor: isLiveTelemetry && !isTelemetryStale && ((typeof gasPpm === 'number' && gasPpm >= 800) || (typeof mq135Raw === 'number' && mq135Raw >= 2500)) ? 'bg-[#DC2626]' : isLiveTelemetry && !isTelemetryStale ? 'bg-[#4E635E]' : 'bg-[#94A3B8]',
                    explanation: '',
                    reference: '',
                    extra: '',
                  },
                  {
                    title: '5. Deteksi Api (Flame Sensor)',
                    shortTitle: 'Flame Sensor',
                    channelTag: 'Sensor 5 · Hardware Terkonfirmasi',
                    value: formatSensorValue(flameDetected, isLiveTelemetry && !isTelemetryStale, 0),
                    unit: isLiveTelemetry && !isTelemetryStale && typeof flameDetected === 'number' ? (flameDetected > 0 ? 'FLAME' : 'CLEAR') : '',
                    statusLabel: getSensorStatusLabel('flame', flameDetected, isLiveTelemetry && !isTelemetryStale, undefined, isTelemetryStale),
                    isWarn: isLiveTelemetry && !isTelemetryStale && typeof flameDetected === 'number' && flameDetected > 0,
                    percent: isLiveTelemetry && !isTelemetryStale && typeof flameDetected === 'number' ? (flameDetected > 0 ? 100 : 0) : 0,
                    minLabel: '0 (Aman)',
                    maxLabel: '1 (Api)',
                    barColor: isLiveTelemetry && !isTelemetryStale && typeof flameDetected === 'number' && flameDetected > 0 ? 'bg-[#DC2626]' : isLiveTelemetry && !isTelemetryStale ? 'bg-[#4E635E]' : 'bg-[#94A3B8]',
                    explanation: '',
                    reference: '',
                    extra: '',
                  },
                  {
                    title: '6. Indeks Serasah & Angin (FWI Engine)',
                    shortTitle: 'Fine Fuel & Wind (FFMC)',
                    channelTag: 'model_hazard.h · FWI',
                    value: formatSensorValue(ffmc, isLiveTelemetry && !isTelemetryStale, 1),
                    unit: isLiveTelemetry && !isTelemetryStale && typeof wind === 'number' ? `idx (Wind ${wind.toFixed(1)} km/h)` : (isLiveTelemetry && !isTelemetryStale ? 'idx' : ''),
                    statusLabel: getSensorStatusLabel('ffmc', ffmc, isLiveTelemetry && !isTelemetryStale, undefined, isTelemetryStale),
                    isWarn: isLiveTelemetry && !isTelemetryStale && typeof ffmc === 'number' && ffmc >= 89.5,
                    percent: isLiveTelemetry && !isTelemetryStale && typeof ffmc === 'number' ? Math.min(100, Math.max(0, ffmc)) : 0,
                    minLabel: '0 idx',
                    maxLabel: '100 idx',
                    barColor: isLiveTelemetry && !isTelemetryStale && typeof ffmc === 'number' ? (ffmc >= 89.5 ? 'bg-[#DC2626]' : ffmc >= 82 ? 'bg-[#D97706]' : 'bg-[#4E635E]') : 'bg-[#94A3B8]',
                    explanation: '',
                    reference: '',
                    extra: '',
                  },
                ].map((card) => (
                  <article
                    key={card.title}
                    className="flora-card flora-card-interactive p-5 lg:p-6 flex flex-col justify-between shadow-xs hover:shadow-md transition-all duration-200"
                  >
                    <div className="flex flex-col">
                      <div>
                        {/* Header: Channel tag + Status Pill */}
                        <div className="flex justify-between items-start mb-2 gap-2 min-h-11">
                          <div className="min-w-0">
                            <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-wider block font-mono truncate">
                              {card.channelTag}
                            </span>
                            <h3 className="text-xs sm:text-sm font-bold text-[#263A35] font-display mt-0.5 truncate">
                              {card.shortTitle}
                            </h3>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-2.5 py-1 rounded-full border flex items-center gap-1.5 uppercase tracking-wide shrink-0 whitespace-nowrap shadow-2xs ${
                              card.isWarn
                                ? 'bg-[#FEEAEA] text-[#961C1C] border-[#FCCECE]'
                                : 'bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                card.isWarn ? 'bg-[#DC2626] animate-pulse' : 'bg-[#4E635E]'
                              }`}
                            />
                            {card.statusLabel}
                          </span>
                        </div>

                        {/* Large Value Display (Hidden when Unavailable) */}
                        {card.value && card.value !== 'Unavailable' ? (
                          <div className="my-2 flex items-baseline gap-2 flex-wrap">
                            <span className="text-3xl lg:text-4xl font-extrabold font-tabular text-[#263A35] tracking-tight">
                              {card.value}
                            </span>
                            <span className="text-xs sm:text-sm font-bold text-[#50645F] font-display whitespace-nowrap">
                              {card.unit}
                            </span>
                          </div>
                        ) : null}

                        {/* Visual Range Spectrum Gauge */}
                        <div className="my-2.5 bg-[#F5F4EE] p-2.5 rounded-xl border border-[#E2E0CB]">
                          <div className="flex justify-between items-center text-[10px] font-mono text-[#50645F] mb-1">
                            <span>Range Spectrum</span>
                            <span className="font-bold text-[#263A35]">{card.percent.toFixed(0)}% scale</span>
                          </div>
                          <div className="w-full h-1.5 bg-[#E2E0CB] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full flora-meter-bar ${card.barColor}`}
                              style={{ width: `${card.percent}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[9px] font-mono text-[#50645F]/80 mt-1">
                            <span>{card.minLabel}</span>
                            <span>{card.maxLabel}</span>
                          </div>
                        </div>

                        {/* Descriptive Context */}
                        {card.explanation ? (
                          <p className="text-xs text-[#50645F] leading-relaxed my-2 min-h-11">
                            {card.explanation}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {/* Metadata Footer */}
                    {card.reference || card.extra ? (
                      <div className="pt-3 mt-3 border-t border-[#D6DCCE] flex items-center justify-between gap-2 text-[10px] min-h-8.5">
                        {card.reference ? (
                          <span className="font-semibold text-[#4E635E] bg-[#F5F4EE] px-2 py-0.5 rounded-md border border-[#E2E0CB] font-mono shrink-0 truncate max-w-[62%]">
                            {card.reference}
                          </span>
                        ) : null}
                        {card.extra ? (
                          <span className="font-tabular text-[#50645F] font-medium truncate text-right">
                            {card.extra}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

            {/* DEDICATED VIEW: MODEL 1 — FOREST FIRE HAZARD (model_hazard.h) */}
            {currentTab === 'model_hazard' && (
              <Model1HazardView
                hazardResult={hazardResult}
                temp={temp}
                rh={rh}
                wind={wind}
                rain={rain}
                ffmc={ffmc}
                dmc={dmc}
                dc={dc}
                isi={isi}
                isLiveTelemetry={isLiveTelemetry}
                isTelemetryStale={isTelemetryStale}
              />
            )}

            {/* DEDICATED VIEW: MODEL 2 — BOTANICAL & ENVIRONMENTAL RISK (grenvis_sensor_model.h) */}
            {currentTab === 'model_botanical' && (
              <Model2BotanicalView
                floraResult={floraResult}
                temp={temp}
                rh={rh}
                soilMoisture={soilMoisture}
                history={history}
                wateringHistory={wateringEvents}
                isLiveTelemetry={isLiveTelemetry}
                isTelemetryStale={isTelemetryStale}
              />
            )}

            {/* DUAL AI ANALYSIS GRID (model_hazard.h + AI Vision / Botanical Neural Network) */}
            {(currentTab === 'overview' || currentTab === 'all') && (
              <>
                <div className="scroll-mt-6 sm:scroll-mt-8 grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch" id="analysis">
              {/* Left: model_hazard.h Analysis Card */}
              <section className="flora-card p-5 sm:p-6 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="flex justify-between items-start mb-4 gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
                          Edge C Random Forest Engine · model_hazard.h
                        </span>
                        <span className="text-[9px] font-semibold bg-[#EFF3EF] text-[#263A35] px-2 py-0.5 rounded-full border border-[#A6B49E] shrink-0">
                          100 Trees · m2cgen
                        </span>
                      </div>
                      <h2 className="text-base font-bold text-[#263A35] font-display mt-0.5">
                        Forest Fire Hazard &amp; FWI Risk Analysis
                      </h2>
                    </div>

                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
                        !isLiveTelemetry || isTelemetryStale || !hazardResult
                          ? 'bg-[#EFF3EF] text-[#50645F] border-[#D6DCCE]'
                          : hazardResult.riskLevel === 'HIGH'
                          ? 'bg-[#FEEAEA] text-[#961C1C] border-[#FCCECE]'
                          : hazardResult.riskLevel === 'MODERATE'
                          ? 'bg-[#FEF7E8] text-[#8A570C] border-[#FDE3B5]'
                          : 'bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          !isLiveTelemetry || isTelemetryStale || !hazardResult
                            ? 'bg-[#A6B49E]'
                            : hazardResult.riskLevel === 'HIGH'
                            ? 'bg-[#DC2626]'
                            : hazardResult.riskLevel === 'MODERATE'
                            ? 'bg-[#D97706]'
                            : 'bg-[#4E635E]'
                        }`}
                      />
                      {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.riskLevel} RISK` : 'STANDBY'}
                    </span>
                  </div>

                  <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-4 my-2 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block">
                        Assessed Fire Hazard Level
                      </span>
                      <span className="text-lg font-bold text-[#263A35] font-display block mt-0.5">
                        {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.riskLevel} Risk (${hazardResult.kaggleBinaryPrediction})` : '--'}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-semibold text-[#50645F] uppercase tracking-wider block">
                        Model Confidence
                      </span>
                      <span className="text-base font-bold font-tabular text-[#4E635E] block mt-0.5">
                        {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.confidence.toFixed(2)}%` : '--'}
                      </span>
                    </div>
                  </div>

                  {/* 3 Class Probabilities from model_hazard.h */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-2.5 my-3">
                    <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-[#D6DCCE] shadow-xs flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-[10px] font-semibold text-[#50645F] uppercase block truncate">
                            High Risk [0]
                          </span>
                          <span className="w-1.5 h-1.5 rounded-full bg-[#961C1C] shrink-0" />
                        </div>
                        <span className="text-sm sm:text-base font-bold font-tabular text-[#961C1C] block mt-0.5 whitespace-nowrap">
                          {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.highProbability.toFixed(2)}%` : '--'}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#E2E0CB] rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-[#961C1C] rounded-full flora-meter-bar"
                          style={{ width: `${isLiveTelemetry && !isTelemetryStale && hazardResult ? Math.min(100, Math.max(0, hazardResult.highProbability)) : 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-[#D6DCCE] shadow-xs flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-[10px] font-semibold text-[#50645F] uppercase block truncate">
                            Moderate [2]
                          </span>
                          <span className="w-1.5 h-1.5 rounded-full bg-[#8A570C] shrink-0" />
                        </div>
                        <span className="text-sm sm:text-base font-bold font-tabular text-[#8A570C] block mt-0.5 whitespace-nowrap">
                          {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.moderateProbability.toFixed(2)}%` : '--'}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#E2E0CB] rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-[#8A570C] rounded-full flora-meter-bar"
                          style={{ width: `${isLiveTelemetry && !isTelemetryStale && hazardResult ? Math.min(100, Math.max(0, hazardResult.moderateProbability)) : 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-[#D6DCCE] shadow-xs flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-[10px] font-semibold text-[#50645F] uppercase block truncate">
                            Low Risk [1]
                          </span>
                          <span className="w-1.5 h-1.5 rounded-full bg-[#4E635E] shrink-0" />
                        </div>
                        <span className="text-sm sm:text-base font-bold font-tabular text-[#4E635E] block mt-0.5 whitespace-nowrap">
                          {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.lowProbability.toFixed(2)}%` : '--'}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#E2E0CB] rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-[#4E635E] rounded-full flora-meter-bar"
                          style={{ width: `${isLiveTelemetry && !isTelemetryStale && hazardResult ? Math.min(100, Math.max(0, hazardResult.lowProbability)) : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Right: AI Vision Canopy & Smoke/Fire Analysis Card */}
              <section className="flora-card p-5 sm:p-6 lg:p-6 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
                        Software AI Vision Engine · Topologi Kamera Sensor
                      </span>
                      <h2 className="text-base font-bold text-[#263A35] font-display mt-0.5">
                        Optical Canopy &amp; Plume Classification
                      </h2>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full border flex items-center gap-1.5 bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4E635E]" />
                      ESP32-CAM Vision
                    </span>
                  </div>

                  <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-4 mb-4 flex justify-between items-center">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#50645F] tracking-wider block">
                        Dominant Optical Classification
                      </span>
                      <span className="text-lg font-bold text-[#263A35] font-display block mt-0.5">
                        {wildfireResult ? visionPrediction : edgePrediction ? `${edgePrediction} (Edge AI)` : 'Standby / Belum Dianalisis'}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-semibold text-[#50645F] uppercase tracking-wider block">
                        Sumber Citra
                      </span>
                      <span className="text-xs font-bold font-tabular text-[#4E635E] block mt-0.5">
                        {captureSource === 'camera'
                          ? 'Webcam Lokal'
                          : captureSource === 'upload'
                          ? 'Unggahan Manual'
                          : captureSource === 'gateway'
                          ? 'Gateway ESP32-CAM'
                          : 'Standby'}
                      </span>
                    </div>
                  </div>

                  {wildfireResult ? (
                    <div className="space-y-3.5 my-3">
                      {[
                        {
                          label: 'Healthy Forest Canopy (Normal)',
                          value: visionProbs.healthy,
                          color: '#4E635E',
                        },
                        {
                          label: 'Smoke Plume / Haze Indication',
                          value: visionProbs.smoke,
                          color: '#EA580C',
                        },
                        {
                          label: 'Active Surface Fire / Thermal Glow',
                          value: visionProbs.fire,
                          color: '#B43E1F',
                        },
                      ].map((bar) => (
                        <div key={bar.label}>
                          <div className="flex justify-between text-xs font-semibold text-[#263A35] mb-1.5">
                            <span>{bar.label}</span>
                            <span className="font-tabular text-[#50645F]">{bar.value.toFixed(1)}%</span>
                          </div>
                          <div className="h-2.5 rounded-full bg-[#E2E0CB] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${bar.value}%`, backgroundColor: bar.color }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-4 px-3 my-3 text-center text-xs text-[#50645F] bg-[#EFF3EF] rounded-lg border border-[#D6DCCE]">
                      <p className="font-semibold text-[#263A35] mb-0.5">Belum Ada Inferensi Citra Visual</p>
                      <p className="text-[11px] m-0">
                        {edgePrediction
                          ? `Hasil Edge AI firmware: ${edgePrediction}${edgeConfidence !== null ? ` (Confidence: ${(edgeConfidence * 100).toFixed(0)}%)` : ''}. Jalankan Analisis Karhutla untuk inferensi cloud.`
                          : 'Distribusi probabilitas visual hanya ditampilkan dari model inferensi citra terverifikasi.'}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* 4. KAGGLE DATASET INFORMATION & BENCHMARKS SECTION */}
            <FloraKaggleSection />
          </>
        )}

            {/* 5. CAMERA STREAM CAPTURE SECTION (#cameraCapture) */}
            {(currentTab === 'overview' || currentTab === 'all' || currentTab === 'model_vision') && (
            <section id="cameraCapture" className="scroll-mt-6 sm:scroll-mt-8 flora-card p-5 sm:p-6 shadow-xs">
              {/* Header Bar with Title and Domain Selector */}
              <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
                <div>
                  <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
                    Camera Subsystem · Edge &amp; Cloud AI Vision
                  </span>
                  <h2 className="text-lg font-bold text-[#263A35] font-display mt-0.5">
                    {visionDomain === 'wildfire'
                      ? 'Pemindaian Kanopi & Verifikasi Visual Titik Api'
                      : 'Diagnosa Penyakit Daun & Patologi Tanaman'}
                  </h2>
                </div>

                {/* Domain Selector & Status Pill */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Domain Toggle Tabs */}
                  <div className="flex p-0.5 rounded-full bg-[#E2E0CB] border border-[#D6DCCE]">
                    <button
                      type="button"
                      onClick={() => handleDomainChange('wildfire')}
                      className={`text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1.5 transition-all cursor-pointer ${
                        visionDomain === 'wildfire'
                          ? 'bg-[#4E635E] text-white shadow-xs'
                          : 'text-[#263A35] hover:text-[#4E635E]'
                      }`}
                      aria-pressed={visionDomain === 'wildfire'}
                    >
                      <Flame size={12} />
                      <span>Karhutla (Wildfire)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDomainChange('leaf_disease')}
                      className={`text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1.5 transition-all cursor-pointer ${
                        visionDomain === 'leaf_disease'
                          ? 'bg-[#4E635E] text-white shadow-xs'
                          : 'text-[#263A35] hover:text-[#4E635E]'
                      }`}
                      aria-pressed={visionDomain === 'leaf_disease'}
                    >
                      <Leaf size={12} />
                      <span>Penyakit Daun</span>
                    </button>
                  </div>

                  {/* Optical State Indicator Badge */}
                  <span className="text-xs font-semibold px-2.5 py-1.5 rounded-full border flex items-center gap-1.5 bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        cameraStatus === 'streaming'
                          ? isVideoReady
                            ? 'bg-[#22C55E] animate-pulse'
                            : 'bg-[#EAB308] animate-pulse'
                          : cameraStatus === 'captured'
                          ? 'bg-[#4E635E]'
                          : cameraStatus === 'permission_denied' || cameraStatus === 'device_error'
                          ? 'bg-[#EF4444]'
                          : 'bg-[#9CA3AF]'
                      }`}
                    />
                    <span>
                      {cameraStatus === 'streaming'
                        ? isVideoReady
                          ? 'Kamera Live Aktif'
                          : 'Memuat Stream Kamera...'
                        : cameraStatus === 'captured'
                        ? 'Frame Siap Dianalisis'
                        : cameraStatus === 'permission_denied'
                        ? 'Izin Kamera Ditolak'
                        : cameraStatus === 'device_error'
                        ? 'Kamera Tidak Tersedia'
                        : 'Kamera Siap'}
                    </span>
                  </span>
                </div>
              </div>

              {/* Action Toolbar: Camera Live vs Upload vs Retake vs Analyze */}
              <div className="flex flex-wrap justify-between items-center gap-2 mb-4 p-2.5 rounded-xl bg-[#F5F4EE] border border-[#E2E0CB]">
                <div className="flex items-center gap-2 flex-wrap">
                  {cameraStatus === 'streaming' ? (
                    <>
                      <button
                        type="button"
                        onClick={handleCaptureFromVideo}
                        disabled={!isVideoReady}
                        className="text-xs font-semibold px-3.5 py-1.5 rounded-full bg-[#4E635E] hover:bg-[#3B4D49] text-white flex items-center gap-1.5 transition-all shadow-xs cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Camera size={13} />
                        <span>{isVideoReady ? 'Ambil Foto Frame' : 'Menyiapkan Kamera...'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleStopCamera}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white hover:bg-[#EFF3EF] text-[#263A35] border border-[#D6DCCE] flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <VideoOff size={13} />
                        <span>Tutup Kamera</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleStartCamera}
                        className="text-xs font-semibold px-3.5 py-1.5 rounded-full bg-[#4E635E] hover:bg-[#3B4D49] text-white flex items-center gap-1.5 transition-all shadow-xs cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E]"
                      >
                        <Video size={13} />
                        <span>Buka Kamera Laptop/HP</span>
                      </button>

                      <label className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white hover:bg-[#EFF3EF] text-[#263A35] border border-[#D6DCCE] flex items-center gap-1.5 transition-all cursor-pointer shadow-xs">
                        <Upload size={13} />
                        <span>Unggah Foto</span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileChange}
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => handleFetchGatewayFrame(true)}
                        disabled={isFetchingGatewayFrame}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white hover:bg-[#EFF3EF] text-[#263A35] border border-[#D6DCCE] flex items-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                        title="Ambil frame JPEG terbaru dari cache gateway (/api/vision/latest-frame.jpg)"
                      >
                        <Camera size={13} />
                        <span>{isFetchingGatewayFrame ? 'Memuat Gateway...' : 'Ambil Frame Gateway (ESP32-CAM)'}</span>
                      </button>
                    </>
                  )}

                  {capturedBlob && (
                    <button
                      type="button"
                      onClick={handleRetake}
                      disabled={isCapturing}
                      className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white hover:bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA] flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw size={13} />
                      <span>Ulangi / Ganti Foto</span>
                    </button>
                  )}
                </div>

                {/* Main Analyze Button */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAnalyzeImage}
                    disabled={!capturedBlob || isCapturing}
                    aria-busy={isCapturing}
                    className="text-xs font-semibold px-4 py-1.5 rounded-full bg-[#263A35] hover:bg-[#1A2522] text-[#E2E0CB] flex items-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#263A35]"
                  >
                    {isCapturing ? (
                      <>
                        <span className="inline-block animate-spin">⏳</span>
                        <span>Menganalisis...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} className="text-[#5DD62C]" />
                        <span>
                          {visionDomain === 'wildfire' ? 'Analisis Karhutla (Railway API)' : 'Diagnosa Penyakit Daun'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Error Banner if Inference or Camera Failed */}
              {inferenceError && (
                <div className="mb-4 p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-2.5 text-xs text-[#991B1B]">
                  <AlertCircle size={15} className="shrink-0 mt-0.5 text-[#DC2626]" />
                  <div className="flex-1">
                    <span className="font-bold block">Pemberitahuan Sistem:</span>
                    <p className="mt-0.5 leading-relaxed m-0">{inferenceError}</p>
                  </div>
                </div>
              )}

              {/* Main 2-Column Content Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
                {/* Left: Video / Image Viewport */}
                <div className="lg:col-span-2 relative min-h-85 xl:min-h-95 bg-[#1A2522] border border-[#D6DCCE] rounded-2xl overflow-hidden flex flex-col items-center justify-center text-center shadow-xs">
                  {cameraStatus === 'streaming' ? (
                    <>
                      <video
                        ref={setVideoElement}
                        autoPlay
                        playsInline
                        muted
                        onLoadedMetadata={(e) => {
                          const v = e.currentTarget;
                          if (v.videoWidth > 0 && v.videoHeight > 0) {
                            setIsVideoReady(true);
                          }
                          v.play().catch((playErr: unknown) => {
                            if (playErr instanceof DOMException && playErr.name === 'AbortError') return;
                            const msg = playErr instanceof Error ? playErr.message : 'Browser memblokir pemutaran otomatis.';
                            setInferenceError(`Gagal memutar preview kamera: ${msg}`);
                          });
                        }}
                        onPlaying={(e) => {
                          const v = e.currentTarget;
                          if (v.videoWidth > 0 && v.videoHeight > 0) {
                            setIsVideoReady(true);
                          }
                        }}
                        onError={() => {
                          setIsVideoReady(false);
                          setCameraStatus('device_error');
                          setInferenceError('Terjadi kesalahan pada decoding stream video kamera.');
                        }}
                        className="w-full h-full object-cover absolute inset-0"
                      />
                      {/* Live Stream Top HUD */}
                      <div className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-lg bg-[#23312E]/90 text-[#E2E0CB] text-[10px] font-mono border border-[#364844] flex items-center gap-1.5 shadow-xs">
                        <span className={`w-2 h-2 rounded-full ${isVideoReady ? 'bg-[#22C55E] animate-ping' : 'bg-[#EAB308]'}`} />
                        <span>{isVideoReady ? 'LIVE DEVICE CAMERA · MEDIASTREAM' : 'MEMUAT FEED KAMERA...'}</span>
                      </div>
                    </>
                  ) : previewUrl ? (
                    <>
                      <img
                        src={previewUrl}
                        alt="Captured frame ready for analysis"
                        className="w-full h-full object-cover absolute inset-0"
                      />
                      {/* Captured Frame HUD */}
                      <div className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-lg bg-[#23312E]/90 text-[#E2E0CB] text-[10px] font-mono border border-[#364844] flex items-center gap-1.5 shadow-xs">
                        <CheckCircle2 size={12} className="text-[#5DD62C]" />
                        <span>
                          {captureSource === 'camera'
                            ? 'FRAME FOTO KAMERA'
                            : captureSource === 'gateway'
                            ? `FRAME GATEWAY ESP32-CAM${gatewayFrameMeta ? ` · ${(gatewayFrameMeta.byteLength / 1024).toFixed(1)} KB${gatewayFrameMeta.isStale ? ' (STALE)' : ''}` : ''}`
                            : 'UNGGAHAN GAMBAR'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="relative z-10 p-6 max-w-sm flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-[#23312E]/90 border border-[#364844] flex items-center justify-center text-[#5DD62C] shadow-md">
                          <Camera size={24} />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-[#F4F7F5]">
                            {visionDomain === 'wildfire'
                              ? 'Kamera Pemantau Kanopi Hutan'
                              : 'Kamera Diagnosa Patologi Daun'}
                          </h3>
                          <p className="text-xs text-[#A6B49E] mt-1 leading-relaxed">
                            Buka kamera laptop/smartphone, muat frame dari gateway ESP32-CAM, atau unggah file foto untuk verifikasi visual langsung ke model AI.
                          </p>
                        </div>
                        <div className="flex gap-2 mt-1 flex-wrap justify-center">
                          <button
                            type="button"
                            onClick={handleStartCamera}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#4E635E] hover:bg-[#3B4D49] text-white flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                          >
                            <Video size={13} />
                            <span>Buka Kamera</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFetchGatewayFrame(true)}
                            disabled={isFetchingGatewayFrame}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white hover:bg-[#EFF3EF] text-[#263A35] border border-[#D6DCCE] flex items-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                          >
                            <Camera size={13} />
                            <span>Frame Gateway</span>
                          </button>
                          <label className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#23312E] hover:bg-[#2C3B37] text-[#E2E0CB] border border-[#364844] flex items-center gap-1.5 transition-all cursor-pointer shadow-xs">
                            <Upload size={13} />
                            <span>Unggah Foto</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handleFileChange}
                            />
                          </label>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Bottom Viewport Overlay Telemetry */}
                  <div className="absolute inset-x-3 bottom-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 z-10 pointer-events-none">
                    <div className="px-2.5 py-1 rounded-lg bg-[#23312E]/90 text-[#E2E0CB] text-[10px] font-medium backdrop-blur-sm border border-[#364844] shadow-xs max-w-full truncate">
                      {visionDomain === 'wildfire'
                        ? `Mode: Karhutla · Rel: ${railPositionMm} mm · Source: ${captureSource === 'camera' ? 'Webcam' : captureSource === 'upload' ? 'Upload' : captureSource === 'gateway' ? 'Gateway ESP32-CAM' : 'Standby'}`
                        : `Mode: Diagnosa Daun · Status Layanan: ${isLeafDiseaseApiConfigured() ? 'Tersambung' : 'Belum Dideploy'}`}
                    </div>

                    <div className="flex flex-wrap items-center justify-start sm:justify-end gap-1.5">
                      {visionDomain === 'wildfire' ? (
                        wildfireResult ? (
                          <>
                            <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-[#23312E]/90 text-[#E2E0CB] text-[9px] sm:text-[10px] font-bold backdrop-blur-sm border border-[#364844] flex items-center gap-1.5 shadow-xs whitespace-nowrap">
                              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#A6B49E]" />
                              Healthy: {visionProbs.healthy.toFixed(1)}%
                            </span>
                            <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-[#23312E]/90 text-[#E2E0CB] text-[9px] sm:text-[10px] font-bold backdrop-blur-sm border border-[#364844] flex items-center gap-1.5 shadow-xs whitespace-nowrap">
                              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#FB923C]" />
                              Smoke: {visionProbs.smoke.toFixed(1)}%
                            </span>
                            <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-[#23312E]/90 text-[#E2E0CB] text-[9px] sm:text-[10px] font-bold backdrop-blur-sm border border-[#364844] flex items-center gap-1.5 shadow-xs whitespace-nowrap">
                              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#F87171]" />
                              Fire: {visionProbs.fire.toFixed(1)}%
                            </span>
                          </>
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg bg-[#23312E]/90 text-[#A6B49E] text-[10px] font-mono border border-[#364844] shadow-xs">
                            {edgePrediction ? `Edge AI: ${edgePrediction}${edgeConfidence !== null ? ` (${(edgeConfidence * 100).toFixed(0)}%)` : ''} · Cloud: Standby` : 'Inferensi Cloud Siap'}
                          </span>
                        )
                      ) : (
                        <>
                          <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-[#23312E]/90 text-[#E2E0CB] text-[9px] sm:text-[10px] font-bold backdrop-blur-sm border border-[#364844] flex items-center gap-1.5 shadow-xs whitespace-nowrap">
                            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#A6B49E]" />
                            Healthy: {leafProbs.healthy.toFixed(1)}%
                          </span>
                          <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-[#23312E]/90 text-[#E2E0CB] text-[9px] sm:text-[10px] font-bold backdrop-blur-sm border border-[#364844] flex items-center gap-1.5 shadow-xs whitespace-nowrap">
                            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#EAB308]" />
                            Powdery: {leafProbs.powdery.toFixed(1)}%
                          </span>
                          <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-[#23312E]/90 text-[#E2E0CB] text-[9px] sm:text-[10px] font-bold backdrop-blur-sm border border-[#364844] flex items-center gap-1.5 shadow-xs whitespace-nowrap">
                            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#EA580C]" />
                            Rust: {leafProbs.rust.toFixed(1)}%
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Telemetry & Classification Meters */}
                <div className="flex flex-col justify-between gap-3">
                  <div className="space-y-2.5">
                    {/* Timestamp & Engine Card */}
                    <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-3.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block">
                          Waktu Pemindaian Optik
                        </span>
                        {wildfireResult && visionDomain === 'wildfire' && (
                          <span className="text-[10px] font-mono font-bold text-[#4E635E] bg-[#EFF3EF] px-1.5 py-0.5 rounded border border-[#D6DCCE]">
                            {wildfireResult.inference_time_ms.toFixed(1)} ms
                          </span>
                        )}
                        {leafResult && visionDomain === 'leaf_disease' && (
                          <span className="text-[10px] font-mono font-bold text-[#4E635E] bg-[#EFF3EF] px-1.5 py-0.5 rounded border border-[#D6DCCE]">
                            {leafResult.inference_time_ms.toFixed(1)} ms
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-[#263A35] font-tabular block mt-1">
                        {lastCaptureTime
                          ? new Date(lastCaptureTime).toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })
                          : '--:--:--'}{' '}
                        <span className="text-xs font-normal text-[#50645F]">
                          ({captureSource === 'camera' ? 'Kamera' : captureSource === 'upload' ? 'Upload' : captureSource === 'gateway' ? 'Gateway ESP32-CAM' : 'Standby'})
                        </span>
                      </span>
                      <span className="text-[10px] text-[#50645F] block mt-1 font-mono">
                        {visionDomain === 'wildfire'
                          ? `Engine: ${wildfireResult?.model_name || 'MobileNetV2 (tes-tflite Railway)'}`
                          : `Engine: ${leafResult?.model_name || 'MobileNetV3 (PlantDoc 3-Class)'}`}
                      </span>
                    </div>

                    {/* Detected Pattern & Confidence Card */}
                    <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-3.5 flex justify-between items-center">
                      <div>
                        <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block">
                          {visionDomain === 'wildfire' ? 'Pola Citra Terdeteksi' : 'Diagnosa Penyakit Daun'}
                        </span>
                        <span className="text-sm font-bold text-[#263A35] block mt-0.5 font-display">
                          {visionDomain === 'wildfire'
                            ? visionPrediction
                            : leafPrediction || (isLeafDiseaseApiConfigured() ? 'Siap Dianalisis' : 'Layanan Belum Tersedia')}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block">
                          Keyakinan (Confidence)
                        </span>
                        <span className="text-sm font-bold text-[#4E635E] font-tabular block mt-0.5">
                          {visionDomain === 'wildfire'
                            ? wildfireResult
                              ? `${wildfireResult.confidence_percentage.toFixed(1)}%`
                              : '-'
                            : leafPrediction
                            ? `${Math.max(leafProbs.healthy, leafProbs.powdery, leafProbs.rust).toFixed(1)}%`
                            : '-'}
                        </span>
                      </div>
                    </div>

                    {/* Classification Meter Bars */}
                    <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-3.5 space-y-2.5">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block">
                          {visionDomain === 'wildfire'
                            ? 'Klasifikasi Karhutla'
                            : 'Klasifikasi Penyakit Daun (3-Kelas)'}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]">
                          {inferenceStatus === 'analyzing'
                            ? 'Memproses...'
                            : inferenceStatus === 'success'
                            ? 'Server Terverifikasi'
                            : 'Frame Teranalisis'}
                        </span>
                      </div>

                      {visionDomain === 'wildfire' ? (
                        wildfireResult ? (
                          <>
                            {/* Wildfire Bar 1: Non-Fire */}
                            <div>
                              <div className="flex justify-between text-xs font-semibold text-[#263A35] mb-1">
                                <span>Healthy Canopy (Non-Fire)</span>
                                <span className="font-tabular text-[#4E635E] font-bold">
                                  {visionProbs.healthy.toFixed(1)}%
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-[#E2E0CB] overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-[#4E635E] flora-meter-bar transition-all duration-500"
                                  style={{ width: `${Math.min(100, Math.max(0, visionProbs.healthy))}%` }}
                                />
                              </div>
                            </div>

                            {/* Wildfire Bar 2: Smoke */}
                            <div>
                              <div className="flex justify-between text-xs font-semibold text-[#263A35] mb-1">
                                <span>Smoke Plume (Smoke)</span>
                                <span className="font-tabular text-[#9A3412] font-bold">
                                  {visionProbs.smoke.toFixed(1)}%
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-[#E2E0CB] overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-[#EA580C] flora-meter-bar transition-all duration-500"
                                  style={{ width: `${Math.min(100, Math.max(0, visionProbs.smoke))}%` }}
                                />
                              </div>
                            </div>

                            {/* Wildfire Bar 3: Fire */}
                            <div>
                              <div className="flex justify-between text-xs font-semibold text-[#263A35] mb-1">
                                <span>Surface Fire (Fire)</span>
                                <span className="font-tabular text-[#7C2D12] font-bold">
                                  {visionProbs.fire.toFixed(1)}%
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-[#E2E0CB] overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-[#B43E1F] flora-meter-bar transition-all duration-500"
                                  style={{ width: `${Math.min(100, Math.max(0, visionProbs.fire))}%` }}
                                />
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="py-4 px-3 text-center text-xs text-[#50645F] bg-[#EFF3EF] rounded-lg border border-[#D6DCCE]">
                            <p className="font-semibold text-[#263A35] mb-0.5">Belum Ada Hasil Inferensi Citra</p>
                            <p className="text-[11px] m-0">Muat frame dari gateway atau unggah foto lalu klik &quot;Analisis Karhutla&quot; untuk menghasilkan skor probabilitas model.</p>
                          </div>
                        )
                      ) : (
                        <>
                          {/* Leaf Disease Bar 1: Healthy */}
                          <div>
                            <div className="flex justify-between text-xs font-semibold text-[#263A35] mb-1">
                              <span>Healthy (Daun Sehat)</span>
                              <span className="font-tabular text-[#4E635E] font-bold">
                                {leafProbs.healthy.toFixed(1)}%
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-[#E2E0CB] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[#4E635E] flora-meter-bar transition-all duration-500"
                                style={{ width: `${Math.min(100, Math.max(0, leafProbs.healthy))}%` }}
                              />
                            </div>
                          </div>

                          {/* Leaf Disease Bar 2: Powdery Mildew */}
                          <div>
                            <div className="flex justify-between text-xs font-semibold text-[#263A35] mb-1">
                              <span>Powdery Mildew (Embun Tepung)</span>
                              <span className="font-tabular text-[#CA8A04] font-bold">
                                {leafProbs.powdery.toFixed(1)}%
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-[#E2E0CB] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[#EAB308] flora-meter-bar transition-all duration-500"
                                style={{ width: `${Math.min(100, Math.max(0, leafProbs.powdery))}%` }}
                              />
                            </div>
                          </div>

                          {/* Leaf Disease Bar 3: Leaf Rust */}
                          <div>
                            <div className="flex justify-between text-xs font-semibold text-[#263A35] mb-1">
                              <span>Leaf Rust (Karat Daun)</span>
                              <span className="font-tabular text-[#C2410C] font-bold">
                                {leafProbs.rust.toFixed(1)}%
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-[#E2E0CB] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[#EA580C] flora-meter-bar transition-all duration-500"
                                style={{ width: `${Math.min(100, Math.max(0, leafProbs.rust))}%` }}
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Informational Footer Note */}
                  {visionDomain !== 'wildfire' && (
                    <div className="bg-[#F5F4EE] border border-[#E2E0CB] p-3 rounded-xl flex items-start gap-2 text-[11px] text-[#50645F] leading-relaxed">
                      <Info size={14} className="shrink-0 mt-0.5 text-[#4E635E]" />
                      <p className="m-0">
                        Domain penyakit daun terisolasi secara independen. Tidak akan memanipulasi atau mengirim data daun ke model titik api.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
            )}

            {/* 6. SCANNER CARRIAGE MANUAL CONTROL (#device-control) */}
            {(currentTab === 'overview' || currentTab === 'all') && (
              <>
                <section id="device-control" className="scroll-mt-6 sm:scroll-mt-8 flora-card p-5 sm:p-6 shadow-xs">
              <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
                <div>
                  <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
                    Actuator Subsystem · L298N Kanal OUT 3 &amp; OUT 4
                  </span>
                  <h2 className="text-lg font-bold text-[#263A35] font-display">
                    Scanner Carriage Motor Rel (OUT3 &amp; OUT4) — {railPositionMm} / 1200 mm
                  </h2>
                </div>
                <span className="text-xs font-semibold px-3 py-1 rounded-full border bg-[#EFF3EF] text-[#4E635E] border-[#A6B49E] flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                  <span className={`w-2 h-2 rounded-full ${isLiveTelemetry && !isTelemetryStale ? 'bg-[#16A34A] animate-pulse' : 'bg-[#4E635E]'}`} />
                  {movementStatus === 'idle'
                    ? `${motorDriverInfo} STANDBY`
                    : `${motorDriverInfo} · ${movementStatus.replace(/_/g, ' ').toUpperCase()}`}
                </span>
              </div>

              {/* Visual Rail Track Progress Bar */}
              <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-4 mb-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1.5 text-xs font-bold text-[#263A35] mb-2 font-tabular">
                  <span className={limitLeft ? 'text-[#DC2626]' : 'text-[#4E635E]'}>
                    SW1 Left: {limitLeft ? 'ACTIVE (0mm)' : 'CLEAR'}
                  </span>
                  <span className="text-[#4E635E]">
                    Carriage Position: {railPositionMm !== null ? `${railPositionMm} mm (${((railPositionMm / 1200) * 100).toFixed(0)}%)` : 'Indeterminate (Standby)'}
                  </span>
                  <span className={limitRight ? 'text-[#DC2626]' : 'text-[#4E635E]'}>
                    SW2 Right: {limitRight ? 'ACTIVE (1200mm)' : 'CLEAR'}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-[#E2E0CB] relative overflow-hidden">
                  <div
                    className="h-full bg-[#4E635E] rounded-full transition-all duration-300"
                    style={{ width: `${railPositionMm !== null ? (railPositionMm / 1200) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {/* Fail-Closed Actuator Safety Gate Banner */}
              <div className="bg-[#FEF7E8] border border-[#FDE3B5] rounded-xl p-3 mb-4 flex items-start gap-2.5 text-xs text-[#8A570C]">
                <span className="text-base leading-none shrink-0" aria-hidden="true">🔒</span>
                <div>
                  <span className="font-bold block">Fail-Closed Safety Gate Aktif</span>
                  <p className="m-0 text-[11px] leading-relaxed">
                    Kontrol rel motor L298N (L/R/S) dan trigger rana kamera (C) dinonaktifkan dalam mode Read-Only via Backend Gateway demi keamanan aktuator fisik.
                  </p>
                </div>
              </div>

              <div
                className="grid grid-cols-2 sm:grid-cols-4 gap-3"
                role="group"
                aria-label="Kontrol Scanner Motor Rel L298N (Dinonaktifkan - Fail Closed)"
              >
                <button
                  onClick={() => handleRailCommand('L')}
                  disabled={true}
                  aria-disabled="true"
                  aria-label="Gerakkan kamera rel ke kiri (L) - dinonaktifkan (Fail-Closed Gate)"
                  className="min-h-11 py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border shadow-xs bg-[#F5F4EE] text-[#50645F] border-[#D6DCCE] opacity-60 cursor-not-allowed"
                >
                  <span aria-hidden="true">◀</span>
                  <span>Move Left (L)</span>
                </button>

                <button
                  onClick={() => handleRailCommand('S')}
                  disabled={true}
                  aria-disabled="true"
                  aria-label="Hentikan darurat motor rel (S) - dinonaktifkan (Fail-Closed Gate)"
                  className="min-h-11 py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border shadow-xs bg-[#F5F4EE] text-[#50645F] border-[#D6DCCE] opacity-60 cursor-not-allowed"
                >
                  <span aria-hidden="true">■</span>
                  <span>Stop Motor (S)</span>
                </button>

                <button
                  onClick={() => handleRailCommand('R')}
                  disabled={true}
                  aria-disabled="true"
                  aria-label="Gerakkan kamera rel ke kanan (R) - dinonaktifkan (Fail-Closed Gate)"
                  className="min-h-11 py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border shadow-xs bg-[#F5F4EE] text-[#50645F] border-[#D6DCCE] opacity-60 cursor-not-allowed"
                >
                  <span>Move Right (R)</span>
                  <span aria-hidden="true">▶</span>
                </button>

                <button
                  onClick={() => handleRailCommand('C')}
                  disabled={true}
                  aria-disabled="true"
                  aria-label="Trigger tangkapan foto kamera pada posisi rel (C) - dinonaktifkan (Fail-Closed Gate)"
                  className="min-h-11 py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border shadow-xs bg-[#F5F4EE] text-[#50645F] border-[#D6DCCE] opacity-60 cursor-not-allowed"
                >
                  <span aria-hidden="true">◉</span>
                  <span>Capture Photo (C)</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors rounded-xl p-3 flex items-center justify-between shadow-2xs">
                  <span className="text-[10px] font-semibold text-[#50645F] uppercase tracking-wider">
                    Command Dispatch
                  </span>
                  <span className="text-xs font-bold text-[#263A35] capitalize">
                    {movementStatus.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors rounded-xl p-3 flex items-center justify-between shadow-2xs">
                  <span className="text-[10px] font-semibold text-[#50645F] uppercase tracking-wider">
                    Last Command Sent
                  </span>
                  <span className="text-xs font-bold font-tabular text-[#263A35]">
                    {lastCommand ? `Cmd '${lastCommand}'` : 'None'}
                  </span>
                </div>
                <div className="bg-[#F5F4EE] border border-[#E2E0CB] hover:border-[#818C78] transition-colors rounded-xl p-3 flex items-center justify-between shadow-2xs">
                  <span className="text-[10px] font-semibold text-[#50645F] uppercase tracking-wider">
                    Limit Switches
                  </span>
                  <div className="flex items-center gap-2 text-xs font-bold font-tabular">
                    <span className={limitLeft ? 'text-[#DC2626]' : 'text-[#4E635E]'}>
                      L: {limitLeft ? 'ACTIVE' : 'CLEAR'}
                    </span>
                    <span className="text-[#50645F]/40">|</span>
                    <span className={limitRight ? 'text-[#DC2626]' : 'text-[#4E635E]'}>
                      R: {limitRight ? 'ACTIVE' : 'CLEAR'}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* 7. TREATMENT & IRRIGATION / SUPPRESSION GUIDANCE (#treatment) */}
            <div className="scroll-mt-6 sm:scroll-mt-8 grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch" id="treatment">
              {/* Left: Treatment & Action Guidance */}
              <section className="flora-card p-5 sm:p-6 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
                        Forestry &amp; Agronomic Decision Support
                      </span>
                      <h2 className="text-base font-bold text-[#263A35] font-display">
                        Mitigation &amp; Action Guidance (SOP)
                      </h2>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                        !isLiveTelemetry || isTelemetryStale || !hazardResult
                          ? 'bg-[#EFF3EF] text-[#50645F] border-[#D6DCCE]'
                          : hazardResult.riskLevel === 'HIGH'
                          ? 'bg-[#FEEAEA] text-[#961C1C] border-[#FCCECE]'
                          : hazardResult.riskLevel === 'MODERATE'
                          ? 'bg-[#FEF7E8] text-[#8A570C] border-[#FDE3B5]'
                          : 'bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]'
                      }`}
                    >
                      {isLiveTelemetry && !isTelemetryStale && hazardResult ? `${hazardResult.riskLevel} Priority` : 'STANDBY'}
                    </span>
                  </div>

                  <div className="my-3">
                    <span className="text-xs font-bold text-[#263A35] block mb-2 font-display uppercase tracking-wider">
                      Recommended Action Checklist:
                    </span>
                    <ul className="text-xs text-[#263A35] space-y-2 pl-4 list-disc font-medium">
                      {isLiveTelemetry && !isTelemetryStale && typeof ffmc === 'number' && ffmc >= 89.5 && (
                        <li className="leading-relaxed">
                          <strong>FFMC Kritis ({ffmc.toFixed(1)} ≥ 89.5):</strong> Aktifkan penyiraman kabut (misting) pada zona penyangga untuk menurunkan keterbakaran serasah permukaan.
                        </li>
                      )}
                      {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' && soilMoisture < 35 && (
                        <li className="leading-relaxed">
                          <strong>Defisit Kelembapan Tanah ({soilMoisture.toFixed(1)}%):</strong> Lakukan irigasi bertahap untuk menjaga hidrasi perakaran dan menurunkan DMC.
                        </li>
                      )}
                      {isLiveTelemetry && !isTelemetryStale && typeof wind === 'number' && wind >= 5.5 && (
                        <li className="leading-relaxed">
                          <strong>Kecepatan Angin Tinggi ({wind.toFixed(1)} km/h):</strong> Pantau arah angin karena nilai ISI ({typeof isi === 'number' ? isi.toFixed(1) : '--'}) dapat mempercepat laju rambat api.
                        </li>
                      )}
                      {(!isLiveTelemetry || isTelemetryStale) && (
                        <li className="leading-relaxed text-[#50645F]">
                          Menunggu stream telemetri aktif gateway untuk mengevaluasi checklist mitigasi secara live.
                        </li>
                      )}
                      <li className="leading-relaxed">
                        Verifikasi visual berkala menggunakan carriage kamera ESP32-CAM sepanjang rel 1200 mm.
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#D6DCCE]">
                  <p className="text-[11px] text-[#50645F] leading-relaxed m-0">
                    Rekomendasi disusun otomatis berdasarkan output <code className="font-mono text-[#4E635E]">model_hazard.h</code> dan <code className="font-mono text-[#4E635E]">grenvis_sensor_model.h</code>.
                  </p>
                </div>
              </section>

              {/* Right: Irrigation & Canopy Cooling Log */}
              <section className="flora-card p-5 sm:p-6 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
                        Irrigation &amp; Litter Wetting
                      </span>
                      <span className="text-[11px] font-tabular text-[#50645F]">
                        Soil moisture: <strong className="text-[#263A35]">{isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? `${soilMoisture.toFixed(1)}%` : 'Unavailable'}</strong> · FFMC:{' '}
                        <strong className="text-[#263A35]">{isLiveTelemetry && !isTelemetryStale && typeof ffmc === 'number' ? ffmc.toFixed(1) : 'Unavailable'}</strong>
                      </span>
                    </div>
                    <h2 className="text-lg sm:text-xl font-bold text-[#263A35] font-display">
                      {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' && typeof ffmc === 'number'
                        ? (soilMoisture < 30 || ffmc >= 90
                          ? 'Attention Needed: Wetting Recommended'
                          : 'Soil & Fuel Moisture Sufficient')
                        : 'Mitigation Status: Standby Menunggu Telemetri'}
                    </h2>
                    <p className="text-xs text-[#50645F] mt-1 leading-relaxed m-0">
                      Catat tindakan penyiraman atau pendinginan serasah untuk memperbarui riwayat hidrasi dan log operasional mitigasi lapangan.
                    </p>
                  </div>

                  {wateringEvents[0] ? (
                    <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-3.5 my-3.5">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#50645F]">
                          Last Recorded Wetting Event
                        </span>
                        <span className="text-[10px] font-semibold text-[#263A35] bg-[#EFF3EF] px-2 py-0.5 rounded-md border border-[#A6B49E]">
                          Recorded
                        </span>
                      </div>
                      <div className="text-sm font-bold font-display text-[#263A35]">
                        {new Date(wateringEvents[0].timestamp).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[#50645F] mt-1 font-tabular">
                        <span>Soil Before: {typeof wateringEvents[0].soilBefore === 'number' ? `${wateringEvents[0].soilBefore.toFixed(1)}%` : '--'}</span>
                        <span className="text-[#50645F]/40">·</span>
                        <span className="truncate">{wateringEvents[0].note}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-3.5 my-3.5 text-center text-xs text-[#50645F]">
                      Belum ada tindakan penyiraman tercatat pada sesi ini.
                    </div>
                  )}

                  <button
                    onClick={handleRecordWatering}
                    aria-label="Catat tindakan penyiraman dan pendinginan kanopi hutan"
                    className="w-full min-h-11 py-2.5 px-4 rounded-xl bg-[#4E635E] hover:bg-[#3B4D49] text-white font-bold text-xs transition-all shadow-xs cursor-pointer active:scale-95 mt-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E]"
                  >
                    + Catat Penyiraman &amp; Pendinginan Kanopi
                  </button>
                </div>

                <div className="mt-4 pt-3 border-t border-[#D6DCCE] text-[11px] text-[#50645F]">
                  Total kejadian penyiraman tercatat sesi ini: <strong className="text-[#263A35]">{wateringEvents.length}</strong>
                </div>
              </section>
            </div>

            {/* 8. HISTORICAL TRENDS CANVAS & 24H SUMMARY */}
            <FloraHistoryCanvas
              history={history}
              liveTemp={temp}
              liveRh={rh}
              liveSoil={soilMoisture}
              liveFfmc={ffmc}
              liveRisk={hazardResult?.riskLevel ?? null}
              liveVisionPrediction={visionPrediction}
              liveFlameDetected={flameDetected}
              isLive={isLiveTelemetry && !isTelemetryStale}
            />

                {/* 9. SYSTEM & HARDWARE HEALTH TOPOLOGY (#devices) */}
                <section id="devices" className="scroll-mt-6 sm:scroll-mt-8">
              <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
                <div>
                  <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-widest block">
                    Infrastructure Status
                  </span>
                  <h2 className="text-lg font-bold text-[#263A35] font-display">
                    System &amp; Hardware Health Topology
                  </h2>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]">
                  Hardware &amp; Subsystem Topology
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 lg:gap-4">
                {[
                  {
                    label: 'ESP32 Main Node',
                    status: isLiveTelemetry && !isTelemetryStale ? 'ONLINE LIVE' : 'OFFLINE',
                    detail: `MAC: 8C:AA:B5:37:71:18 · Node: ${activeNodeId || 'ESP32-MAIN'} · ${isLiveTelemetry && !isTelemetryStale ? 'Live Gateway SSE (/api/telemetry/stream)' : 'Device Offline / Standby'}`,
                  },
                  {
                    label: 'ESP32-CAM Node',
                    status: gatewayFrameStatus === 'ready' && !gatewayFrameMeta?.isStale ? 'FRAME READY' : 'OFFLINE',
                    detail: `MAC: F8:B3:B7:A6:F3:9C · ${gatewayFrameStatus === 'ready' && gatewayFrameMeta && !gatewayFrameMeta.isStale ? `${(gatewayFrameMeta.byteLength / 1024).toFixed(1)} KB (HTTP 200)` : 'Backend Cache (/api/vision/latest-frame.jpg) · Offline'}`,
                  },
                  { label: 'C Edge Kernel 1', status: 'ACTIVE', detail: 'model_hazard.h (100 Trees RF in-memory)' },
                  { label: 'C Edge Kernel 2', status: 'ACTIVE', detail: 'grenvis_sensor_model.h (TFLite in-memory)' },
                  {
                    label: 'Backend Gateway',
                    status: gatewayStatus === 'connected'
                      ? (gatewayHealth && !gatewayHealth.mqttConnected
                        ? 'BROKER DISCONNECTED'
                        : (isLiveTelemetry ? (isTelemetryStale ? 'STALE' : 'CONNECTED LIVE') : 'READY'))
                      : gatewayStatus === 'connecting'
                      ? 'CONNECTING'
                      : 'OFFLINE',
                    detail: `HTTP :3000 · MQTT: ${gatewayHealth ? (gatewayHealth.mqttConnected ? 'Connected' : 'Disconnected') : 'Checking...'} · Uptime: ${gatewayHealth?.uptimeSeconds ?? 0}s`,
                  },
                  { label: 'ESP-NOW Link', status: 'ACTIVE', detail: 'Inter-Board Wireless Mesh (CH 6)' },
                  {
                    label: 'Sensor Hardware Topology',
                    status: isLiveTelemetry && !isTelemetryStale ? 'STREAMING' : 'OFFLINE',
                    detail: 'Fisik: DHT22 (Suhu, RH), Tanah v1.2, MQ-135, Flame Sensor (Tanpa Hujan/Cahaya)',
                  },
                  {
                    label: 'Scanner Motor L298N',
                    status: 'FAIL-CLOSED',
                    detail: 'Kontrol dinonaktifkan · Fail-Closed Safety Gate aktif',
                  },
                ].map((dev: any) => (
                  <article
                    key={dev.label}
                    onClick={dev.onClick}
                    className={`flora-card flora-card-interactive p-4 shadow-xs flex flex-col justify-between min-h-24 ${
                      dev.interactive ? 'cursor-pointer hover:border-[#5DD62C] ring-1 ring-transparent hover:ring-[#5DD62C]/30 transition-all' : ''
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider">
                        {dev.label}
                      </span>
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#EFF3EF] text-[#263A35] text-[9px] font-bold border border-[#A6B49E]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#4E635E] animate-pulse" />
                        {dev.status}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-[#263A35] block font-display mt-0.5">{dev.label}</span>
                    <span className="text-[10px] font-mono text-[#50645F] block mt-1 truncate">
                      {dev.detail}
                    </span>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {/* 10. FOOTER */}
            <footer className="mt-12 py-8 border-t border-[#D6DCCE] text-center text-xs text-[#50645F]">
              <div className="flex items-center justify-center gap-2 mb-1.5 flex-wrap">
                <span className="font-bold text-[#263A35] font-display flex items-center gap-1.5">
                  <img src="/agrapatha-logo.png" alt="Logo AGRAPATHA" className="w-4 h-4 object-contain inline-block drop-shadow-xs" />
                  <span>AGRAPATHA</span>
                </span>
                <span>·</span>
                <span>Smart Forest Fire &amp; Botanical AI Vision</span>
                <span>·</span>
                <span className="text-[#4E635E] font-semibold">
                  model_hazard.h (517 Montesinho) &amp; grenvis_sensor_model.h (TFLite Micro)
                </span>
              </div>
              <p className="text-[11px] text-[#50645F]/80 max-w-xl mx-auto leading-relaxed m-0">
                Hasil analisis model C header edge (<code className="font-mono">model_hazard.h</code> &amp;{' '}
                <code className="font-mono">grenvis_sensor_model.h</code>) dan inferensi optik berfungsi sebagai sistem pendukung keputusan (decision support) peringatan dini kebakaran hutan dan kesehatan mikroklimat.
              </p>
            </footer>
          </div>
        </main>

        {/* Toast Notification */}
        <div
          className={`fixed right-6 bottom-6 bg-[#17483B] text-[#DCECE5] border border-[#235849] px-4 py-3 rounded-xl text-xs font-semibold shadow-xl transition-all duration-300 ease-out z-50 pointer-events-none flex items-center gap-2.5 ${
            toast.visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-[#8FBEA8] animate-pulse" />
          <span>{toast.message}</span>
        </div>
      </div>
    </div>
  );
};

export default App;
