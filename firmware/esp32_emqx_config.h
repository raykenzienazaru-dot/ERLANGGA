/**
 * ==============================================================================
 * AGRAPATHA & GRENVIS — HARDWARE & CLOUD CONFIGURATION HEADER
 * Target: ESP32 DevKit V1 & AI-Thinker ESP32-CAM
 * ==============================================================================
 * PORT MAPPING SPECIFICATION:
 * - ESP32 Hardware (MQTTS Native TCP over TLS): PORT 8883
 * - Web Browser Dashboard (WSS over TLS): PORT 8084
 * ==============================================================================
 */

#ifndef AGRAPATHA_HARDWARE_CONFIG_H
#define AGRAPATHA_HARDWARE_CONFIG_H

// --- 1. Wi-Fi Network Credentials (Decoupled) ---
// NOTE: Wi-Fi credentials must be supplied via sketch-local credentials.h
// (e.g., firmware/esp32_sensor_main/credentials.h or firmware/esp32_cam_node/credentials.h).
// Do not hardcode or commit Wi-Fi credentials here.

// --- 2. EMQX Cloud Settings (Port 8883 Native TLS) ---
#define MQTT_BROKER_HOST        "wfc1ec11.ala.asia-southeast1.emqxsl.com"
#define MQTT_TLS_PORT           8883
// NOTE: MQTT authentication credentials (SECRET_MQTT_USERNAME & SECRET_MQTT_PASSWORD)
// must be supplied via sketch-local credentials.h. Do not commit credentials here.

// --- 3. MQTT Topic Namespaces ---
#define TOPIC_TELEMETRY_DATA    "grenvis/sensor/data"
#define TOPIC_TELEMETRY_AGRA    "agrapatha/telemetry"
#define TOPIC_STATUS            "grenvis/sensor/status"
#define TOPIC_VISION_DATA       "grenvis/vision/data"
#define TOPIC_VISION_IMAGE      "grenvis/vision/image"
#define TOPIC_CONTROL_GRENVIS   "grenvis/device/control"
#define TOPIC_CONTROL_AGRA      "agrapatha/commands"

// --- 4. ESP32 Main Node Sensor Pins (Confirmed Hardware) ---
#define PIN_DHT                 19 // DHT22 (Air Temp & RH) - Confirmed
#define PIN_SOIL                34 // Capacitive Soil Moisture v1.2 (ADC1_CH6) - Confirmed

// NOTE: MQ-135 Gas & Flame Sensor GPIO assignments require physical rig verification.
// - MQ-135 AO must connect to an ADC1 pin (GPIO 32-39) through a voltage divider (max 3.3V).
// - Flame Sensor DO (Digital) and AO (Analog) are separate pins on the module and must not be conflated onto one pin.
// Default unverified candidates below:
#ifndef PIN_MQ135_AO
  #define PIN_MQ135_AO          35 // ADC1_CH7 (Candidate - requires verification & voltage divider <= 3.3V)
#endif
#define PIN_MQ135               PIN_MQ135_AO // Alias for backwards compatibility

// Flame Sensor Mode: Select whether DO (digital) or AO (analog) is physically wired.
// 0 = Digital DO wired, 1 = Analog AO wired
#ifndef FLAME_SENSOR_USE_ANALOG
  #define FLAME_SENSOR_USE_ANALOG 0
#endif

#ifndef PIN_FLAME_DO
  #define PIN_FLAME_DO          36 // Sensor VP / GPIO 36 (Candidate for Digital Output DO)
#endif

#ifndef PIN_FLAME_AO
  #define PIN_FLAME_AO          39 // Sensor VN / ADC1_CH3 (Candidate if Analog Output AO is wired)
#endif

#define PIN_FLAME               PIN_FLAME_DO // Default alias

// Flame Sensor Polarity: 1 if active-LOW (typical LM393 DO module: LOW when flame detected), 0 if active-HIGH
#ifndef FLAME_ACTIVE_LOW
  #define FLAME_ACTIVE_LOW      1
#endif

// --- 5. ESP32 Main Node Actuator & Limit Pins (L298N OUT3 & OUT4) ---
#define PIN_MOTOR_IN3           16 // L298N IN3 (Drives Motor OUT3)
#define PIN_MOTOR_IN4           17 // L298N IN4 (Drives Motor OUT4)
#define PIN_MOTOR_IN1           PIN_MOTOR_IN3 // Legacy alias
#define PIN_MOTOR_IN2           PIN_MOTOR_IN4 // Legacy alias
#define PIN_LIMIT_LEFT          32 // Limit Switch Left (INPUT_PULLUP)
#define PIN_LIMIT_RIGHT         33 // Limit Switch Right (INPUT_PULLUP)

// --- 6. Railway Cloud AI Inference API ---
#define RAILWAY_AI_HOST         "tes-tflite-production.up.railway.app"
#define RAILWAY_AI_PATH         "/api/v1/predict"

// --- 7. ESP-NOW Hardware MAC Addresses ---
#define MAC_ESP32_MAIN          { 0x8C, 0xAA, 0xB5, 0x37, 0x71, 0x18 }
#define MAC_ESP32_CAM           { 0xF8, 0xB3, 0xB7, 0xA6, 0xF3, 0x9C }
#define DEFAULT_WIFI_CHANNEL    6

#endif // AGRAPATHA_HARDWARE_CONFIG_H
