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

## 4. Hardware Telemetry & EMQX MQTT Infrastructure

- **EMQX Broker Host:** `wfc1ec11.ala.asia-southeast1.emqxsl.com` (EMQX Cloud Serverless Cluster)
- **Port Adaptation:**
  - **Browser Dashboard (WSS):** Port `8084` (`wss://wfc1ec11.ala.asia-southeast1.emqxsl.com:8084/mqtt`). Web browsers cannot establish direct TCP connections to port 8883 due to sandbox restrictions, so WebSocket over TLS/SSL is required.
  - **ESP32 Hardware & Node.js CLI (Native TLS):** Port `8883` (`mqtts://wfc1ec11.ala.asia-southeast1.emqxsl.com:8883`). Microcontrollers use native TCP with TLS encryption (configured via `firmware/esp32_emqx_config.h`).
- **Topic Namespaces:**
  - Telemetry Stream: `agrapatha/telemetry` (JSON sensor payload)
  - Interlock & Carriage Commands: `agrapatha/commands`
  - Health & Node Status: `agrapatha/status`
- **Authentication:** EMQX Cloud requires Username/Password authentication (Password-Based Auth created in the EMQX Cloud Console).

---

## 5. Zero-Config Configuration Architecture (No .env Required)

Proyek ini menggunakan arsitektur **Single Source of Truth (`src/config/iotConfig.ts`)** yang dirancang khusus untuk IoT:
- **Zero-Config (Plug & Play):** Tidak membutuhkan file `.env` untuk berjalan. Saat repo di-clone dan dijalankan dengan `npm run dev`, dashboard langsung terhubung ke EMQX Cloud dan Railway API.
- **Hardware Parity:** Konfigurasi web selaras 100% dengan firmware ESP32 (`firmware/esp32_emqx_config.h`).
- **Runtime Persistence (LocalStorage):** Parameter broker atau kredensial dapat diedit langsung melalui modal UI di dashboard tanpa perlu restart server atau edit kode.
- **Optional Env Fallback:** Jika variabel environment (`.env`) ada (misal di pipeline CI/CD), sistem tetap dapat membacanya sebagai prioritas.

| Parameter | Default (Out-of-the-Box) | Deskripsi |
| :--- | :--- | :--- |
| `Broker Host` | `wfc1ec11.ala.asia-southeast1.emqxsl.com` | Host EMQX Cloud Serverless |
| `Browser Port (WSS)` | `8084` | Port WebSocket aman untuk Web Dashboard |
| `Hardware Port (TLS)` | `8883` | Port MQTTS TCP aman untuk ESP32 |
| `Username / Password` | `grenvis_esp32` / `grenvis123` | Kredensial aktif EMQX Cloud |
| `Wildfire API URL` | `https://tes-tflite-production.up.railway.app` | Backend FastAPI MobileNetV2 |
| `Topic Telemetry` | `agrapatha/telemetry` & `grenvis/sensor/data` | Topik stream data sensor |
| `Topic Control` | `agrapatha/commands` & `grenvis/device/control` | Topik kendali motor rel & trigger foto |

---

## 6. Testing & Build Instructions

### Frontend (`agrapatha-dashboard/`)

```bash
cd agrapatha-dashboard

# Install dependencies
npm install

# Run automated unit tests (BMKG parser + Vision + EMQX MQTT)
npm test

# Run EMQX Broker Diagnostics (Tests Port 8883 TLS & Port 8084 WSS)
npm run test:mqtt

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
