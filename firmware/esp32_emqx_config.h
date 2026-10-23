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

// --- 1. Wi-Fi Network Credentials ---
#define WIFI_SSID               "."
#define WIFI_PASSWORD           "01020304"

// --- 2. EMQX Cloud Settings (Port 8883 Native TLS) ---
#define MQTT_BROKER_HOST        "wfc1ec11.ala.asia-southeast1.emqxsl.com"
#define MQTT_TLS_PORT           8883
#define MQTT_USERNAME           "grenvis_esp32"
#define MQTT_PASSWORD           "grenvis123"

// --- 3. MQTT Topic Namespaces ---
#define TOPIC_TELEMETRY_DATA    "grenvis/sensor/data"
#define TOPIC_TELEMETRY_AGRA    "agrapatha/telemetry"
#define TOPIC_STATUS            "grenvis/sensor/status"
#define TOPIC_VISION_DATA       "grenvis/vision/data"
#define TOPIC_VISION_IMAGE      "grenvis/vision/image"
#define TOPIC_CONTROL_GRENVIS   "grenvis/device/control"
#define TOPIC_CONTROL_AGRA      "agrapatha/commands"

// --- 4. ESP32 Main Node Sensor Pins ---
#define PIN_DHT                 19 // DHT22 (Air Temp & RH)
#define PIN_SOIL                34 // Capacitive Soil Moisture v1.2 (ADC1_CH6)
#define PIN_RAIN                35 // Rain Droplet Intensity Sensor (ADC1_CH7)
#define PIN_LDR                 36 // LDR Light Sensor (Sensor VP / ADC1_CH0)

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
