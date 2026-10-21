# AGRAPATHA — Autonomous Forest Fire & Botanical Observation System

AGRAPATHA is an intelligent environmental monitoring and early warning system combining Edge-AI C kernels (`model_hazard.h`, `grenvis_sensor_model.h`), Canadian Forest Fire Weather Index (FWI) telemetry, macro-regional BMKG forecast integration, and an optical computer vision subsystem with manual browser fallback.

---

## 1. System Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │          AGRAPATHA Web Dashboard            │
                    │         (React 19 + TypeScript + Vite)       │
                    └───────┬──────────────┬──────────────┬────────┘
                            │              │              │
             ┌──────────────┘              │              └──────────────┐
             ▼                             ▼                             ▼
┌────────────────────────┐   ┌───────────────────────────┐   ┌─────────────────────────┐
│   Wildfire Vision API  │   │  Leaf Disease Vision API  │   │   BMKG Weather Gateway  │
│   (FastAPI on Railway) │   │     (Future Deployment)   │   │     (Node.js Service)   │
│   MobileNetV2 TFLite   │   │  MobileNetV3Large TFLite  │   │   Proxy & Cache Layer   │
└────────────────────────┘   └───────────────────────────┘   └─────────────────────────┘
```

1. **Dashboard Frontend (`agrapatha-dashboard/`)**: Single-page application providing real-time telemetry gauges, interactive Kaggle C-header simulator, weather warnings, actuator rail controls, and optical camera stream diagnostics.
2. **Vision Subsystem**: Dual-domain classification supporting Wildfire hotspot verification and Plant Leaf Pathology diagnosis.
3. **BMKG Gateway (`backend/`)**: Zero-dependency Node.js HTTP reverse-proxy caching official BMKG regional forecasts and extreme weather alerts.
4. **Edge AI Kernels**: C-header machine learning models (`model_hazard.h` Random Forest and `grenvis_sensor_model.h` Neural Network) executed directly in memory for instant decision support.

---

## 2. Vision Subsystem & Dual-Domain Inference

The `#cameraCapture` section provides real-time visual inspection with a dual-domain selector:

### A. Wildfire Classification Domain (Active & Verified)
- **Deployed Backend:** `https://tes-tflite-production.up.railway.app`
- **Health Endpoint:** `GET /api/v1/health`
- **Prediction Endpoint:** `POST /api/v1/predict` (multipart `file`)
- **Model Architecture:** MobileNetV2 with custom dense classifier head (`agrapatha_vision_mobilenetv2.tflite`, 2.68 MB)
- **Runtime:** `ai-edge-litert` (Python 3.11)
- **Input Dimensions:** `[1, 224, 224, 3]`, Float32, normalized `[-1.0, 1.0]`
- **Verified Classes:**
  1. `Non-Fire` (Healthy canopy)
  2. `Smoke` (Smoke plume)
  3. `Fire` (Surface fire)
- **Frontend Configuration:** Configurable via `VITE_VISION_API_BASE_URL` (defaults to verified Railway URL).

### B. Leaf Disease Classification Domain (Prepared & Isolated)
- **Candidate Model:** PlanTech-AI (`AhmAshraf1/PlanTech-AI`, MIT License)
- **Model Architecture:** MobileNetV3Large fine-tuned on PlantDoc dataset (`plant_model_3Classes.tflite`, 12.89 MB)
- **Input Dimensions:** `[1, 224, 224, 3]`, Float32, normalized via MobileNetV3 preprocess input `[-1.0, 1.0]`
- **Target Endpoint:** `POST /api/v1/leaf/predict` (multipart `file`)
- **Verified Output Class Order & Label Mapping:**
  - Index 0: `Healthy` → `Healthy`
  - Index 1: `Powdery` → `Powdery Mildew`
  - Index 2: `Rust` → `Leaf Rust`
- **Frontend Configuration:** Configurable via `VITE_LEAF_API_BASE_URL`.
- **Strict Isolation:** When unconfigured, the dashboard displays an informative Indonesian status banner. It **never** sends leaf images to the wildfire API and never fabricates mock predictions.

---

## 3. Manual Camera Fallback Workflow

When an ESP32-CAM hardware stream is unavailable or unverified, the browser-based camera fallback provides immediate manual operation:

1. **Browser Camera Capture:** Uses `navigator.mediaDevices.getUserMedia` with video-only constraints (`audio: false`).
2. **Lifecycle Safety:** Utilizes a callback ref (`setVideoElement`) and reactive state synchronization to guarantee `srcObject` attachment to the mounted `<video>` element, eliminating blank preview screens.
3. **Readiness Check:** Video preview is considered active only when genuine dimensions (`videoWidth > 0 && videoHeight > 0`) are confirmed via metadata listeners before enabling frame capture.
4. **Frame Capture:** Draws the current video frame to an offscreen `<canvas>` and exports a clean JPEG `Blob`. Active camera tracks are terminated immediately upon capture to conserve hardware power.
5. **Image Upload Alternative:** Allows selecting any local image (`accept="image/*"`) with automated MIME type validation and a 10 MB file-size limit.
6. **Memory Hygiene:** Browser object URLs (`URL.createObjectURL`) are systematically revoked upon retake, replacement, or component unmount.

---

## 4. Hardware Telemetry & ESP32-CAM Status Audit

- **Current State:** Physical ESP32-CAM video streaming and live MQTT telemetry (`MAC: F8:B3:B7:A6:F3:9C`) are currently **unverified preset topology nodes** in the frontend. There is no active MQTT broker connection or hardware polling agent running in the web browser.
- **Independence:** The manual camera fallback operates completely independently of physical ESP32-CAM connectivity, allowing operators to capture photos directly via laptop or smartphone cameras at any time.
- **Future Integration:** Connecting live hardware requires deploying an MQTT WebSocket bridge or ESP32-CAM HTTP MJPEG gateway before reporting hardware nodes as live.

---

## 5. Environment Variables

Create `.env` in `agrapatha-dashboard/` based on `.env.example`:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `VITE_VISION_API_BASE_URL` | `https://tes-tflite-production.up.railway.app` | Base URL for deployed Wildfire inference API |
| `VITE_LEAF_API_BASE_URL` | `""` (Unconfigured) | Base URL for Leaf Disease inference API (`POST /api/v1/leaf/predict`) |
| `VITE_BMKG_BASE_URL` | `""` (Direct BMKG) | Optional proxy URL for BMKG Regional Gateway |

---

## 6. Testing & Build Instructions

### Frontend (`agrapatha-dashboard/`)

```bash
cd agrapatha-dashboard

# Install dependencies
npm install

# Run automated unit tests (BMKG parser + Vision & Camera subsystems)
node --experimental-strip-types --test src/lib/bmkgService.test.ts src/lib/visionService.test.ts

# Run static linter
npm run lint

# Compile TypeScript & production bundle
npm run build

# Start local development server
npm run dev
```

### Backend BMKG Gateway (`backend/`)

```bash
cd backend

# Run gateway automated tests
npm test

# Start local gateway server (port 3000)
npm start
```

---

## 7. License

- AGRAPATHA Core Codebase: MIT License
- PlanTech-AI Model Candidate: MIT License (Copyright 2024 Ahmed Ashraf Helmi)
