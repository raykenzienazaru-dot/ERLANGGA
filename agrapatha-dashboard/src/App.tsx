import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeFwiComponents,
  evaluateFloraSensorModel,
  evaluateModelHazard,
  REAL_DATASET_PRESETS,
} from './lib/aiModels';
import { FloraSplash } from './components/FloraSplash';
import { FloraKaggleSection } from './components/FloraKaggleSection';
import { FloraHistoryCanvas, type TelemetryHistoryPoint } from './components/FloraHistoryCanvas';
import { FloraBmkgCard } from './components/FloraBmkgCard';
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
} from 'lucide-react';
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
import { MqttTestModal } from './components/MqttTestModal';
import {
  subscribeLiveTelemetry,
  publishMqttCommand,
  type IncomingTelemetryMessage,
  type MqttConnectionState,
} from './lib/mqttService';

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

// Generate realistic SVG canopy/forest camera frame data URL
function generateCanopyFrameSvg(mode: 'Healthy Forest Canopy' | 'Smoke Plume Detected' | 'Active Surface Fire'): string {
  const isFire = mode === 'Active Surface Fire';
  const isSmoke = mode === 'Smoke Plume Detected';
  const skyTop = isFire ? '#3b120c' : isSmoke ? '#2b352c' : '#163012';
  const skyBot = isFire ? '#7c2d12' : isSmoke ? '#4e5c4e' : '#2d4f1e';
  const overlay = isFire
    ? `<circle cx="480" cy="255" r="78" fill="#ef4444" fill-opacity="0.45"/><circle cx="480" cy="260" r="42" fill="#facc15" fill-opacity="0.75"/><rect x="380" y="160" width="200" height="175" rx="8" fill="none" stroke="#ef4444" stroke-width="3" stroke-dasharray="6,4"/>`
    : isSmoke
    ? `<ellipse cx="430" cy="210" rx="135" ry="65" fill="#cbd5e1" fill-opacity="0.48"/><ellipse cx="475" cy="180" rx="110" ry="50" fill="#e2e8f0" fill-opacity="0.38"/><rect x="310" y="130" width="280" height="160" rx="8" fill="none" stroke="#fb923c" stroke-width="3" stroke-dasharray="6,4"/>`
    : `<rect x="260" y="120" width="280" height="180" rx="8" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-dasharray="6,4"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${skyTop}"/>
        <stop offset="100%" stop-color="${skyBot}"/>
      </linearGradient>
    </defs>
    <rect width="800" height="450" fill="url(#sky)"/>
    <path d="M0 340 L140 240 L260 320 L410 210 L560 310 L690 220 L800 300 L800 450 L0 450 Z" fill="#1e2f13" opacity="0.85"/>
    <path d="M0 375 L110 290 L230 360 L360 270 L500 355 L640 265 L800 350 L800 450 L0 450 Z" fill="#14200b"/>
    ${overlay}
    <text x="24" y="36" fill="#f0f4e8" font-family="monospace" font-size="13" font-weight="bold">ESP32-CAM OV2640 · MONTESINHO SECTOR (X,Y) · ${mode.toUpperCase()}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Leaf component for clock to isolate 1-second interval re-renders from the dashboard tree
const LiveClockBadge: React.FC = React.memo(() => {
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
    <span className="hidden sm:inline-block px-3 py-1.5 rounded-xl bg-white border border-[#D6DCCE] text-xs font-medium text-[#263A35] font-tabular shadow-xs">
      {clockText}
    </span>
  );
});

export const App: React.FC = () => {
  // Boot splash state ('boot' shows the 3D Welcome screen just like flora-six-zeta.vercel.app)
  const [viewMode, setViewMode] = useState<'boot' | 'dashboard'>('boot');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('overview');

  // Active Kaggle preset & live sensor parameters
  const [activePresetId, setActivePresetId] = useState<string>('kaggle-xnew-benchmark');
  const [temp, setTemp] = useState<number>(21.3);
  const [rh, setRh] = useState<number>(35.0);
  const [wind, setWind] = useState<number>(2.2);
  const [rain, setRain] = useState<number>(0.0);
  const [ffmc, setFfmc] = useState<number>(91.5);
  const [dmc, setDmc] = useState<number>(130.1);
  const [dc, setDc] = useState<number>(807.1);
  const [isi, setIsi] = useState<number>(7.5);
  const [soilMoisture, setSoilMoisture] = useState<number>(28.4);

  // Vision & Camera state
  const [visionPrediction, setVisionPrediction] = useState<
    'Healthy Forest Canopy' | 'Smoke Plume Detected' | 'Active Surface Fire'
  >('Smoke Plume Detected');
  const [visionProbs, setVisionProbs] = useState({ healthy: 6.4, smoke: 88.2, fire: 5.4 });
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastCaptureTime, setLastCaptureTime] = useState<string>(() => new Date().toISOString());

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

  // Memoize camera canopy SVG to avoid string building and URI encoding on each render
  const canopyFrameSvg = useMemo(
    () => generateCanopyFrameSvg(visionPrediction),
    [visionPrediction]
  );

  // Actuator / Rail L298N state
  const [movementStatus, setMovementStatus] = useState<
    'idle' | 'left_command_sent' | 'right_command_sent' | 'stop_command_sent' | 'capture_command_sent'
  >('idle');
  const [lastCommand, setLastCommand] = useState<string | null>('C');
  const [railPositionMm, setRailPositionMm] = useState<number>(480);
  const [limitLeft, setLimitLeft] = useState<boolean>(false);
  const [limitRight, setLimitRight] = useState<boolean>(false);

  // Watering / Suppression log state
  const [wateringEvents, setWateringEvents] = useState<WateringLogEvent[]>([
    {
      id: 1,
      timestamp: new Date(Date.now() - 18 * 60000).toISOString(),
      soilBefore: 26.5,
      note: 'Penyiraman otomatis zona penyangga & pendinginan serasah hutan',
    },
  ]);

  // Toast state
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({
    message: '',
    visible: false,
  });

  // EMQX MQTT Diagnostic Modal state
  const [mqttModalOpen, setMqttModalOpen] = useState<boolean>(false);

  // 100% Real-Time Live MQTT Telemetry State (5 Sensors & L298N OUT3/OUT4)
  const [mqttState, setMqttState] = useState<MqttConnectionState>('disconnected');
  const [isLiveMqtt, setIsLiveMqtt] = useState<boolean>(false);
  const [lastLiveTelemetryTime, setLastLiveTelemetryTime] = useState<Date | null>(null);
  const [rainStatus, setRainStatus] = useState<string>('KERING');
  const [rainRaw, setRainRaw] = useState<number | null>(null);
  const [soilRaw, setSoilRaw] = useState<number | null>(null);
  const [lightLux, setLightLux] = useState<number>(36500);
  const [ldrRaw, setLdrRaw] = useState<number | null>(null);
  const [motorDriverInfo, setMotorDriverInfo] = useState<string>('L298N OUT3 & OUT4');
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  // Auto-connect to live EMQX WebSocket (Port 8084 WSS) for 100% real-time telemetri
  useEffect(() => {
    const unsubscribe = subscribeLiveTelemetry({
      onTelemetry: (msg: IncomingTelemetryMessage) => {
        setIsLiveMqtt(true);
        setLastLiveTelemetryTime(new Date());

        if (typeof msg.temp === 'number') setTemp(Number(msg.temp.toFixed(1)));
        if (typeof msg.rh === 'number') setRh(Number(msg.rh.toFixed(1)));
        if (typeof msg.soilMoisture === 'number') setSoilMoisture(Number(msg.soilMoisture.toFixed(1)));
        if (typeof msg.soilRaw === 'number') setSoilRaw(msg.soilRaw);
        if (typeof msg.rain === 'number') setRain(Number(msg.rain.toFixed(2)));
        if (typeof msg.rainRaw === 'number') setRainRaw(msg.rainRaw);
        if (typeof msg.rainStatus === 'string') setRainStatus(msg.rainStatus);
        if (typeof msg.lightLux === 'number') setLightLux(Math.round(msg.lightLux));
        if (typeof msg.ldrRaw === 'number') setLdrRaw(msg.ldrRaw);
        if (typeof msg.nodeId === 'string') setActiveNodeId(msg.nodeId);
        if (typeof msg.motorDriver === 'string') setMotorDriverInfo(msg.motorDriver);

        if (typeof msg.limitLeft === 'boolean') setLimitLeft(msg.limitLeft);
        if (typeof msg.limitRight === 'boolean') setLimitRight(msg.limitRight);

        if (typeof msg.motorState === 'string') {
          if (msg.motorState === 'LEFT') setMovementStatus('left_command_sent');
          else if (msg.motorState === 'RIGHT') setMovementStatus('right_command_sent');
          else if (msg.motorState === 'STOPPED') setMovementStatus('stop_command_sent');
        }

        if (typeof msg.ffmc === 'number') setFfmc(Number(msg.ffmc.toFixed(1)));
        if (typeof msg.dmc === 'number') setDmc(Number(msg.dmc.toFixed(1)));
        if (typeof msg.dc === 'number') setDc(Number(msg.dc.toFixed(1)));
        if (typeof msg.isi === 'number') setIsi(Number(msg.isi.toFixed(1)));

        if (msg.visionPrediction) {
          if (msg.visionPrediction.toLowerCase().includes('fire')) {
            setVisionPrediction('Active Surface Fire');
            setVisionProbs({ healthy: 2.1, smoke: 12.4, fire: 85.5 });
          } else if (msg.visionPrediction.toLowerCase().includes('smoke')) {
            setVisionPrediction('Smoke Plume Detected');
            setVisionProbs({ healthy: 5.2, smoke: 89.1, fire: 5.7 });
          } else {
            setVisionPrediction('Healthy Forest Canopy');
            setVisionProbs({ healthy: 92.4, smoke: 5.1, fire: 2.5 });
          }
        }
      },
      onStatusChange: (status) => {
        setMqttState(status);
      },
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast({ message: msg, visible: true });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 3200);
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
  const hazardResult = useMemo(
    () =>
      evaluateModelHazard({
        temp,
        rh,
        wind,
        rain,
        ffmc,
        dmc,
        dc,
        isi,
      }),
    [temp, rh, wind, rain, ffmc, dmc, dc, isi]
  );

  // Real-time C Header AI Model 2: grenvis_sensor_model.h (FLORA Neural Network)
  const floraResult = useMemo(
    () => evaluateFloraSensorModel(temp, rh, soilMoisture),
    [temp, rh, soilMoisture]
  );

  // Historical telemetry buffer initialized from REAL_DATASET_PRESETS
  const [history, setHistory] = useState<TelemetryHistoryPoint[]>(() => {
    const now = Date.now();
    return Array.from({ length: 24 }, (_, idx) => {
      const preset = REAL_DATASET_PRESETS[idx % REAL_DATASET_PRESETS.length];
      const jitterT = Number((preset.temp + Math.sin(idx) * 0.8).toFixed(1));
      const jitterRh = Number(Math.max(15, Math.min(99, preset.rh + Math.cos(idx) * 1.5)).toFixed(1));
      const res = evaluateModelHazard({
        temp: jitterT,
        rh: jitterRh,
        wind: preset.wind,
        rain: preset.rain,
        ffmc: preset.ffmc,
        dmc: preset.dmc,
        dc: preset.dc,
        isi: preset.isi,
      });
      return {
        timestamp: new Date(now - (24 - idx) * 60000).toISOString(),
        temperature: jitterT,
        humidity: jitterRh,
        soil_moisture: preset.soilMoisture,
        wind: preset.wind,
        rain: preset.rain,
        ffmc: preset.ffmc,
        dmc: preset.dmc,
        dc: preset.dc,
        isi: preset.isi,
        sensor_risk: res.riskLevel,
        sensor_confidence: res.confidence,
        vision_prediction: preset.visionPrediction,
      };
    });
  });

  // Push new point into history when parameters change or every 6s
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
      const res = evaluateModelHazard({
        temp: tVal,
        rh: rhVal,
        wind: wVal,
        rain: rVal,
        ffmc: ffmcVal,
        dmc: dmcVal,
        dc: dcVal,
        isi: isiVal,
      });
      const pt: TelemetryHistoryPoint = {
        timestamp: new Date().toISOString(),
        temperature: tVal,
        humidity: rhVal,
        soil_moisture: soilVal,
        wind: wVal,
        rain: rVal,
        ffmc: ffmcVal,
        dmc: dmcVal,
        dc: dcVal,
        isi: isiVal,
        sensor_risk: res.riskLevel,
        sensor_confidence: res.confidence,
        vision_prediction: visPred,
      };
      setHistory((prev) => [...prev.slice(-49), pt]);
    },
    [temp, rh, soilMoisture, wind, rain, ffmc, dmc, dc, isi, visionPrediction]
  );

  // Select a preset scenario from forestfires.csv
  const handleSelectPreset = useCallback((presetId: string) => {
    const found = REAL_DATASET_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setActivePresetId(found.id);
    setTemp(found.temp);
    setRh(found.rh);
    setWind(found.wind);
    setRain(found.rain);
    setFfmc(found.ffmc);
    setDmc(found.dmc);
    setDc(found.dc);
    setIsi(found.isi);
    setSoilMoisture(found.soilMoisture);
    setVisionPrediction(found.visionPrediction);
    setVisionProbs({
      healthy: found.visionHealthy,
      smoke: found.visionSmoke,
      fire: found.visionFire,
    });
    appendSnapshotToHistory(
      found.temp,
      found.rh,
      found.soilMoisture,
      found.wind,
      found.rain,
      found.ffmc,
      found.dmc,
      found.dc,
      found.isi,
      found.visionPrediction
    );
    showToast(`Preset dimuat: ${found.name}`);
  }, [appendSnapshotToHistory, showToast]);

  // Interactive slider change handler
  const handleChangeParam = useCallback((
    field: 'temp' | 'rh' | 'wind' | 'rain' | 'ffmc' | 'dmc' | 'soilMoisture',
    value: number
  ) => {
    setActivePresetId('custom');
    let nextTemp = temp;
    let nextRh = rh;
    let nextWind = wind;
    let nextRain = rain;
    let nextFfmc = ffmc;
    let nextDmc = dmc;
    let nextSoil = soilMoisture;

    if (field === 'temp') nextTemp = value;
    if (field === 'rh') nextRh = value;
    if (field === 'wind') nextWind = value;
    if (field === 'rain') nextRain = value;
    if (field === 'ffmc') nextFfmc = value;
    if (field === 'dmc') nextDmc = value;
    if (field === 'soilMoisture') nextSoil = value;

    const derived = computeFwiComponents({
      temp: nextTemp,
      rh: nextRh,
      wind: nextWind,
      rain: nextRain,
      soilMoisture: nextSoil,
      ffmcOverride: nextFfmc,
      dmcOverride: nextDmc,
    });

    setTemp(nextTemp);
    setRh(nextRh);
    setWind(nextWind);
    setRain(nextRain);
    setFfmc(nextFfmc);
    setDmc(nextDmc);
    setDc(derived.dc);
    setIsi(derived.isi);
    setSoilMoisture(nextSoil);

    const evalRes = evaluateModelHazard({
      temp: nextTemp,
      rh: nextRh,
      wind: nextWind,
      rain: nextRain,
      ffmc: nextFfmc,
      dmc: nextDmc,
    });

    if (evalRes.riskLevel === 'HIGH' && nextFfmc >= 93.5) {
      setVisionPrediction('Active Surface Fire');
      setVisionProbs({ healthy: 3.2, smoke: 18.4, fire: 78.4 });
    } else if (evalRes.riskLevel === 'HIGH') {
      setVisionPrediction('Smoke Plume Detected');
      setVisionProbs({ healthy: 8.5, smoke: 84.1, fire: 7.4 });
    } else {
      setVisionPrediction('Healthy Forest Canopy');
      setVisionProbs({ healthy: 93.6, smoke: 4.8, fire: 1.6 });
    }
  }, [temp, rh, wind, rain, ffmc, dmc, soilMoisture]);

  // Scroll spy for sidebar with requestAnimationFrame throttling to eliminate layout thrashing
  useEffect(() => {
    let ticking = false;
    let rafId = 0;
    const onScroll = () => {
      if (!ticking) {
        rafId = window.requestAnimationFrame(() => {
          if (window.scrollY < 80) {
            setActiveSection((prev) => (prev !== SECTION_IDS[0] ? SECTION_IDS[0] : prev));
          } else {
            let current = SECTION_IDS[0] as string;
            for (const id of SECTION_IDS) {
              const el = document.getElementById(id);
              if (el && el.getBoundingClientRect().top <= 150) {
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
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      ticking = false;
    };
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    setMobileMenuOpen(false);
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
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
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
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
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

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
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
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
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

  // Unified Camera capture action
  const handleTriggerCameraScan = () => {
    if (cameraStatus === 'streaming') {
      handleCaptureFromVideo();
    } else if (capturedBlob) {
      handleAnalyzeImage();
    } else {
      handleStartCamera();
    }
  };

  // L298N Rail Carriage commands (OUT3 & OUT4)
  const handleRailCommand = async (cmd: 'L' | 'R' | 'S' | 'C') => {
    if (cmd === 'C') {
      await publishMqttCommand('C');
      showToast("Perintah 'C' terkirim ke ESP32: Trigger Capture Foto Kamera");
      handleTriggerCameraScan();
      return;
    }
    setLastCommand(cmd);
    const sent = await publishMqttCommand(cmd);

    if (cmd === 'L') {
      if (limitLeft) {
        showToast('Limit Switch Kiri (SW1) aktif! Gerakan motor OUT3/OUT4 diblokir.');
        return;
      }
      const nextPos = Math.max(0, railPositionMm - 200);
      setRailPositionMm(nextPos);
      setLimitLeft(nextPos <= 0);
      setLimitRight(false);
      setMovementStatus('left_command_sent');
      showToast(
        sent
          ? `Perintah 'L' terkirim ke ESP32 L298N (OUT3 & OUT4) → Rel ke kiri (${nextPos} mm)`
          : `Perintah 'L' lokal → Posisi rel: ${nextPos} mm`
      );
    } else if (cmd === 'R') {
      if (limitRight) {
        showToast('Limit Switch Kanan (SW2) aktif! Gerakan motor OUT3/OUT4 diblokir.');
        return;
      }
      const nextPos = Math.min(1200, railPositionMm + 200);
      setRailPositionMm(nextPos);
      setLimitRight(nextPos >= 1200);
      setLimitLeft(false);
      setMovementStatus('right_command_sent');
      showToast(
        sent
          ? `Perintah 'R' terkirim ke ESP32 L298N (OUT3 & OUT4) → Rel ke kanan (${nextPos} mm)`
          : `Perintah 'R' lokal → Posisi rel: ${nextPos} mm`
      );
    } else if (cmd === 'S') {
      setMovementStatus('stop_command_sent');
      showToast(
        sent
          ? "Perintah 'S' terkirim ke ESP32 L298N (OUT3 & OUT4): Rem Motor Aktif (STOP)"
          : "Perintah 'S': Motor L298N berhenti (Brake Active)"
      );
    }
  };

  // Record manual watering / suppression
  const handleRecordWatering = () => {
    const newEvt: WateringLogEvent = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      soilBefore: soilMoisture,
      note: 'Penyiraman manual & pendinginan zona kanopi tercatat dari konsol',
    };
    setWateringEvents((prev) => [newEvt, ...prev.slice(0, 8)]);
    const boostedSoil = Math.min(95, Number((soilMoisture + 14).toFixed(1)));
    const cooledFfmc = Math.max(18.7, Number((ffmc - 5.5).toFixed(1)));
    setSoilMoisture(boostedSoil);
    setFfmc(cooledFfmc);
    showToast('Penyiraman dicatat — Kelembapan tanah meningkat & FFMC menurun');
  };

  // Dynamic Alert Banner Config
  const alertBanner = useMemo(() => {
    if (hazardResult.riskLevel === 'HIGH') {
      return {
        severity: 'CRITICAL',
        title: `Peringatan Bahaya Kebakaran Tinggi (model_hazard.h: ${hazardResult.confidence.toFixed(1)}% High Risk)`,
        description: `FFMC (${ffmc.toFixed(1)}) dan DMC (${dmc.toFixed(1)}) berada di zona penyalaan aktif (Prediksi Kaggle: '${hazardResult.kaggleBinaryPrediction}'). Segera periksa kamera kanopi dan aktifkan protokol mitigasi.`,
        wrapper: 'bg-[#FEEAEA] border-[#FCCECE] text-[#961C1C]',
        badge: 'bg-[#FCCECE] text-[#961C1C]',
        btn: 'bg-[#961C1C] text-white hover:bg-[#7D1515]',
        actionText: 'Buka Simulator & SOP',
        actionTarget: 'benchmarks',
      };
    }
    if (hazardResult.riskLevel === 'MODERATE' || floraResult.sensorRisk === 'Moderate') {
      return {
        severity: 'WARNING',
        title: `Status Waspada Mikroklimat & Serasah (Confidence: ${hazardResult.confidence.toFixed(1)}%)`,
        description: `Kelembapan bahan bakar halus FFMC = ${ffmc.toFixed(1)} dan kelembapan tanah = ${soilMoisture.toFixed(1)}%. Pantau tren suhu (${temp.toFixed(1)}°C) dan kelembapan udara (${rh.toFixed(0)}%).`,
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
      description: `Seluruh parameter telemetri berada dalam batas aman Montesinho & FLORA (FFMC: ${ffmc.toFixed(1)}, Soil: ${soilMoisture.toFixed(1)}%, Prediksi Kaggle: 'safe').`,
      wrapper: 'bg-[#EFF3EF] border-[#A6B49E] text-[#263A35]',
      badge: 'bg-[#A6B49E]/30 text-[#263A35] border border-[#A6B49E]',
      btn: 'bg-[#4E635E] text-white hover:bg-[#3D4F4B]',
      actionText: 'Lihat Telemetri',
      actionTarget: 'monitoring',
    };
  }, [hazardResult, floraResult, ffmc, dmc, soilMoisture, temp, rh]);

  const navItems = useMemo(
    () => [
      { id: 'overview', label: 'Overview Status', badge: hazardResult.riskLevel },
      { id: 'bmkg', label: 'BMKG Macro Weather', badge: 'BMKG' },
      { id: 'monitoring', label: 'Live Sensors (FWI & ADC)' },
      { id: 'analysis', label: 'AI Model Analysis (.h)' },
      { id: 'benchmarks', label: 'Simulator & Kaggle Data', badge: 'AI.H' },
      { id: 'cameraCapture', label: 'ESP32-CAM Vision' },
      { id: 'device-control', label: 'L298N Rail Control' },
      { id: 'treatment', label: 'Mitigation & Irrigation' },
      { id: 'history', label: 'Historical Trends' },
      { id: 'devices', label: 'Hardware Topology' },
    ],
    [hazardResult.riskLevel]
  );

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col justify-between h-full p-4 select-none">
      {/* Brand Box */}
      <div className="flex items-center justify-between pb-3.5 mb-3 border-b border-[#364844] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#4E635E] flex items-center justify-center text-white shadow-xs shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0 C12 7 17 12 24 12 C17 12 12 17 12 24 C12 17 7 12 0 12 C7 12 12 7 12 0 Z" />
            </svg>
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-white tracking-wider uppercase block font-display truncate">
              AGRAPATHA · FLORA
            </span>
            <span className="text-[10px] text-[#E2E0CB]/85 block truncate">
              Edge AI Forest &amp; Botanical
            </span>
          </div>
        </div>
        {isMobile && (
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="text-[#E2E0CB] hover:text-white w-9 h-9 flex items-center justify-center rounded-lg text-base shrink-0 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#A6B49E]"
            aria-label="Tutup navigasi"
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      {/* Middle Scrollable Section */}
      <div className="flex-1 overflow-y-auto min-h-0 flora-sidebar-scroll pr-1 space-y-5">
        {/* Navigation Links */}
        <nav aria-label="Console Sections" className="space-y-1">
          <span className="px-2.5 text-[10px] font-bold uppercase tracking-widest text-[#E2E0CB]/70 block mb-2">
            Console Sections
          </span>
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                aria-current={isActive ? 'location' : undefined}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#A6B49E] ${
                  isActive
                    ? 'bg-[#4E635E] text-white shadow-xs border-l-2 border-[#E2E0CB]'
                    : 'text-[#E2E0CB]/85 hover:bg-[#364844]/60 hover:text-white'
                }`}
              >
                <span className="truncate">{item.label}</span>
                {item.badge && (
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ml-1.5 ${
                      isActive ? 'bg-[#23312E] text-[#E2E0CB]' : 'bg-[#1A2522] text-[#A6B49E]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Quick Dataset Presets in Sidebar */}
        <div className="pt-4 border-t border-[#364844]">
          <span className="px-2.5 text-[10px] font-bold uppercase tracking-widest text-[#E2E0CB]/70 block mb-2">
            Kaggle Preset Scenarios
          </span>
          <div role="group" aria-label="Kaggle Preset Scenarios" className="space-y-1.5">
            {REAL_DATASET_PRESETS.map((preset) => {
              const active = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset.id)}
                  aria-pressed={active}
                  aria-label={`Pilih skenario preset ${preset.name}`}
                  className={`w-full px-3 py-2 rounded-xl text-left text-[11px] transition-all cursor-pointer border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#A6B49E] ${
                    active
                      ? 'bg-[#1A2522] border-[#A6B49E] text-white font-bold'
                      : 'bg-[#1A2522]/50 border-[#364844] text-[#E2E0CB] hover:bg-[#1A2522]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate">{preset.shortName}</span>
                    <span className="font-tabular text-[10px] text-[#E2E0CB] shrink-0">FFMC {preset.ffmc}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom System Channel Status */}
      <div className="bg-[#1A2522] p-3 rounded-xl border border-[#364844] flex items-center gap-2.5 mt-3 shrink-0">
        <span className="w-2 h-2 rounded-full shrink-0 bg-[#A6B49E] shadow-[0_0_6px_rgba(166,180,158,0.7)] animate-pulse" />
        <div className="min-w-0 flex-1">
          <span className="block text-[9px] text-[#E2E0CB] font-semibold uppercase tracking-wider truncate">
            Edge Kernel Channel
          </span>
          <div className="flex items-center justify-between gap-1 mt-0.5">
            <span className="block text-xs font-bold text-white uppercase tracking-wider truncate">
              LIVE · C HEADER AI
            </span>
            <span className="text-[10px] text-[#E2E0CB]/80 font-tabular shrink-0">100 Trees</span>
          </div>
          <span className="block text-[10px] text-[#E2E0CB]/70 truncate mt-0.5">
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

      <div className="flex flex-1 min-h-screen">
        {/* Desktop Sticky Sidebar */}
        <aside className="hidden lg:flex w-64 h-screen sticky top-0 shrink-0 bg-[#23312E] flex-col border-r border-[#364844] z-30 shadow-md">
          {renderSidebarContent(false)}
        </aside>

        {/* Mobile Drawer Sidebar */}
        {mobileMenuOpen && (
          <div
            id="mobile-navigation-drawer"
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 lg:hidden flex"
            onClick={() => setMobileMenuOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Navigasi AGRAPATHA Flora"
          >
            <div
              className="w-70 h-full bg-[#23312E] shadow-2xl flex flex-col z-50"
              onClick={(e) => e.stopPropagation()}
            >
              {renderSidebarContent(true)}
            </div>
          </div>
        )}

        {/* Main Console Workspace */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-7 xl:p-8 2xl:p-9 max-w-360 xl:max-w-[1560px] 2xl:max-w-[1680px] mx-auto w-full overflow-x-hidden">
          {/* Top Console Header */}
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-5 mb-5 border-b border-[#D6DCCE]">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden w-10 h-10 shrink-0 rounded-xl bg-white border border-[#D6DCCE] text-[#263A35] hover:bg-[#F0F2ED] text-lg font-bold shadow-xs cursor-pointer flex items-center justify-center focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E]"
                aria-label="Buka Menu Navigasi"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-navigation-drawer"
              >
                <span aria-hidden="true">☰</span>
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold tracking-widest text-[#4E635E] uppercase flex items-center gap-1.5 truncate">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                      <path d="M12 0 C12 7 17 12 24 12 C17 12 12 17 12 24 C12 17 7 12 0 12 C7 12 12 7 12 0 Z" />
                    </svg>
                    <span className="truncate">AGRAPATHA × FLORA · Botanical &amp; Forest Fire Intelligence</span>
                  </span>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-[#263A35] mt-0.5 tracking-tight font-display">
                  Forest Fire Hazard &amp; Microclimate Console
                </h1>
                <p className="text-xs text-[#50645F] mt-0.5 leading-relaxed">
                  Realtime FWI sensor telemetry, <code className="font-mono text-[#4E635E]">model_hazard.h</code> Random Forest (100 trees), and <code className="font-mono text-[#4E635E]">grenvis_sensor_model.h</code> evaluation.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-start sm:justify-end shrink-0">
              <button
                onClick={() => setViewMode('boot')}
                className="px-3 py-1.5 rounded-xl bg-[#EFF3EF] hover:bg-[#E2E0CB] text-[#263A35] border border-[#A6B49E] text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E]"
                title="Buka tampilan 3D Welcome Screen"
                aria-label="Buka kembali tampilan 3D Welcome Screen"
              >
                <span aria-hidden="true">✦</span>
                <span>3D Welcome</span>
              </button>

              <button
                onClick={() => setMqttModalOpen(true)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs shadow-xs transition-all cursor-pointer ${
                  isLiveMqtt
                    ? 'bg-[#EFF3EF] border-[#5DD62C] text-[#263A35] hover:bg-[#E2E0CB]'
                    : mqttState === 'connected'
                    ? 'bg-white border-[#A6B49E] text-[#263A35] hover:bg-[#F5F4EE]'
                    : 'bg-white border-[#D6DCCE] text-[#263A35] hover:bg-[#F5F4EE]'
                }`}
                title="Status Koneksi EMQX Cloud MQTT WebSocket (Port 8084). Klik untuk modal pengujian."
                aria-label="Status Koneksi MQTT"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isLiveMqtt
                      ? 'bg-[#16A34A] animate-pulse ring-2 ring-[#5DD62C]/40'
                      : mqttState === 'connected'
                      ? 'bg-[#0284C7]'
                      : 'bg-[#D97706] animate-pulse'
                  }`}
                />
                <span className="font-bold font-display text-[11px] uppercase tracking-wider">
                  {isLiveMqtt ? `ESP32 LIVE · ${activeNodeId || 'MAIN'}` : mqttState === 'connected' ? 'MQTT READY' : 'PRESET / SIMULASI'}
                </span>
                <span className="text-[11px] text-[#50645F] font-tabular border-l border-[#D6DCCE] pl-2 hidden sm:inline-block">
                  {isLiveMqtt && lastLiveTelemetryTime
                    ? lastLiveTelemetryTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : 'EMQX Cloud :8084'}
                </span>
              </button>

              <LiveClockBadge />

              <button
                onClick={() => {
                  const idx = REAL_DATASET_PRESETS.findIndex((p) => p.id === activePresetId);
                  const next = REAL_DATASET_PRESETS[(idx + 1) % REAL_DATASET_PRESETS.length];
                  handleSelectPreset(next.id);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-[#4E635E] hover:bg-[#3B4D49] text-white text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 whitespace-nowrap focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E]"
                aria-label="Ganti ke skenario dataset Kaggle berikutnya"
              >
                <span aria-hidden="true">↻</span>
                <span>Ganti Skenario Kaggle</span>
              </button>
            </div>
          </header>

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
            {/* 1. OVERVIEW HERO CARD (.flora-card-hero) */}
            <section
              id="overview"
              className="scroll-mt-6 sm:scroll-mt-8 flora-card-hero p-5 sm:p-6 lg:p-7 flex flex-col justify-between gap-6 transition-all"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-[#364844]">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#E2E0CB] block">
                    AGRAPATHA × FLORA · Montesinho FWI &amp; Microclimate Overview
                  </span>
                  <h2 className="text-xl lg:text-2xl font-bold font-display text-white tracking-tight mt-1">
                    Forest Fire Hazard &amp; Environmental Intelligence
                  </h2>
                </div>
                <div className="flex items-center gap-2 self-start md:self-auto shrink-0 flex-wrap">
                  <span className="text-[11px] text-[#E2E0CB]/90 font-tabular px-2.5 py-1 rounded-xl bg-[#1A2522] border border-[#364844]">
                    Kaggle Label: {hazardResult.kaggleBinaryPrediction}
                  </span>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-xl bg-[#1A2522] text-[#E2E0CB] border border-[#364844]">
                    {hazardResult.riskLevel} Priority
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="lg:col-span-2 space-y-3.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#A6B49E] shadow-[0_0_6px_rgba(166,180,158,0.7)]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[#E2E0CB]">
                      Current Forest &amp; Botanical Status
                    </span>
                  </div>
                  <h3 className="text-lg lg:text-xl font-bold font-display text-white leading-snug">
                    {hazardResult.riskLevel === 'HIGH'
                      ? 'Bahaya Kebakaran Hutan Tinggi — Zona Kritis Penyalaan Serasah (FFMC ≥ 89.5)'
                      : hazardResult.riskLevel === 'MODERATE'
                      ? 'Risiko Kebakaran Menengah — Transisi Pengeringan Bahan Bakar Halus'
                      : 'Kondisi Kanopi & Serasah Hutan Stabil — Risiko Penyalaan Rendah'}
                  </h3>
                  <p className="text-xs lg:text-sm text-[#E2E0CB]/90 leading-relaxed max-w-2xl">
                    Berdasarkan eksekusi langsung 100 pohon keputusan pada <code className="text-[#A6B49E] font-mono">model_hazard.h</code> dengan vektor input <code className="text-[#E2E0CB] font-mono">[{temp.toFixed(1)}°C, {rh.toFixed(0)}%, {wind.toFixed(1)} km/h, {rain.toFixed(1)} mm, FFMC {ffmc.toFixed(1)}, DMC {dmc.toFixed(1)}]</code>, probabilitas kelas adalah <strong>High {hazardResult.highProbability.toFixed(1)}%</strong>, <strong>Moderate {hazardResult.moderateProbability.toFixed(1)}%</strong>, dan <strong>Low {hazardResult.lowProbability.toFixed(1)}%</strong>.
                  </p>

                  {/* Telemetry Pill Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-2.5 pt-1 w-full">
                    <div className="bg-[#1A2522] border border-[#364844] hover:border-[#818C78] px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-2xs transition-colors min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] shrink-0" />
                        <span className="text-[#E2E0CB] text-[11px] font-semibold truncate">1. Suhu (DHT22)</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{temp.toFixed(1)}°C</span>
                    </div>
                    <div className="bg-[#1A2522] border border-[#364844] hover:border-[#818C78] px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-2xs transition-colors min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#0284C7] shrink-0" />
                        <span className="text-[#E2E0CB] text-[11px] font-semibold truncate">2. RH Udara</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{rh.toFixed(1)}%</span>
                    </div>
                    <div className="bg-[#1A2522] border border-[#364844] hover:border-[#818C78] px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-2xs transition-colors min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#84CC16] shrink-0" />
                        <span className="text-[#E2E0CB] text-[11px] font-semibold truncate">3. Tanah (v1.2)</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{soilMoisture.toFixed(1)}%</span>
                    </div>
                    <div className="bg-[#1A2522] border border-[#364844] hover:border-[#818C78] px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-2xs transition-colors min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8] shrink-0" />
                        <span className="text-[#E2E0CB] text-[11px] font-semibold truncate">4. Hujan (FC-37)</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{rain.toFixed(1)} mm/h</span>
                    </div>
                    <div className="bg-[#1A2522] border border-[#364844] hover:border-[#818C78] px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-2xs transition-colors min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#EAB308] shrink-0" />
                        <span className="text-[#E2E0CB] text-[11px] font-semibold truncate">5. Cahaya (LDR)</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{lightLux.toLocaleString()} Lux</span>
                    </div>
                    <div className="bg-[#1A2522] border border-[#364844] hover:border-[#818C78] px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-2xs transition-colors min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#14B8A6] shrink-0" />
                        <span className="text-[#E2E0CB] text-[11px] font-semibold truncate">Angin Ambien</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{wind.toFixed(1)} km/h</span>
                    </div>
                    <div className="bg-[#1A2522] border border-[#364844] hover:border-[#818C78] px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-2xs transition-colors min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] shrink-0" />
                        <span className="text-[#E2E0CB] text-[11px] font-semibold truncate">FFMC Serasah</span>
                      </div>
                      <span className="font-bold font-tabular text-[#E2E0CB] text-xs whitespace-nowrap shrink-0">{ffmc.toFixed(1)}</span>
                    </div>
                    <div className="bg-[#1A2522] border border-[#364844] hover:border-[#818C78] px-2.5 py-2 rounded-xl flex items-center justify-between gap-1.5 text-xs min-h-10.5 shadow-2xs transition-colors min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#A855F7] shrink-0" />
                        <span className="text-[#E2E0CB] text-[11px] font-semibold truncate">Rel L298N OUT3/4</span>
                      </div>
                      <span className="font-bold font-tabular text-white text-xs whitespace-nowrap shrink-0">{movementStatus === 'idle' ? 'STANDBY' : movementStatus.replace(/_command_sent|_command/g, '').toUpperCase()}</span>
                    </div>
                  </div>
                </div>

                {/* Right Risk Index Box */}
                <div className="bg-[#1A2522] border border-[#364844] rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center text-center shadow-inner">
                  <span className="text-[10px] text-[#E2E0CB] uppercase tracking-widest font-bold block mb-1">
                    model_hazard.h Risk Index
                  </span>
                  <div
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border my-2 font-display ${
                      hazardResult.riskLevel === 'HIGH'
                        ? 'bg-[#FEEAEA] text-[#961C1C] border-[#FCCECE]'
                        : hazardResult.riskLevel === 'MODERATE'
                        ? 'bg-[#FEF7E8] text-[#8A570C] border-[#FDE3B5]'
                        : 'bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]'
                    }`}
                  >
                    {hazardResult.riskLevel} RISK
                  </div>
                  <span className="text-[11px] text-[#E2E0CB]/90 font-tabular mt-0.5">
                    {hazardResult.confidence.toFixed(2)}% confidence
                  </span>
                  <p className="text-[10px] text-[#E2E0CB]/70 mt-2 m-0 leading-tight">
                    Evaluated via 100-Tree C Random Forest (<code className="font-mono">model_hazard.h</code>) &amp; FLORA MLP (<code className="font-mono">{floraResult.sensorRisk}</code>).
                  </p>
                </div>
              </div>

              {/* 4 Bottom Pillar Boxes */}
              <div className="pt-4 border-t border-[#364844] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                <div className="bg-[#1A2522] border border-[#364844] p-3 rounded-xl flex flex-col justify-between min-h-20.5">
                  <span className="text-[10px] font-bold text-[#E2E0CB] uppercase tracking-wider block">
                    1. Meteorology (Montesinho)
                  </span>
                  <span className="text-xs font-bold text-white block mt-1">
                    {temp >= 28 ? 'Hot / Dry Air' : temp <= 12 ? 'Cool Canopy' : 'Temperate Optimal'}
                  </span>
                  <span className="text-[10px] text-[#E2E0CB]/80 block font-tabular mt-0.5">
                    {temp.toFixed(1)}°C · RH {rh.toFixed(0)}% · Wind {wind.toFixed(1)} km/h
                  </span>
                </div>
                <div className="bg-[#1A2522] border border-[#364844] p-3 rounded-xl flex flex-col justify-between min-h-20.5">
                  <span className="text-[10px] font-bold text-[#E2E0CB] uppercase tracking-wider block">
                    2. FWI Fuel Codes
                  </span>
                  <span className="text-xs font-bold text-white block mt-1">
                    {ffmc >= 90 ? 'Flammable Litter' : ffmc >= 82 ? 'Moderate Drying' : 'Moist Litter'}
                  </span>
                  <span className="text-[10px] text-[#E2E0CB]/80 block font-tabular mt-0.5">
                    FFMC {ffmc.toFixed(1)} · DMC {dmc.toFixed(1)} · ISI {isi.toFixed(1)}
                  </span>
                </div>
                <div className="bg-[#1A2522] border border-[#364844] p-3 rounded-xl flex flex-col justify-between min-h-20.5">
                  <span className="text-[10px] font-bold text-[#E2E0CB] uppercase tracking-wider block">
                    3. Edge AI (model_hazard.h)
                  </span>
                  <span className="text-xs font-bold text-white block mt-1">
                    {hazardResult.riskLevel} ({hazardResult.confidence.toFixed(1)}%)
                  </span>
                  <span className="text-[10px] text-[#E2E0CB]/80 block font-tabular mt-0.5">
                    Kaggle Label: {hazardResult.kaggleBinaryPrediction}
                  </span>
                </div>
                <div className="bg-[#1A2522] border border-[#364844] p-3 rounded-xl flex flex-col justify-between min-h-20.5">
                  <span className="text-[10px] font-bold text-[#E2E0CB] uppercase tracking-wider block">
                    4. FLORA Soil &amp; Vision
                  </span>
                  <span className="text-xs font-bold text-white block mt-1">
                    Soil {soilMoisture.toFixed(1)}% ({floraResult.sensorRisk})
                  </span>
                  <span className="text-[10px] text-[#E2E0CB]/80 block font-tabular mt-0.5">
                    {visionPrediction}
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
                  <span>Calibrated to forestfires.csv (517) &amp; FLORA (9,000)</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    title: '1. Suhu Udara (Air Temperature)',
                    shortTitle: 'Suhu Udara (DHT22)',
                    channelTag: 'Sensor 1 · GPIO 19',
                    value: temp.toFixed(1),
                    unit: '°C',
                    statusLabel: temp >= 28 ? 'SUHU TINGGI' : temp <= 15 ? 'SEJUK' : 'OPTIMAL',
                    isWarn: temp >= 28,
                    percent: Math.min(100, Math.max(0, (temp / 45) * 100)),
                    minLabel: '0°C',
                    maxLabel: '45°C',
                    barColor: temp >= 28 ? 'bg-[#DC2626]' : temp <= 15 ? 'bg-[#0284C7]' : 'bg-[#4E635E]',
                    explanation:
                      'Sensor suhu ambien kanopi hutan (DHT22). Mempengaruhi laju pengeringan serasah halus dan evapotranspirasi kanopi.',
                    reference: 'Rentang Sensor: -40 s.d 80°C (±0.5°C)',
                    extra: isLiveMqtt ? 'Live Stream ESP32' : 'Montesinho Mean: 18.89°C',
                  },
                  {
                    title: '2. Kelembapan Udara (Relative Humidity)',
                    shortTitle: 'Kelembapan Udara',
                    channelTag: 'Sensor 2 · GPIO 19',
                    value: rh.toFixed(1),
                    unit: '%',
                    statusLabel: rh < 35 ? 'KERING KRITIS' : rh > 80 ? 'LEMBAP TINGGI' : 'MODERAT',
                    isWarn: rh < 35,
                    percent: Math.min(100, Math.max(0, rh)),
                    minLabel: '0%',
                    maxLabel: '100%',
                    barColor: rh < 35 ? 'bg-[#DC2626]' : rh > 80 ? 'bg-[#0284C7]' : 'bg-[#4E635E]',
                    explanation:
                      'Kelembapan relatif udara kanopi hutan (DHT22). Nilai RH < 35% memicu pengeringan serasah dan eskalasi risiko sulutan api.',
                    reference: 'Rentang Sensor: 0 s.d 100% RH (±2%)',
                    extra: isLiveMqtt ? 'Live Stream ESP32' : 'Montesinho Mean: 44.29%',
                  },
                  {
                    title: '3. Kelembapan Tanah (Soil Moisture)',
                    shortTitle: 'Kelembapan Tanah',
                    channelTag: 'Sensor 3 · GPIO 34 (ADC1)',
                    value: soilMoisture.toFixed(1),
                    unit: '%',
                    statusLabel: soilMoisture < 25 ? 'TANAH KERING' : soilMoisture > 75 ? 'BASAH JENUH' : 'LEMBAP SUBUR',
                    isWarn: soilMoisture < 25,
                    percent: Math.min(100, Math.max(0, soilMoisture)),
                    minLabel: '0%',
                    maxLabel: '100%',
                    barColor: soilMoisture < 25 ? 'bg-[#DC2626]' : soilMoisture > 75 ? 'bg-[#0284C7]' : 'bg-[#84CC16]',
                    explanation:
                      'Sensor kelembapan tanah kapasitif v1.2 anti-korosi. Menilai kadar air zona rizosfer tanaman dan lapisan humus bawah serasah.',
                    reference: soilRaw ? `ADC Raw: ${soilRaw} (Wet: 1350, Dry: 3100)` : 'Capacitive v1.2 Kalibrasi ADC',
                    extra: isLiveMqtt ? 'Hardware Live ADC' : 'FLORA Mean: 67.15%',
                  },
                  {
                    title: '4. Intensitas Hujan (Rain Intensity)',
                    shortTitle: 'Sensor Hujan (FC-37)',
                    channelTag: 'Sensor 4 · GPIO 35 (ADC1)',
                    value: rain.toFixed(1),
                    unit: `mm/h (${rainStatus})`,
                    statusLabel: rainStatus === 'HUJAN' ? 'HUJAN LEBAT' : rainStatus === 'GERIMIS' ? 'GERIMIS' : 'TIDAK HUJAN',
                    isWarn: false,
                    percent: Math.min(100, Math.max(0, (rain / 25) * 100)),
                    minLabel: '0.0 mm/h',
                    maxLabel: '25.0 mm/h',
                    barColor: rain > 0 ? 'bg-[#0284C7]' : 'bg-[#94A3B8]',
                    explanation:
                      'Deteksi presipitasi rintik dan laju curah hujan kanopi (FC-37). Permukaan basah secara instan menurunkan potensi sulutan api serasah.',
                    reference: rainRaw ? `ADC Raw: ${rainRaw} (${rainStatus})` : 'FC-37 Plate Multi-sample',
                    extra: isLiveMqtt ? `Status: ${rainStatus}` : 'Baseline Kering (0.0 mm)',
                  },
                  {
                    title: '5. Radiasi Cahaya (Solar Lux)',
                    shortTitle: 'Sensor Cahaya (LDR)',
                    channelTag: 'Sensor 5 · GPIO 36 (VP)',
                    value: lightLux >= 1000 ? (lightLux / 1000).toFixed(1) + 'k' : String(lightLux),
                    unit: 'Lux',
                    statusLabel: lightLux > 45000 ? 'TERIK INTENS' : lightLux > 12000 ? 'TERANG SIANG' : 'TEDUH / MALAM',
                    isWarn: lightLux > 55000 && temp > 30,
                    percent: Math.min(100, Math.max(0, (lightLux / 80000) * 100)),
                    minLabel: '0 Lux',
                    maxLabel: '80,000 Lux',
                    barColor: lightLux > 45000 ? 'bg-[#EAB308]' : lightLux > 12000 ? 'bg-[#14B8A6]' : 'bg-[#64748B]',
                    explanation:
                      'Estimasi intensitas cahaya kanopi dan radiasi matahari via LDR Photoresistor. Menghitung evapotranspirasi dan radiasi termal tajuk.',
                    reference: ldrRaw ? `ADC Raw: ${ldrRaw} (VP ADC1_CH0)` : 'LDR Non-linear Lux Transform',
                    extra: isLiveMqtt ? 'Hardware Live ADC' : 'Siang Kanopi ~45k Lux',
                  },
                  {
                    title: '6. Indeks Serasah & Angin (FWI Engine)',
                    shortTitle: 'Fine Fuel & Wind (FFMC)',
                    channelTag: 'model_hazard.h · FWI',
                    value: ffmc.toFixed(1),
                    unit: `idx (Wind ${wind.toFixed(1)} km/h)`,
                    statusLabel: ffmc >= 89.5 ? 'ZONA PENYALAAN' : ffmc >= 82 ? 'PENGERINGAN' : 'KADAR AIR AMAN',
                    isWarn: ffmc >= 89.5,
                    percent: Math.min(100, Math.max(0, ffmc)),
                    minLabel: '0 idx',
                    maxLabel: '100 idx',
                    barColor: ffmc >= 89.5 ? 'bg-[#DC2626]' : ffmc >= 82 ? 'bg-[#D97706]' : 'bg-[#4E635E]',
                    explanation:
                      'Fine Fuel Moisture Code (FFMC) dihitung langsung dari DHT22 (suhu & RH), hujan FC-37, dan kecepatan angin. Ambang kritis sulutan api serasah: 89.5.',
                    reference: `ISI: ${isi.toFixed(1)} · DMC: ${dmc.toFixed(1)}`,
                    extra: '100-Tree Random Forest Kernel',
                  },
                ].map((card) => (
                  <article
                    key={card.title}
                    className="flora-card flora-card-interactive h-full p-5 lg:p-6 flex flex-col justify-between shadow-xs hover:shadow-md transition-all duration-200"
                  >
                    <div className="flex-1 flex flex-col justify-between">
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

                        {/* Large Value Display */}
                        <div className="my-2 flex items-baseline gap-2 flex-wrap">
                          <span className="text-3xl lg:text-4xl font-extrabold font-tabular text-[#263A35] tracking-tight">
                            {card.value}
                          </span>
                          <span className="text-xs sm:text-sm font-bold text-[#50645F] font-display whitespace-nowrap">
                            {card.unit}
                          </span>
                        </div>

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
                        <p className="text-xs text-[#50645F] leading-relaxed my-2 min-h-11">
                          {card.explanation}
                        </p>
                      </div>
                    </div>

                    {/* Metadata Footer */}
                    <div className="pt-3 mt-3 border-t border-[#D6DCCE] flex items-center justify-between gap-2 text-[10px] min-h-8.5">
                      <span className="font-semibold text-[#4E635E] bg-[#F5F4EE] px-2 py-0.5 rounded-md border border-[#E2E0CB] font-mono shrink-0 truncate max-w-[62%]">
                        {card.reference}
                      </span>
                      <span className="font-tabular text-[#50645F] font-medium truncate text-right">
                        {card.extra}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* 3. DUAL AI ANALYSIS GRID (model_hazard.h + AI Vision / FLORA Neural Network) */}
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
                        hazardResult.riskLevel === 'HIGH'
                          ? 'bg-[#FEEAEA] text-[#961C1C] border-[#FCCECE]'
                          : hazardResult.riskLevel === 'MODERATE'
                          ? 'bg-[#FEF7E8] text-[#8A570C] border-[#FDE3B5]'
                          : 'bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          hazardResult.riskLevel === 'HIGH'
                            ? 'bg-[#DC2626]'
                            : hazardResult.riskLevel === 'MODERATE'
                            ? 'bg-[#D97706]'
                            : 'bg-[#4E635E]'
                        }`}
                      />
                      {hazardResult.riskLevel} RISK
                    </span>
                  </div>

                  <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-4 my-2 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-[#50645F] uppercase tracking-wider block">
                        Assessed Fire Hazard Level
                      </span>
                      <span className="text-lg font-bold text-[#263A35] font-display block mt-0.5">
                        {hazardResult.riskLevel} Risk ({hazardResult.kaggleBinaryPrediction})
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-semibold text-[#50645F] uppercase tracking-wider block">
                        Model Confidence
                      </span>
                      <span className="text-base font-bold font-tabular text-[#4E635E] block mt-0.5">
                        {hazardResult.confidence.toFixed(2)}%
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
                          {hazardResult.highProbability.toFixed(2)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#E2E0CB] rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-[#961C1C] rounded-full flora-meter-bar"
                          style={{ width: `${Math.min(100, Math.max(0, hazardResult.highProbability))}%` }}
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
                          {hazardResult.moderateProbability.toFixed(2)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#E2E0CB] rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-[#8A570C] rounded-full flora-meter-bar"
                          style={{ width: `${Math.min(100, Math.max(0, hazardResult.moderateProbability))}%` }}
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
                          {hazardResult.lowProbability.toFixed(2)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#E2E0CB] rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-[#4E635E] rounded-full flora-meter-bar"
                          style={{ width: `${Math.min(100, Math.max(0, hazardResult.lowProbability))}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3.5 border-t border-[#D6DCCE]">
                    <h3 className="text-xs font-bold text-[#263A35] mb-2 flex items-center gap-1.5 font-display uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4E635E]" />
                      Why This Result? (Decision Tree Split Rationale)
                    </h3>
                    <ul className="text-xs text-[#50645F] space-y-1.5 pl-4 list-disc leading-relaxed">
                      <li>
                        <strong className="text-[#263A35]">FFMC = {ffmc.toFixed(1)}</strong>{' '}
                        {ffmc > 89.95
                          ? 'melewati ambang cabang utama pohon keputusan (> 89.95), mengindikasikan serasah sangat kering dan mudah tersulut.'
                          : ffmc >= 84.0
                          ? 'berada pada rentang transisi menengah (84.0 – 89.95).'
                          : 'berada di bawah ambang penyalaan (< 84.0), menahan perambatan api.'}
                      </li>
                      <li>
                        <strong className="text-[#263A35]">DMC = {dmc.toFixed(1)} &amp; Temp = {temp.toFixed(1)}°C</strong> (RH {rh.toFixed(0)}%, Wind {wind.toFixed(1)} km/h) menghasilkan Initial Spread Index <strong className="text-[#263A35]">ISI = {isi.toFixed(1)}</strong> dan Drought Code <strong className="text-[#263A35]">DC = {dc.toFixed(1)}</strong>.
                      </li>
                      <li>
                        Model mikroklimat pendamping (<code className="font-mono text-[#4E635E]">grenvis_sensor_model.h</code>) mengonfirmasi risiko <strong className="text-[#263A35]">{floraResult.sensorRisk.toUpperCase()} ({floraResult.sensorConfidence.toFixed(1)}%)</strong> pada kelembapan tanah {soilMoisture.toFixed(1)}%.
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#D6DCCE]">
                  <p className="text-[11px] text-[#50645F] leading-relaxed m-0">
                    Evaluasi bahaya kebakaran dieksekusi langsung dari kode C{' '}
                    <code className="text-[#4E635E] font-mono text-[10px]">model_hazard.h</code> (fitur input:{' '}
                    <code className="font-mono text-[10px]">[temp, RH, wind, rain, FFMC, DMC]</code>) yang dilatih pada dataset Montesinho Park (<code className="font-mono text-[10px]">forestfires.csv</code>).
                  </p>
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
                      Topologi Preset
                    </span>
                  </div>

                  <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-4 mb-4 flex justify-between items-center">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#50645F] tracking-wider block">
                        Dominant Optical Classification
                      </span>
                      <span className="text-lg font-bold text-[#263A35] font-display block mt-0.5">
                        {visionPrediction}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-semibold text-[#50645F] uppercase tracking-wider block">
                        Optical Stream
                      </span>
                      <span className="text-base font-bold font-tabular text-[#4E635E] block mt-0.5">
                        SVGA · 800×600
                      </span>
                    </div>
                  </div>

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

                  <div className="mt-4 pt-3.5 border-t border-[#D6DCCE] space-y-2.5">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#50645F] block">
                        Optical Fusion Interpretation
                      </span>
                      <p className="text-xs text-[#263A35] font-medium mt-0.5 leading-relaxed">
                        {visionPrediction === 'Active Surface Fire'
                          ? 'Kamera mendeteksi anomali termal/nyala api permukaan yang berkorelasi dengan indeks FFMC > 92 dan prediksi High Risk pada model_hazard.h.'
                          : visionPrediction === 'Smoke Plume Detected'
                          ? 'Terdeteksi kepulan asap putih/abu-abu di atas tajuk pohon. Selaras dengan vektor uji Kaggle x_new (On Fire).'
                          : 'Kanopi hutan tampak hijau sehat tanpa anomali asap maupun titik api permukaan.'}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#4E635E] block">
                        Recommended Action
                      </span>
                      <p className="text-xs text-[#263A35] font-medium mt-0.5 leading-relaxed">
                        {visionPrediction === 'Healthy Forest Canopy'
                          ? 'Pertahankan patroli rel otomatis berkala dan pantau kelembapan serasah.'
                          : 'Arahkan carriage kamera L298N ke titik koordinat sektor dan aktifkan penyiraman/pendinginan zona penyangga.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#D6DCCE] flex flex-wrap justify-between items-center gap-2">
                  <p className="text-[11px] text-[#50645F] leading-relaxed m-0 flex-1">
                    Inferensi visual dikombinasikan dengan skor probabilitas <code className="text-[#4E635E] font-mono text-[10px]">model_hazard.h</code> untuk meminimalkan false alarm.
                  </p>
                </div>
              </section>
            </div>

            {/* 4. INTERACTIVE SIMULATOR & KAGGLE BENCHMARKS SECTION */}
            <FloraKaggleSection
              temp={temp}
              rh={rh}
              wind={wind}
              rain={rain}
              ffmc={ffmc}
              dmc={dmc}
              dc={dc}
              isi={isi}
              soilMoisture={soilMoisture}
              activePresetId={activePresetId}
              hazardResult={hazardResult}
              floraResult={floraResult}
              onChangeParam={handleChangeParam}
              onSelectPreset={handleSelectPreset}
            />

            {/* 5. CAMERA STREAM CAPTURE SECTION (#cameraCapture) */}
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
                        <span>{captureSource === 'camera' ? 'FRAME FOTO KAMERA' : 'UNGGAHAN GAMBAR'}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Fallback Simulation Frame */}
                      <img
                        src={canopyFrameSvg}
                        alt="Simulated forest canopy preview"
                        className="w-full h-full object-cover absolute inset-0 opacity-25"
                      />
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
                            Buka kamera laptop/smartphone Anda atau unggah file foto untuk verifikasi visual langsung ke model AI.
                          </p>
                        </div>
                        <div className="flex gap-2 mt-1">
                          <button
                            type="button"
                            onClick={handleStartCamera}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#4E635E] hover:bg-[#3B4D49] text-white flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                          >
                            <Video size={13} />
                            <span>Buka Kamera</span>
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
                        ? `Mode: Karhutla · Rel: ${railPositionMm} mm · Source: ${captureSource === 'camera' ? 'Webcam' : captureSource === 'upload' ? 'Upload' : 'Simulasi'}`
                        : `Mode: Diagnosa Daun · Status Layanan: ${isLeafDiseaseApiConfigured() ? 'Tersambung' : 'Belum Dideploy'}`}
                    </div>

                    <div className="flex flex-wrap items-center justify-start sm:justify-end gap-1.5">
                      {visionDomain === 'wildfire' ? (
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
                        {new Date(lastCaptureTime).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}{' '}
                        <span className="text-xs font-normal text-[#50645F]">
                          ({captureSource === 'camera' ? 'Kamera' : captureSource === 'upload' ? 'Upload' : 'Preset'})
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
                            ? `${Math.max(visionProbs.healthy, visionProbs.smoke, visionProbs.fire).toFixed(1)}%`
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
                            ? 'Klasifikasi Karhutla (Railway API)'
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
                  <div className="bg-[#F5F4EE] border border-[#E2E0CB] p-3 rounded-xl flex items-start gap-2 text-[11px] text-[#50645F] leading-relaxed">
                    <Info size={14} className="shrink-0 mt-0.5 text-[#4E635E]" />
                    <p className="m-0">
                      {visionDomain === 'wildfire'
                        ? 'Inferensi terhubung ke API Railway FastAPI (MobileNetV2 TFLite). Mengirim gambar riil melalui multipart form field file.'
                        : 'Domain penyakit daun terisolasi secara independen. Tidak akan memanipulasi atau mengirim data daun ke model titik api.'}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* 6. SCANNER CARRIAGE MANUAL CONTROL (#device-control) */}
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
                  <span className={`w-2 h-2 rounded-full ${isLiveMqtt ? 'bg-[#16A34A] animate-pulse' : 'bg-[#4E635E]'}`} />
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
                    Carriage Position: {railPositionMm} mm ({((railPositionMm / 1200) * 100).toFixed(0)}%)
                  </span>
                  <span className={limitRight ? 'text-[#DC2626]' : 'text-[#4E635E]'}>
                    SW2 Right: {limitRight ? 'ACTIVE (1200mm)' : 'CLEAR'}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-[#E2E0CB] relative overflow-hidden">
                  <div
                    className="h-full bg-[#4E635E] rounded-full transition-all duration-300"
                    style={{ width: `${(railPositionMm / 1200) * 100}%` }}
                  />
                </div>
              </div>

              <div
                className="grid grid-cols-2 sm:grid-cols-4 gap-3"
                role="group"
                aria-label="Kontrol Scanner Motor Rel L298N"
              >
                <button
                  onClick={() => handleRailCommand('L')}
                  disabled={limitLeft}
                  aria-disabled={limitLeft}
                  aria-label="Gerakkan kamera rel ke kiri (L)"
                  className={`min-h-11 py-3 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 border shadow-xs cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E] ${
                    movementStatus === 'left_command_sent'
                      ? 'bg-[#4E635E] text-white border-[#4E635E] ring-2 ring-[#A6B49E]'
                      : 'bg-white hover:bg-[#F5F4EE] text-[#263A35] border-[#D6DCCE]'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <span aria-hidden="true">◀</span>
                  <span>Move Left (L)</span>
                </button>

                <button
                  onClick={() => handleRailCommand('S')}
                  aria-label="Hentikan darurat motor rel (S)"
                  className={`min-h-11 py-3 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 border shadow-xs cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#D97706] ${
                    movementStatus === 'stop_command_sent'
                      ? 'bg-[#D97706] text-white border-[#D97706]'
                      : 'bg-[#FEF7E8] hover:bg-[#FDE3B5] text-[#8A570C] border-[#FDE3B5]'
                  }`}
                >
                  <span aria-hidden="true">■</span>
                  <span>Stop Motor (S)</span>
                </button>

                <button
                  onClick={() => handleRailCommand('R')}
                  disabled={limitRight}
                  aria-disabled={limitRight}
                  aria-label="Gerakkan kamera rel ke kanan (R)"
                  className={`min-h-11 py-3 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 border shadow-xs cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E] ${
                    movementStatus === 'right_command_sent'
                      ? 'bg-[#4E635E] text-white border-[#4E635E] ring-2 ring-[#A6B49E]'
                      : 'bg-white hover:bg-[#F5F4EE] text-[#263A35] border-[#D6DCCE]'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <span>Move Right (R)</span>
                  <span aria-hidden="true">▶</span>
                </button>

                <button
                  onClick={() => handleRailCommand('C')}
                  aria-label="Trigger tangkapan foto kamera pada posisi rel (C)"
                  className="min-h-11 py-3 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 border shadow-xs bg-[#EFF3EF] hover:bg-[#E2E0CB] text-[#263A35] border-[#A6B49E] cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#4E635E]"
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
                        hazardResult.riskLevel === 'HIGH'
                          ? 'bg-[#FEEAEA] text-[#961C1C] border-[#FCCECE]'
                          : hazardResult.riskLevel === 'MODERATE'
                          ? 'bg-[#FEF7E8] text-[#8A570C] border-[#FDE3B5]'
                          : 'bg-[#EFF3EF] text-[#263A35] border-[#A6B49E]'
                      }`}
                    >
                      {hazardResult.riskLevel} Priority
                    </span>
                  </div>

                  <div className="bg-[#F5F4EE] border border-[#E2E0CB] rounded-xl p-4 my-3">
                    <span className="text-[10px] font-bold text-[#4E635E] uppercase tracking-wider block mb-1">
                      Current Assessment
                    </span>
                    <p className="text-xs text-[#263A35] leading-relaxed font-medium m-0">
                      {hazardResult.riskLevel === 'HIGH'
                        ? `Indeks FFMC (${ffmc.toFixed(1)}) dan DMC (${dmc.toFixed(1)}) mengindikasikan bahaya kebakaran tinggi (${hazardResult.confidence.toFixed(1)}%). Lakukan pendinginan serasah dan verifikasi kamera.`
                        : hazardResult.riskLevel === 'MODERATE'
                        ? `Kondisi serasah mulai mengering (FFMC ${ffmc.toFixed(1)}). Siagakan pompa penyiraman zona penyangga.`
                        : 'Kondisi kanopi hutan dan kelembapan tanah dalam rentang optimal. Pertahankan jadwal patroli rutin.'}
                    </p>
                  </div>

                  <div className="my-3">
                    <span className="text-xs font-bold text-[#263A35] block mb-2 font-display uppercase tracking-wider">
                      Recommended Action Checklist:
                    </span>
                    <ul className="text-xs text-[#263A35] space-y-2 pl-4 list-disc font-medium">
                      {ffmc >= 89.5 && (
                        <li className="leading-relaxed">
                          <strong>FFMC Kritis ({ffmc.toFixed(1)} ≥ 89.5):</strong> Aktifkan penyiraman kabut (misting) pada zona penyangga untuk menurunkan keterbakaran serasah permukaan.
                        </li>
                      )}
                      {soilMoisture < 35 && (
                        <li className="leading-relaxed">
                          <strong>Defisit Kelembapan Tanah ({soilMoisture.toFixed(1)}%):</strong> Lakukan irigasi bertahap untuk menjaga hidrasi perakaran dan menurunkan DMC.
                        </li>
                      )}
                      {wind >= 5.5 && (
                        <li className="leading-relaxed">
                          <strong>Kecepatan Angin Tinggi ({wind.toFixed(1)} km/h):</strong> Pantau arah angin karena nilai ISI ({isi.toFixed(1)}) dapat mempercepat laju rambat api.
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
                        Soil moisture: <strong className="text-[#263A35]">{soilMoisture.toFixed(0)}%</strong> · FFMC:{' '}
                        <strong className="text-[#263A35]">{ffmc.toFixed(1)}</strong>
                      </span>
                    </div>
                    <h2 className="text-lg sm:text-xl font-bold text-[#263A35] font-display">
                      {soilMoisture < 30 || ffmc >= 90
                        ? 'Attention Needed: Wetting Recommended'
                        : 'Soil & Fuel Moisture Sufficient'}
                    </h2>
                    <p className="text-xs text-[#50645F] mt-1 leading-relaxed m-0">
                      Catat tindakan penyiraman atau pendinginan serasah untuk memperbarui riwayat hidrasi dan menurunkan indeks FFMC secara simulasi.
                    </p>
                  </div>

                  {wateringEvents[0] && (
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
                        <span>Soil Before: {wateringEvents[0].soilBefore.toFixed(1)}%</span>
                        <span className="text-[#50645F]/40">·</span>
                        <span className="truncate">{wateringEvents[0].note}</span>
                      </div>
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
            <FloraHistoryCanvas history={history} />

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
                  Telemetry Stream (Preset Nodes)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 lg:gap-4">
                {[
                  { label: 'ESP32 Main Node', status: isLiveMqtt ? 'ONLINE LIVE' : 'PRESET READY', detail: `MAC: 8C:AA:B5:37:71:18 · Node: ${activeNodeId || 'ESP32-MAIN'} · ${isLiveMqtt ? 'Realtime Telemetry Active' : 'Siap Terhubung via EMQX'}` },
                  { label: 'ESP32-CAM Node', status: isLiveMqtt ? 'ONLINE' : 'PRESET READY', detail: 'MAC: F8:B3:B7:A6:F3:9C · Railway API Active' },
                  { label: 'C Edge Kernel 1', status: 'ACTIVE', detail: 'model_hazard.h (100 Trees RF in-memory)' },
                  { label: 'C Edge Kernel 2', status: 'ACTIVE', detail: 'grenvis_sensor_model.h (TFLite in-memory)' },
                  {
                    label: 'MQTT Broker',
                    status: isLiveMqtt ? 'CONNECTED LIVE' : 'CONFIGURED',
                    detail: 'EMQX Cloud · Port 8084 (WSS) / 8883 (TLS) · Klik untuk Uji',
                    interactive: true,
                    onClick: () => setMqttModalOpen(true),
                  },
                  { label: 'ESP-NOW Link', status: 'ACTIVE', detail: 'Inter-Board Wireless Mesh (CH 6)' },
                  { label: '5 Hardware Sensor Node', status: isLiveMqtt ? 'STREAMING' : 'CALIBRATED', detail: 'Suhu, RH (DHT22), Tanah (v1.2), Cahaya (LDR), Hujan (FC-37)' },
                  { label: 'Scanner Motor L298N', status: isLiveMqtt ? 'OUT3/4 LIVE' : 'SIMULATED', detail: `${motorDriverInfo} (GPIO 16 & 17) · @ ${railPositionMm} mm` },
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

            {/* 10. FOOTER */}
            <footer className="mt-12 py-8 border-t border-[#D6DCCE] text-center text-xs text-[#50645F]">
              <div className="flex items-center justify-center gap-2 mb-1.5 flex-wrap">
                <span className="font-bold text-[#263A35] font-display flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#4E635E">
                    <path d="M12 0 C12 7 17 12 24 12 C17 12 12 17 12 24 C12 17 7 12 0 12 C7 12 12 7 12 0 Z" />
                  </svg>
                  <span>AGRAPATHA × FLORA</span>
                </span>
                <span>·</span>
                <span>Smart Forest Fire &amp; Botanical AI Vision</span>
                <span>·</span>
                <span className="text-[#4E635E] font-semibold">
                  model_hazard.h (517 Montesinho) &amp; grenvis_sensor_model.h (9,000 FLORA)
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

        {/* EMQX Cloud MQTT Diagnostic & Testing Modal */}
        <MqttTestModal
          isOpen={mqttModalOpen}
          onClose={() => setMqttModalOpen(false)}
          onApplyTelemetry={(data) => {
            setTemp(data.temp);
            setRh(data.rh);
            setSoilMoisture(data.soilMoisture);
            if (data.rain !== undefined) setRain(data.rain);
            showToast(`Telemetri EMQX: ${data.temp}°C · RH ${data.rh}% · Tanah ${data.soilMoisture}% · Hujan ${data.rain ?? 0} mm/h`);
          }}
        />
      </div>
    </div>
  );
};

export default App;
