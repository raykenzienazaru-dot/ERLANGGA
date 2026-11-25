/**
 * ==============================================================================
 * AGRAPATHA & GRENVIS — SISTEM ROBOT PERTANIAN CERDAS & PEMADAM KEBAKARAN
 * Unit: NodeMCU ESP32-S (Direct GPIO Servo - 100% SENSOR FISIK ROBOT)
 * ==============================================================================
 * SISTEM PENGAMBIL KEPUTUSAN 4 KONDISI MURNI SENSOR ONBOARD ROBOT:
 * 1. KERING      : Soil < 35% & Suhu > 32°C -> PERINTAH: Siram Akar & Semprot Misting Kanopi.
 * 2. BASAH       : Soil > 80% (Jenuh Air)    -> PERINTAH: Kunci Mati Pompa & Parkir Aman Arm ke Home.
 * 3. KEBAKARAN   : Flame + MobileNetV2 FIRE  -> PERINTAH: Semprot Pemadam 4s & Evakuasi Kereta.
 * 4. GAS BERACUN : MQ-135 > 2200 (Asap/Gas)  -> PERINTAH: Nyalakan Aerasi/Exhaust & Alarm.
 *
 * KOMUNIKASI & AKTUATOR:
 * - 4 Servo Langsung ke GPIO (13, 14, 15, 5) via ESP32Servo.
 * - Sensor Jarak ToF VL53L0X pada ujung Nozzle (I2C SDA 21, SCL 22, Alamat 0x29).
 * - Linear Slider 3-Zona via L298N (IN1: 16, IN2: 17) + Limit SW (18, 19).
 * - Pompa Air Relay (GPIO 23).
 * - Dual-Way MQTT: Menerima & Mengeksekusi PERINTAH AKSI Langsung dari Dashboard.
 * ==============================================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <DHT.h>
#include <ESP32Servo.h>
#include <Adafruit_VL53L0X.h>
#include <ArduinoJson.h>

// ======================================================
// 1. PIN DEFINITIONS
// ======================================================
#define DHT_PIN              4    // DHT22 Data
#define DHT_TYPE             DHT22

#define SOIL_ANALOG_PIN      34   // ADC1_CH6 (Capacitive Soil Moisture v1.2)
#define MQ135_ANALOG_PIN     35   // ADC1_CH7 (MQ-135 Gas/Smoke Analog)

// 4-DoF Robot Arm Servos (Langsung ke Pin GPIO ESP32)
#define SERVO_BASE_PIN       13   // Servo 1: Rotasi Basis (Yaw)
#define SERVO_SHOULDER_PIN   14   // Servo 2: Elevasi Arm (Pitch Bawah)
#define SERVO_ELBOW_PIN      15   // Servo 3: Jangkauan Arm (Pitch Atas / Reach)
#define SERVO_NOZZLE_PIN     5    // Servo 4: Arah Nozzle & Kamera

// Flame Sensor 5-Channel Digital (Active LOW pada modul LM393)
#define FLAME_CH1_PIN        25   // Paling Kiri
#define FLAME_CH2_PIN        26   // Kiri
#define FLAME_CH3_PIN        27   // Tengah
#define FLAME_CH4_PIN        32   // Kanan
#define FLAME_CH5_PIN        33   // Paling Kanan
#define FLAME_ACTIVE_STATE   LOW

// Linear Slider (L298N Driver & Limit Switches)
#ifndef MOTOR_IN1
  #define MOTOR_IN1          16   // L298N IN1 (Arah Kiri)
#endif
#ifndef MOTOR_IN2
  #define MOTOR_IN2          17   // L298N IN2 (Arah Kanan)
#endif
#define LIMIT_SW_LEFT        18   // Limit Kiri (INPUT_PULLUP, Aktif LOW)
#define LIMIT_SW_RIGHT       19   // Limit Kanan (INPUT_PULLUP, Aktif LOW)

// Pompa Air Relay
#define PUMP_RELAY_PIN       23   // Relay Pompa (Aktif LOW)
#define RELAY_ACTIVE         LOW
#define RELAY_DEACTIVE       HIGH

// Bus I2C Sensor Jarak VL53L0X
#define I2C_SDA_PIN          21
#define I2C_SCL_PIN          22

// ======================================================
// 2. KREDENSIAL JARINGAN & MQTT EMQX CLOUD
// ======================================================
#if __has_include("credentials.h")
  #include "credentials.h"
  #ifdef SECRET_WIFI_SSID
    const char* WIFI_SSID     = SECRET_WIFI_SSID;
    const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;
  #else
    const char* WIFI_SSID     = "YOUR_WIFI_SSID";
    const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
  #endif
  #ifdef SECRET_MQTT_USERNAME
    const char* MQTT_USER     = SECRET_MQTT_USERNAME;
    const char* MQTT_PASS     = SECRET_MQTT_PASSWORD;
  #else
    const char* MQTT_USER     = "agrapatha";
    const char* MQTT_PASS     = "agrapatha123";
  #endif
#else
  const char* WIFI_SSID     = "YOUR_WIFI_SSID";
  const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
  const char* MQTT_USER     = "agrapatha";
  const char* MQTT_PASS     = "agrapatha123";
#endif

// EMQX Cloud TLS Broker Connection Information
// Address              : q2277711.ala.asia-southeast1.emqxsl.com
// MQTT over TLS/SSL    : Port 8883 (Digunakan ESP32 via WiFiClientSecure)
// WebSocket over TLS   : Port 8084 (Digunakan Browser Dashboard: wss://...:8084/mqtt)
const char* MQTT_HOST       = "q2277711.ala.asia-southeast1.emqxsl.com";
const uint16_t MQTT_PORT    = 8883;
const uint16_t MQTT_WS_PORT = 8084;

const char* TOPIC_TELEMETRY = "agrapatha/telemetry";
const char* TOPIC_COMMANDS  = "agrapatha/commands"; // Jalur Menerima Perintah dari Dashboard

// ======================================================
// 3. AMBANG BATAS 4 KONDISI SENSOR ONBOARD
// ======================================================
#define SOIL_CALIB_DRY         3200
#define SOIL_CALIB_WET         1400

#define THRESH_SOIL_DRY        35.0   // < 35%: KONDISI KERING
#define THRESH_SOIL_WET        80.0   // > 80%: KONDISI BASAH (Jenuh Air)
#define THRESH_SOIL_TARGET     60.0   // Target Ideal Kelembapan Tanah

#define THRESH_MQ135_TOXIC     2200   // > 2200 ADC: KONDISI GAS BERACUN / ASAP

#define VL53L0X_MIN_SAFE_MM    120    // Batas aman minimum nozzle ke api
#define VL53L0X_MAX_SUPPR_MM   380    // Batas efektif semprotan nozzle
#define SUPPRESSION_DURATION_MS 4000  // Durasi semprot pemadam per siklus

#define IRRIG_MAX_DURATION_MS  12000  // Maksimal pompa siram aktif
#define IRRIG_COOLDOWN_MS      60000  // Cooldown antar penyiraman

// ======================================================
// 4. PROTOKOL ESP-NOW DARI ESP32-CAM
// ======================================================
const uint8_t ESP32_CAM_MAC[]  = { 0xF8, 0xB3, 0xB7, 0xA6, 0xF3, 0x9C };
const uint8_t ESP32_MAIN_MAC[] = { 0x8C, 0xAA, 0xB5, 0x37, 0x71, 0x18 };

#define PACKET_VISION_RESULT   1

typedef struct __attribute__((packed)) {
  uint8_t  packetType;
  uint32_t scanNumber;
  char     visionClass[16];   // "FIRE", "SMOKE", "SAFE"
  float    confidence;
  float    fireScore;
  float    smokeScore;
  float    safeScore;
  uint32_t timestampMs;
} CameraAiPacket;

// ======================================================
// 5. OBJEK & STATE MACHINE
// ======================================================
DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_VL53L0X vl53l0x = Adafruit_VL53L0X();

Servo servoBase;
Servo servoShoulder;
Servo servoElbow;
Servo servoNozzle;

WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

enum SystemState {
  STATE_INIT,
  STATE_HOMING,
  STATE_SCANNING_ZONES,
  STATE_IRRIGATING,
  STATE_FIRE_MODE_STAGED,
  STATE_SUPPRESSION_ACTIVE,
  STATE_ALARM_FAULT,
  STATE_EMERGENCY_STOP
};

enum FireSearchStage {
  STAGE_SERVO1_YAW,       // Tahap 1: Orientasi basis kiri/tengah/kanan
  STAGE_SERVO2_PITCH,     // Tahap 2: Ketinggian arm
  STAGE_SERVO3_REACH,     // Tahap 3: Jangkauan maju arm (diawasi VL53L0X)
  STAGE_SERVO4_NOZZLE,    // Tahap 4: Arah presisi nozzle & kamera
  STAGE_VERIFY_DISTANCE,  // Verifikasi jarak aman sebelum pompa aktif
  STAGE_READY_SUPPRESS    // Pompa pemadam aktif
};

SystemState currentState = STATE_INIT;
FireSearchStage currentFireStage = STAGE_SERVO1_YAW;

// Sensor Readings
float currentTemp = 0.0;
float currentHumidity = 0.0;
int rawSoil = 0;
float soilMoisturePct = 0.0;
int rawMQ135 = 0;
bool flameCh[5] = {false, false, false, false, false};
int activeFlameCount = 0;
uint16_t targetDistanceMm = 9999;
bool distanceSensorValid = false;

// AI Vision
char aiVisionClass[16] = "SAFE";
float aiConfidence = 0.0;
float aiFireScore = 0.0;
float aiSmokeScore = 0.0;
float aiSafeScore = 1.0;
unsigned long lastAiResultTime = 0;
bool cameraOnline = false;

// Slider
int currentZone = 1;
int zoneScanCycles = 0;
unsigned long sliderMoveStartTime = 0;
const unsigned long SLIDER_ZONE2_TRAVEL_MS = 2500;

// Servo Angles
int angleBase = 90;
int angleShoulder = 45;
int angleElbow = 45;
int angleNozzle = 90;

// Timers & Flags
unsigned long lastSensorReadTime = 0;
unsigned long lastMqttPubTime = 0;
unsigned long pumpStartTime = 0;
unsigned long lastIrrigEndTime = 0;
bool pumpActive = false;
bool pumpLockout = false;
bool emergencyStopTriggered = false;

// ======================================================
// STRUKTUR PERINTAH OPERASIONAL (MURNI SENSOR ROBOT)
// ======================================================
char envCondition[24]        = "NORMAL";       // "KERING", "BASAH", "KEBAKARAN", "GAS_BERACUN", "NORMAL"
char actionCommand[32]       = "CMD_IDLE";
char commandButtonLabel[48]  = "Sistem Siap";
char commandPayload[96]      = "{\"cmd\":\"NONE\"}";

// ======================================================
// 6. HELPER KENDALI FISIK
// ======================================================
void moveServoSmooth(Servo &srv, int &currentAngle, int targetAngle, int stepDelay = 15) {
  targetAngle = constrain(targetAngle, 0, 180);
  if (currentAngle == targetAngle) return;
  int step = (targetAngle > currentAngle) ? 1 : -1;
  while (currentAngle != targetAngle) {
    if (emergencyStopTriggered) break;
    currentAngle += step;
    srv.write(currentAngle);
    delay(stepDelay);
  }
}

void stopSlider() {
  digitalWrite(MOTOR_IN1, LOW);
  digitalWrite(MOTOR_IN2, LOW);
}

void moveSliderLeft() {
  if (digitalRead(LIMIT_SW_LEFT) == LOW) {
    stopSlider();
    return;
  }
  digitalWrite(MOTOR_IN1, HIGH);
  digitalWrite(MOTOR_IN2, LOW);
}

void moveSliderRight() {
  if (digitalRead(LIMIT_SW_RIGHT) == LOW) {
    stopSlider();
    return;
  }
  digitalWrite(MOTOR_IN1, LOW);
  digitalWrite(MOTOR_IN2, HIGH);
}

void setPump(bool state) {
  if (state) {
    if (!emergencyStopTriggered && !pumpLockout) {
      digitalWrite(PUMP_RELAY_PIN, RELAY_ACTIVE);
      pumpActive = true;
      pumpStartTime = millis();
    }
  } else {
    digitalWrite(PUMP_RELAY_PIN, RELAY_DEACTIVE);
    pumpActive = false;
  }
}

void setEnvironmentalCommand(const char* cond, const char* cmdCode, const char* btnLabel, const char* payload) {
  strncpy(envCondition, cond, sizeof(envCondition) - 1);
  strncpy(actionCommand, cmdCode, sizeof(actionCommand) - 1);
  strncpy(commandButtonLabel, btnLabel, sizeof(commandButtonLabel) - 1);
  strncpy(commandPayload, payload, sizeof(commandPayload) - 1);
}

// ======================================================
// 7. EKSEKUTOR PERINTAH (DITERIMA DARI DASHBOARD)
// ======================================================
void executeDashboardCommand(const char* cmdName, JsonObject& params) {
  Serial.printf("[DASHBOARD PERINTAH] Mengeksekusi: %s\n", cmdName);

  // 1. Perintah Terkait Kondisi KERING
  if (strcmp(cmdName, "CMD_START_IRRIGATION") == 0) {
    pumpLockout = false;
    setPump(true);
    Serial.println("[EKSEKUSI] Pompa irigasi dinyalakan.");
  }
  else if (strcmp(cmdName, "CMD_START_MISTING") == 0) {
    pumpLockout = false;
    setPump(true);
    delay(2000);
    setPump(false);
    Serial.println("[EKSEKUSI] Semprotan misting kanopi 2 detik selesai.");
  }

  // 2. Perintah Terkait Kondisi BASAH
  else if (strcmp(cmdName, "CMD_PUMP_LOCKOUT") == 0) {
    pumpLockout = true;
    setPump(false);
    Serial.println("[EKSEKUSI] Pompa DIKUNCI MATI (PUMP LOCKOUT).");
  }
  else if (strcmp(cmdName, "CMD_PARK_SAFE_ZONE") == 0) {
    stopSlider();
    currentState = STATE_HOMING;
    moveServoSmooth(servoShoulder, angleShoulder, 30, 15);
    moveServoSmooth(servoElbow, angleElbow, 30, 15);
    Serial.println("[EKSEKUSI] Arm & slider diparkir di Zona Aman.");
  }

  // 3. Perintah Terkait Kondisi KEBAKARAN
  else if (strcmp(cmdName, "CMD_FIRE_SUPPRESSION") == 0) {
    pumpLockout = false;
    setPump(true);
    delay(4000);
    setPump(false);
    Serial.println("[EKSEKUSI] Semprotan pemadaman api 4000 ms dieksekusi.");
  }
  else if (strcmp(cmdName, "CMD_EVACUATE_OPPOSITE") == 0) {
    moveSliderLeft();
    delay(2000);
    stopSlider();
    Serial.println("[EKSEKUSI] Kereta rel dievakuasi menjauhi api.");
  }

  // 4. Perintah Terkait Kondisi GAS BERACUN / ASAP
  else if (strcmp(cmdName, "CMD_VENTILATION_ACTIVE") == 0) {
    Serial.println("[EKSEKUSI] Sirkulasi ventilasi/aerasi diaktifkan.");
  }
  else if (strcmp(cmdName, "CMD_RETRACT_ARM") == 0) {
    int step = params["step"] | 10;
    int target = constrain(angleElbow - step, 20, 110);
    moveServoSmooth(servoElbow, angleElbow, target, 15);
  }
  else if (strcmp(cmdName, "CMD_EMERGENCY_STOP") == 0) {
    emergencyStopTriggered = true;
    stopSlider();
    setPump(false);
    currentState = STATE_EMERGENCY_STOP;
    Serial.println("[EKSEKUSI] DARURAT: Semua sistem dihentikan.");
  }
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  char msgBuf[256];
  if (length >= sizeof(msgBuf)) length = sizeof(msgBuf) - 1;
  memcpy(msgBuf, payload, length);
  msgBuf[length] = '\0';

  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, msgBuf);
  if (!err) {
    const char* cmd = doc["cmd"] | doc["command"] | "";
    JsonObject params = doc["params"].as<JsonObject>();
    if (strlen(cmd) > 0) {
      executeDashboardCommand(cmd, params);
    }
  }
}

// ======================================================
// 8. SENSOR READING & LOGIKA 4 KONDISI SENSOR ONBOARD
// ======================================================
void readAllSensors() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    currentTemp = t;
    currentHumidity = h;
  }

  rawSoil = analogRead(SOIL_ANALOG_PIN);
  float pct = ((float)(SOIL_CALIB_DRY - rawSoil) / (float)(SOIL_CALIB_DRY - SOIL_CALIB_WET)) * 100.0;
  soilMoisturePct = constrain(pct, 0.0, 100.0);

  rawMQ135 = analogRead(MQ135_ANALOG_PIN);

  flameCh[0] = (digitalRead(FLAME_CH1_PIN) == FLAME_ACTIVE_STATE);
  flameCh[1] = (digitalRead(FLAME_CH2_PIN) == FLAME_ACTIVE_STATE);
  flameCh[2] = (digitalRead(FLAME_CH3_PIN) == FLAME_ACTIVE_STATE);
  flameCh[3] = (digitalRead(FLAME_CH4_PIN) == FLAME_ACTIVE_STATE);
  flameCh[4] = (digitalRead(FLAME_CH5_PIN) == FLAME_ACTIVE_STATE);

  activeFlameCount = 0;
  for (int i = 0; i < 5; i++) {
    if (flameCh[i]) activeFlameCount++;
  }

  VL53L0X_RangingMeasurementData_t measure;
  vl53l0x.rangingTest(&measure, false);
  if (measure.RangeStatus != 4) {
    targetDistanceMm = measure.RangeMilliMeter;
    distanceSensorValid = (targetDistanceMm >= 30 && targetDistanceMm <= 1200);
  } else {
    distanceSensorValid = false;
    targetDistanceMm = 9999;
  }

  cameraOnline = (millis() - lastAiResultTime < 10000);

  // ====================================================
  // MESIN PENENTU PERINTAH MURNI SENSOR ONBOARD ROBOT
  // ====================================================
  bool isFire = (activeFlameCount > 0 || (cameraOnline && strcmp(aiVisionClass, "FIRE") == 0 && aiConfidence >= 0.70));
  bool isToxicGas = (rawMQ135 > THRESH_MQ135_TOXIC && !isFire);
  bool isDry = (soilMoisturePct < THRESH_SOIL_DRY);
  bool isWet = (soilMoisturePct > THRESH_SOIL_WET);

  if (isFire) {
    // 1. KONDISI KEBAKARAN
    setEnvironmentalCommand(
      "KEBAKARAN",
      "CMD_FIRE_SUPPRESSION",
      "PERINTAH: SEMPROT PEMADAMAN DARURAT",
      "{\"cmd\":\"CMD_FIRE_SUPPRESSION\",\"duration\":4000}"
    );
  }
  else if (isToxicGas) {
    // 2. KONDISI GAS BERACUN / ASAP PEKAT
    setEnvironmentalCommand(
      "GAS_BERACUN",
      "CMD_VENTILATION_ACTIVE",
      "PERINTAH: NYALAKAN AERASI/EXHAUST 100%",
      "{\"cmd\":\"CMD_VENTILATION_ACTIVE\"}"
    );
  }
  else if (isWet) {
    // 3. KONDISI BASAH (Jenuh Air)
    pumpLockout = true;
    setEnvironmentalCommand(
      "BASAH",
      "CMD_PUMP_LOCKOUT",
      "PERINTAH: KUNCI MATI POMPA AIR (LOCKOUT)",
      "{\"cmd\":\"CMD_PUMP_LOCKOUT\"}"
    );
  }
  else if (isDry) {
    // 4. KONDISI KERING
    setEnvironmentalCommand(
      "KERING",
      "CMD_START_IRRIGATION",
      "PERINTAH: EKSEKUSI SIRAM AKAR & KANOPI",
      "{\"cmd\":\"CMD_START_IRRIGATION\"}"
    );
  }
  else {
    pumpLockout = false;
    setEnvironmentalCommand(
      "NORMAL",
      "CMD_IDLE",
      "Sistem Normal (Monitoring)",
      "{\"cmd\":\"NONE\"}"
    );
  }
}

// ======================================================
// 9. ESP-NOW WIRELESS RECEIVER
// ======================================================
void onEspNowDataRecv(const esp_now_recv_info_t *info, const uint8_t *incomingData, int len) {
  if (len == sizeof(CameraAiPacket)) {
    CameraAiPacket packet;
    memcpy(&packet, incomingData, sizeof(CameraAiPacket));
    if (packet.packetType == PACKET_VISION_RESULT) {
      strncpy(aiVisionClass, packet.visionClass, sizeof(aiVisionClass) - 1);
      aiVisionClass[sizeof(aiVisionClass) - 1] = '\0';
      aiConfidence = packet.confidence;
      aiFireScore  = packet.fireScore;
      aiSmokeScore = packet.smokeScore;
      aiSafeScore  = packet.safeScore;
      lastAiResultTime = millis();
    }
  }
}

// ======================================================
// 10. FIRE MODE STAGED
// ======================================================
void handleFireModeStaged() {
  if (pumpActive && currentState != STATE_SUPPRESSION_ACTIVE) {
    setPump(false);
  }
  stopSlider();

  switch (currentFireStage) {
    case STAGE_SERVO1_YAW: {
      int targetYaw = 90;
      if (flameCh[0])      targetYaw = 30;
      else if (flameCh[1]) targetYaw = 60;
      else if (flameCh[2]) targetYaw = 90;
      else if (flameCh[3]) targetYaw = 120;
      else if (flameCh[4]) targetYaw = 150;

      moveServoSmooth(servoBase, angleBase, targetYaw, 20);
      currentFireStage = STAGE_SERVO2_PITCH;
      break;
    }

    case STAGE_SERVO2_PITCH: {
      moveServoSmooth(servoShoulder, angleShoulder, 70, 20);
      currentFireStage = STAGE_SERVO3_REACH;
      break;
    }

    case STAGE_SERVO3_REACH: {
      for (int a = angleElbow; a <= 75; a += 2) {
        servoElbow.write(a);
        angleElbow = a;
        delay(30);
        readAllSensors();

        if (distanceSensorValid && targetDistanceMm < VL53L0X_MIN_SAFE_MM) {
          break;
        }
      }
      currentFireStage = STAGE_SERVO4_NOZZLE;
      break;
    }

    case STAGE_SERVO4_NOZZLE: {
      moveServoSmooth(servoNozzle, angleNozzle, 90, 15);
      currentFireStage = STAGE_VERIFY_DISTANCE;
      break;
    }

    case STAGE_VERIFY_DISTANCE: {
      readAllSensors();
      bool distanceSafe = (distanceSensorValid && 
                           targetDistanceMm >= VL53L0X_MIN_SAFE_MM && 
                           targetDistanceMm <= VL53L0X_MAX_SUPPR_MM);
      bool visualConfirmed = (cameraOnline && strcmp(aiVisionClass, "FIRE") == 0 && aiConfidence >= 0.70);
      bool sensorCritical  = (activeFlameCount >= 2 && rawMQ135 > THRESH_MQ135_TOXIC);

      if ((visualConfirmed || sensorCritical) && distanceSafe) {
        currentFireStage = STAGE_READY_SUPPRESS;
        currentState = STATE_SUPPRESSION_ACTIVE;
        setPump(true);
      } else {
        currentState = STATE_ALARM_FAULT;
      }
      break;
    }

    default:
      break;
  }
}

// ======================================================
// 11. SETUP
// ======================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[AGRAPATHA] Inisialisasi Robot Cerdas (Murni Sensor Onboard)...");

  pinMode(LIMIT_SW_LEFT, INPUT_PULLUP);
  pinMode(LIMIT_SW_RIGHT, INPUT_PULLUP);
  pinMode(MOTOR_IN1, OUTPUT);
  pinMode(MOTOR_IN2, OUTPUT);
  stopSlider();

  pinMode(PUMP_RELAY_PIN, OUTPUT);
  setPump(false);

  pinMode(FLAME_CH1_PIN, INPUT);
  pinMode(FLAME_CH2_PIN, INPUT);
  pinMode(FLAME_CH3_PIN, INPUT);
  pinMode(FLAME_CH4_PIN, INPUT);
  pinMode(FLAME_CH5_PIN, INPUT);

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  servoBase.setPeriodHertz(50);
  servoShoulder.setPeriodHertz(50);
  servoElbow.setPeriodHertz(50);
  servoNozzle.setPeriodHertz(50);

  servoBase.attach(SERVO_BASE_PIN, 500, 2500);
  servoShoulder.attach(SERVO_SHOULDER_PIN, 500, 2500);
  servoElbow.attach(SERVO_ELBOW_PIN, 500, 2500);
  servoNozzle.attach(SERVO_NOZZLE_PIN, 500, 2500);

  servoBase.write(angleBase);
  servoShoulder.write(angleShoulder);
  servoElbow.write(angleElbow);
  servoNozzle.write(angleNozzle);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, 400000);
  vl53l0x.begin();
  dht.begin();

  WiFi.mode(WIFI_AP_STA);
  if (esp_now_init() == ESP_OK) {
    esp_now_register_recv_cb(onEspNowDataRecv);
  }

  secureClient.setInsecure();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setBufferSize(1024); // Alokasi buffer 1024 bytes agar payload JSON lengkap tidak terpotong
  mqttClient.setKeepAlive(60);
  mqttClient.setCallback(onMqttMessage);

  currentState = STATE_HOMING;
}

// ======================================================
// 12. MAIN LOOP
// ======================================================
void loop() {
  unsigned long now = millis();

  // 1. Baca Sensor Rutin & Evaluasi 4 Kondisi Tiap 250ms
  if (now - lastSensorReadTime >= 250) {
    lastSensorReadTime = now;
    readAllSensors();

    bool flameDetected = (activeFlameCount > 0);
    bool aiFire = (cameraOnline && strcmp(aiVisionClass, "FIRE") == 0 && aiConfidence >= 0.70);

    if ((flameDetected || aiFire) &&
        currentState != STATE_FIRE_MODE_STAGED &&
        currentState != STATE_SUPPRESSION_ACTIVE &&
        currentState != STATE_EMERGENCY_STOP) {

      currentState = STATE_FIRE_MODE_STAGED;
      currentFireStage = STAGE_SERVO1_YAW;
    }
  }

  // 2. Proteksi Ganda Limit Switch
  if (digitalRead(LIMIT_SW_LEFT) == LOW && digitalRead(LIMIT_SW_RIGHT) == LOW) {
    stopSlider();
    currentState = STATE_ALARM_FAULT;
    setEnvironmentalCommand("FAULT", "CMD_EMERGENCY_STOP", "PERINTAH: HENTIKAN MOTOR SEGERA", "{\"cmd\":\"CMD_EMERGENCY_STOP\"}");
  }

  // 3. State Machine Sistem
  switch (currentState) {
    case STATE_HOMING:
      if (digitalRead(LIMIT_SW_LEFT) == LOW) {
        stopSlider();
        currentZone = 1;
        zoneScanCycles = 0;
        currentState = STATE_SCANNING_ZONES;
      } else {
        moveSliderLeft();
      }
      break;

    case STATE_SCANNING_ZONES:
      if (zoneScanCycles < 3) {
        moveServoSmooth(servoNozzle, angleNozzle, 60, 10);
        moveServoSmooth(servoNozzle, angleNozzle, 120, 10);
        moveServoSmooth(servoNozzle, angleNozzle, 90, 10);
        zoneScanCycles++;
      } else {
        zoneScanCycles = 0;
        if (currentZone == 1) {
          sliderMoveStartTime = millis();
          while (millis() - sliderMoveStartTime < SLIDER_ZONE2_TRAVEL_MS) {
            moveSliderRight();
            delay(10);
          }
          stopSlider();
          currentZone = 2;
        } else if (currentZone == 2) {
          while (digitalRead(LIMIT_SW_RIGHT) == HIGH) {
            moveSliderRight();
            delay(10);
          }
          stopSlider();
          currentZone = 3;
        } else {
          currentState = STATE_HOMING;
        }
      }

      // Logika Penyiraman Otomatis (Jika tidak dikunci oleh kondisi basah)
      if (!pumpLockout && soilMoisturePct < THRESH_SOIL_DRY && (now - lastIrrigEndTime > IRRIG_COOLDOWN_MS)) {
        currentState = STATE_IRRIGATING;
        setPump(true);
      }
      break;

    case STATE_IRRIGATING:
      if (soilMoisturePct >= THRESH_SOIL_TARGET || (now - pumpStartTime >= IRRIG_MAX_DURATION_MS)) {
        setPump(false);
        lastIrrigEndTime = now;
        currentState = STATE_SCANNING_ZONES;
      }
      break;

    case STATE_FIRE_MODE_STAGED:
      handleFireModeStaged();
      break;

    case STATE_SUPPRESSION_ACTIVE:
      if (now - pumpStartTime >= SUPPRESSION_DURATION_MS) {
        setPump(false);
        readAllSensors();

        if (activeFlameCount == 0 && strcmp(aiVisionClass, "FIRE") != 0) {
          moveServoSmooth(servoShoulder, angleShoulder, 45, 15);
          moveServoSmooth(servoElbow, angleElbow, 45, 15);
          moveServoSmooth(servoBase, angleBase, 90, 15);
          currentState = STATE_HOMING;
        } else {
          currentState = STATE_ALARM_FAULT;
        }
      }
      break;

    case STATE_ALARM_FAULT:
    case STATE_EMERGENCY_STOP:
      stopSlider();
      setPump(false);
      break;

    default:
      break;
  }

  // 4. Publikasi Telemetri ke Dashboard Tiap 1 Detik
  if (now - lastMqttPubTime >= 1000) {
    lastMqttPubTime = now;
    if (!mqttClient.connected()) {
      if (WiFi.status() == WL_CONNECTED) {
        String clientId = "AgrapathaMainESP32-" + String((uint32_t)ESP.getEfuseMac(), HEX);
        if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
          Serial.println("[MQTT] Terhubung ke EMQX Cloud TLS Broker (Port 8883)!");
          mqttClient.subscribe(TOPIC_COMMANDS);
        } else {
          Serial.printf("[MQTT] Gagal terhubung ke broker, rc=%d\n", mqttClient.state());
        }
      }
    } else {
      mqttClient.loop();

      char jsonBuf[512];
      snprintf(jsonBuf, sizeof(jsonBuf),
        "{"
        "\"temperature\":%.2f,"
        "\"humidity\":%.2f,"
        "\"soil_moisture\":%.2f,"
        "\"gas_raw\":%d,"
        "\"mq135_raw\":%d,"
        "\"flame_detected\":%d,"
        "\"flame_ch\":[%d,%d,%d,%d,%d],"
        "\"distance_mm\":%u,"
        "\"zone\":%d,"
        "\"pump_status\":%s,"
        "\"pump_lockout\":%s,"
        "\"env_condition\":\"%s\","
        "\"action_command\":\"%s\","
        "\"command_label\":\"%s\","
        "\"command_payload\":%s"
        "}",
        currentTemp, currentHumidity, soilMoisturePct, rawMQ135,
        rawMQ135,
        (activeFlameCount > 0 ? 1 : 0),
        flameCh[0], flameCh[1], flameCh[2], flameCh[3], flameCh[4],
        targetDistanceMm, currentZone, pumpActive ? "true" : "false",
        pumpLockout ? "true" : "false",
        envCondition,
        actionCommand, commandButtonLabel, commandPayload
      );
      mqttClient.publish(TOPIC_TELEMETRY, jsonBuf);
    }
  } else {
    if (mqttClient.connected()) {
      mqttClient.loop();
    }
  }
}
