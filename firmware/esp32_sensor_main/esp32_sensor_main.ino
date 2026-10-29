/**
 * ==============================================================================
 * AGRAPATHA & GRENVIS — ESP32 MAIN CONTROLLER & SENSOR NODE
 * Board: ESP32 DevKit V1 (30 / 36 Pin)
 * ==============================================================================
 * SENSOR PIN MAPPING:
 * - DHT22 (Air Temp & Humidity)      : GPIO 19
 * - Capacitive Soil Moisture v1.2    : GPIO 34 (ADC1_CH6)
 * - MQ-135 Gas / Air Quality         : GPIO 35 (ADC1_CH7 - Unverified Candidate, voltage divider <= 3.3V)
 * - Flame Sensor (IR Detection)      : GPIO 36 (Sensor VP / ADC1_CH0 - Unverified Candidate)
 * - L298N Motor OUT3 (Driver IN3)    : GPIO 16
 * - L298N Motor OUT4 (Driver IN4)    : GPIO 17
 * - Limit Switch Left                : GPIO 32 (INPUT_PULLUP)
 * - Limit Switch Right               : GPIO 33 (INPUT_PULLUP)
 *
 * WIRELESS & PROTOCOLS:
 * - ESP-NOW: Communicates with ESP32-CAM (Target MAC: F8:B3:B7:A6:F3:9C)
 * - MQTT TLS: Connects to EMQX Cloud on Port 8883 (MQTTS over TLS/SSL)
 * ==============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <DHT.h>

// ======================================================
// 1. LOCAL CREDENTIAL INCLUSION & VALIDATION
// ======================================================
#if __has_include("credentials.h")
  #include "credentials.h"
#else
  #error "credentials.h is missing! Copy credentials.example.h to credentials.h in firmware/esp32_sensor_main/ and configure your credentials."
#endif

#ifdef CREDENTIALS_PLACEHOLDER
  #error "Placeholder credentials detected! Please configure credentials.h with valid credentials and remove CREDENTIALS_PLACEHOLDER."
#endif

#if !defined(SECRET_WIFI_SSID) || !defined(SECRET_WIFI_PASSWORD)
  #error "Required Wi-Fi credentials (SECRET_WIFI_SSID, SECRET_WIFI_PASSWORD) are not defined in credentials.h!"
#endif

#if !defined(SECRET_MQTT_USERNAME) || !defined(SECRET_MQTT_PASSWORD)
  #error "Required MQTT credentials (SECRET_MQTT_USERNAME, SECRET_MQTT_PASSWORD) are not defined in credentials.h!"
#endif

#if !defined(SECRET_MQTT_CA_CERT)
  #error "Required MQTT Root CA certificate (SECRET_MQTT_CA_CERT) is not defined in credentials.h!"
#endif

// Map secrets to existing sketch identifiers (preserving type & semantics)
const char* WIFI_SSID     = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;
const char* MQTT_USERNAME = SECRET_MQTT_USERNAME;
const char* MQTT_PASSWORD = SECRET_MQTT_PASSWORD;
const char* MQTT_CA_CERT   = SECRET_MQTT_CA_CERT;

// ======================================================
// 2. EMQX CLOUD BROKER SETTINGS (PORT 8883 TLS)
// ======================================================
// Primary Asia-Southeast1 (Singapore - Recommended low latency)
const char* MQTT_HOST     = "wfc1ec11.ala.asia-southeast1.emqxsl.com";
// Backup / Alternative EU broker: "m2da914a.ala.eu-central-1.emqxsl.com"

const uint16_t MQTT_PORT  = 8883;

// ======================================================
// 3. MQTT TOPICS
// ======================================================
const char* MQTT_TOPIC_DATA      = "grenvis/sensor/data";
const char* MQTT_TOPIC_AGRAPATHA = "agrapatha/telemetry";
const char* MQTT_TOPIC_STATUS    = "grenvis/sensor/status";
const char* MQTT_TOPIC_VISION    = "grenvis/vision/data";
const char* MQTT_TOPIC_IMAGE     = "grenvis/vision/image";
const char* MQTT_TOPIC_CONTROL   = "grenvis/device/control";
const char* MQTT_TOPIC_CMD_AGRA  = "agrapatha/commands";

// ======================================================
// 4. HARDWARE PIN DEFINITIONS (REALTIME SENSORS & ACTUATOR)
// ======================================================
// 4 Confirmed Real-Time Sensors: DHT22, Soil v1.2, MQ-135, Flame Sensor
#define DHT_PIN      19 // DHT22 / DHT11 (Air Temp & RH)
#define DHT_TYPE     DHT22

#define SOIL_PIN     34 // Capacitive Soil Moisture Sensor v1.2 (ADC1_CH6)

// NOTE: MQ-135 and Flame Sensor pins require verification against physical rig wiring.
// - MQ-135 AO must connect to ADC1 (GPIO 32-39) through a voltage divider (max 3.3V).
// - Flame Sensor DO (digital) and AO (analog) are separate pins on the module and must not be assumed to share a single pin.
#ifndef MQ135_PIN
  #define MQ135_PIN            35 // ADC1_CH7 (Candidate pin)
#endif

#ifndef FLAME_SENSOR_USE_ANALOG
  #define FLAME_SENSOR_USE_ANALOG 0 // 0 = Digital DO (default), 1 = Analog AO
#endif

#ifndef FLAME_DO_PIN
  #define FLAME_DO_PIN         36 // Sensor VP / GPIO 36 (Candidate DO digital pin)
#endif

#ifndef FLAME_AO_PIN
  #define FLAME_AO_PIN         39 // Sensor VN / ADC1_CH3 (Candidate AO analog pin)
#endif

#ifndef FLAME_PIN
  #define FLAME_PIN            FLAME_DO_PIN
#endif

// Flame Sensor Polarity: 1 for active-LOW (typical LM393 DO: LOW when flame detected)
#ifndef FLAME_ACTIVE_LOW
  #define FLAME_ACTIVE_LOW 1
#endif

// L298N Dual H-Bridge Motor Driver (Menggunakan OUT3 & OUT4 -> Dikendalikan oleh IN3 & IN4)
#define MOTOR_IN3    16 // ESP32 GPIO 16 -> L298N IN3 (Mengendalikan OUT3)
#define MOTOR_IN4    17 // ESP32 GPIO 17 -> L298N IN4 (Mengendalikan OUT4)
#define MOTOR_IN1    MOTOR_IN3 // Alias kompatibilitas
#define MOTOR_IN2    MOTOR_IN4 // Alias kompatibilitas

#define LIMIT_LEFT   32 // Limit Switch Left
#define LIMIT_RIGHT  33 // Limit Switch Right

DHT dht(DHT_PIN, DHT_TYPE);

// ======================================================
// 5. ESP-NOW PEER & TARGET ESP32-CAM MAC
// ======================================================
const uint8_t ESP32_CAM_MAC[] = { 0xF8, 0xB3, 0xB7, 0xA6, 0xF3, 0x9C };
uint8_t targetCamMac[6]       = { 0xF8, 0xB3, 0xB7, 0xA6, 0xF3, 0x9C };
bool hasLearnedCamMac         = false;

// Packet Types
#define PACKET_RESULT          1
#define PACKET_IMAGE_START     2
#define PACKET_IMAGE_CHUNK     3
#define PACKET_IMAGE_END       4
#define PACKET_CAPTURE_REQUEST 5

#define IMAGE_CHUNK_SIZE       200

typedef struct __attribute__((packed)) {
  uint8_t packetType;
  uint32_t scanNumber;
  char visionClass[16];
  float confidence;
  float healthy;
  float powdery;
  float rust;
  uint32_t imageSize;
} VisionResultPacket;

typedef struct __attribute__((packed)) {
  uint8_t packetType;
  uint32_t scanNumber;
  uint32_t imageSize;
  uint16_t totalChunks;
} ImageStartPacket;

typedef struct __attribute__((packed)) {
  uint8_t packetType;
  uint32_t scanNumber;
  uint16_t chunkIndex;
  uint16_t dataLength;
  uint8_t data[IMAGE_CHUNK_SIZE];
} ImageChunkPacket;

typedef struct __attribute__((packed)) {
  uint8_t packetType;
  uint32_t scanNumber;
  uint16_t totalChunks;
} ImageEndPacket;

// ======================================================
// 6. SENSOR CALIBRATION PARAMETERS
// ======================================================
// Capacitive Soil Moisture Sensor v1.2
#define SOIL_DRY  3100
#define SOIL_WET  1350

// MQ-135 Gas / Air Quality Sensor
// Note: Publishes raw ADC (0-4095). Truthful telemetry: uncalibrated raw values are NOT labeled as ppm.

// Live Sensor Variables
float currentTemperature = 26.5;
float currentHumidity    = 65.0;

int soilRaw              = 0;
float soilMoisture       = 0.0;

// Confirmed Sensors: MQ-135 and Flame Sensor
int mq135Raw             = 0;
int flameRaw             = 0;
int flameDetected        = 0; // 0 = Clear/Aman, 1 = Api/Flame detected

// Motor State
enum MotorState {
  MOTOR_STOPPED,
  MOTOR_LEFT,
  MOTOR_RIGHT
};
MotorState motorState = MOTOR_STOPPED;

// Vision Stream Data
bool visionAvailable           = false;
unsigned long lastVisionReceived = 0;
char esp32CamMac[18]           = "NOT_CONNECTED";
uint32_t visionScanNumber      = 0;
char visionPrediction[16]      = "Unknown";
float visionConfidence         = 0.0;
float visionHealthy            = 0.0;
float visionPowdery            = 0.0;
float visionRust               = 0.0;

volatile bool newVisionReady   = false;
volatile bool newImageReady    = false;

// Image Assembly Buffer & Reassembly Tracking
#define MAX_IMAGE_SIZE 60000
#define MAX_IMAGE_CHUNKS ((MAX_IMAGE_SIZE + IMAGE_CHUNK_SIZE - 1) / IMAGE_CHUNK_SIZE) // 300 chunks max
#define CHUNK_BITMASK_BYTES ((MAX_IMAGE_CHUNKS + 7) / 8)                              // 38 bytes

uint8_t* imageBuffer                    = nullptr;
uint32_t currentImageSize               = 0;
uint32_t imageScanNumber                = 0;
uint16_t expectedChunks                 = 0;
uint16_t receivedChunks                 = 0;
volatile bool receivingImage            = false;
volatile bool imageReady                = false;
uint32_t lastPublishedImageScan         = 0;

static portMUX_TYPE imageMux                      = portMUX_INITIALIZER_UNLOCKED;
static uint8_t chunkBitmask[CHUNK_BITMASK_BYTES];
static volatile unsigned long lastChunkReceivedAt = 0;
const unsigned long IMAGE_TIMEOUT_MS              = 2500;

static inline bool isChunkReceived(uint16_t idx) {
  if (idx >= MAX_IMAGE_CHUNKS) return false;
  return (chunkBitmask[idx / 8] & (1 << (idx % 8))) != 0;
}

static inline void markChunkReceived(uint16_t idx) {
  if (idx < MAX_IMAGE_CHUNKS) {
    chunkBitmask[idx / 8] |= (1 << (idx % 8));
  }
}

static inline void resetChunkTracking() {
  memset(chunkBitmask, 0, sizeof(chunkBitmask));
  receivedChunks = 0;
}

void freeImageBuffer() {
  uint8_t* bufToFree = nullptr;

  portENTER_CRITICAL(&imageMux);
  if (imageBuffer != nullptr) {
    bufToFree   = imageBuffer;
    imageBuffer = nullptr;
  }
  currentImageSize = 0;
  expectedChunks   = 0;
  receivingImage   = false;
  imageReady       = false;
  newImageReady    = false;
  resetChunkTracking();
  portEXIT_CRITICAL(&imageMux);

  if (bufToFree != nullptr) {
    free(bufToFree);
  }
}

// Publish timer (3 seconds default for optimal DHT22 & ADC sampling)
unsigned long lastPublish      = 0;
const unsigned long PUBLISH_INTERVAL = 3000;

// Network Clients
WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

// ======================================================
// SENSOR READING FUNCTIONS (100% REALTIME - NO DUMMY DATA)
// ======================================================

// 1. Read Soil Moisture (Capacitive v1.2 Multi-Sample 16x)
void readSoil() {
  long sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(SOIL_PIN);
    delay(2);
  }
  soilRaw = sum / 16;
  // Kalibrasi kapasitif: SOIL_DRY (udara bebas) ~3100, SOIL_WET (air) ~1350
  float moisture = (float)(SOIL_DRY - soilRaw) / (float)(SOIL_DRY - SOIL_WET) * 100.0;
  soilMoisture = constrain(moisture, 0.0, 100.0);
}

// 2. Read MQ-135 Gas Sensor (Analog Raw ADC Multi-Sample 16x)
// Publishes truthful raw ADC without fabricated ppm values.
void readMq135() {
  long sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(MQ135_PIN);
    delay(2);
  }
  mq135Raw = sum / 16;
}

// 3. Read Flame Sensor
// Handles Digital DO or Analog AO based on configured physical wiring mode
void readFlame() {
#if FLAME_SENSOR_USE_ANALOG
  // Analog mode: AO is wired to FLAME_AO_PIN (Sensor VN / GPIO 39)
  long sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(FLAME_AO_PIN);
    delay(2);
  }
  flameRaw = sum / 16;
  // Analog threshold: higher IR intensity pulls voltage down on LM393 AO
  flameDetected = (flameRaw < 1500) ? 1 : 0;
#else
  // Digital mode (Default): DO is wired to FLAME_DO_PIN (GPIO 36)
  int digitalVal = digitalRead(FLAME_DO_PIN);
#if FLAME_ACTIVE_LOW
  flameDetected = (digitalVal == LOW) ? 1 : 0;
#else
  flameDetected = (digitalVal == HIGH) ? 1 : 0;
#endif
  flameRaw = -1; // Unconnected / Not sampled in DO mode
#endif
}

// 4. Read DHT22 (Air Temperature & Relative Humidity)
void readDht() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h) && t >= -20.0 && t <= 80.0 && h >= 0.0 && h <= 100.0) {
    currentTemperature = t;
    currentHumidity = h;
  } else {
    Serial.println("[DHT22] Warning: Pembacaan sensor DHT jitter/unstable, mempertahankan nilai pembacaan terakhir.");
  }
}

// ======================================================
// MOTOR ACTUATOR CONTROLS (L298N OUT3 & OUT4)
// ======================================================
void motorStop() {
  digitalWrite(MOTOR_IN3, LOW);
  digitalWrite(MOTOR_IN4, LOW);
  motorState = MOTOR_STOPPED;
  Serial.println("[MOTOR L298N OUT3/OUT4] STOP (IN3=LOW, IN4=LOW)");
}

void motorRight() {
  if (digitalRead(LIMIT_RIGHT) == LOW) {
    Serial.println("[LIMIT RIGHT] Aktif! Motor OUT3/OUT4 dihentikan demi keselamatan.");
    motorStop();
    return;
  }
  digitalWrite(MOTOR_IN3, HIGH);
  digitalWrite(MOTOR_IN4, LOW);
  motorState = MOTOR_RIGHT;
  Serial.println("[MOTOR L298N OUT3/OUT4] >>> RUN RIGHT (IN3=HIGH, IN4=LOW)");
}

void motorLeft() {
  if (digitalRead(LIMIT_LEFT) == LOW) {
    Serial.println("[LIMIT LEFT] Aktif! Motor OUT3/OUT4 dihentikan demi keselamatan.");
    motorStop();
    return;
  }
  digitalWrite(MOTOR_IN3, LOW);
  digitalWrite(MOTOR_IN4, HIGH);
  motorState = MOTOR_LEFT;
  Serial.println("[MOTOR L298N OUT3/OUT4] <<< RUN LEFT (IN3=LOW, IN4=HIGH)");
}

// ======================================================
// ESP-NOW: TRIGGER ESP32-CAM CAPTURE
// ======================================================
void triggerCameraCapture() {
  const uint8_t request[] = { PACKET_CAPTURE_REQUEST };
  const uint8_t* target   = hasLearnedCamMac ? targetCamMac : ESP32_CAM_MAC;

  if (!esp_now_is_peer_exist(target)) {
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, target, 6);
    peer.channel = WiFi.channel();
    peer.encrypt = false;
    peer.ifidx   = WIFI_IF_STA;
    esp_now_add_peer(&peer);
  }

  const esp_err_t result = esp_now_send(target, request, sizeof(request));
  Serial.println();
  Serial.printf("[ESP-NOW] Kirim trigger foto ke ESP32-CAM: %s\n",
                result == ESP_OK ? "BERHASIL" : "GAGAL");
}

// ======================================================
// LIMIT SWITCH SAFETY & PHOTO AUTOMATION
// ======================================================
void checkLimitSwitch() {
  bool leftPressed  = digitalRead(LIMIT_LEFT) == LOW;
  bool rightPressed = digitalRead(LIMIT_RIGHT) == LOW;

  static bool prevLeftPressed = false;
  static bool prevRightPressed = false;
  static unsigned long lastLimitCaptureTime = 0;

  // Deteksi trigger baru pada limit switch
  if ((leftPressed && !prevLeftPressed) || (rightPressed && !prevRightPressed)) {
    if (millis() - lastLimitCaptureTime > 3000) {
      lastLimitCaptureTime = millis();
      Serial.println("\n>>> [LIMIT HIT] Mengirim sinyal capture ke ESP32-CAM! <<<");
      triggerCameraCapture();
    }
  }

  prevLeftPressed = leftPressed;
  prevRightPressed = rightPressed;

  // Interlock saat melaju ke kiri
  if (motorState == MOTOR_LEFT && leftPressed) {
    Serial.println("[LIMIT] KIRI TERTEKAN -> Berhenti sejenak, lalu balik kanan");
    motorStop();
    delay(800); // Jeda agar foto tidak goyang / blur
    motorRight();
  }

  // Interlock saat melaju ke kanan
  if (motorState == MOTOR_RIGHT && rightPressed) {
    Serial.println("[LIMIT] KANAN TERTEKAN -> Berhenti sejenak, lalu balik kiri");
    motorStop();
    delay(800); // Jeda agar foto tidak goyang / blur
    motorLeft();
  }
}

// ======================================================
// MQTT CALLBACK & REMOTE COMMAND DISPATCH
// ======================================================
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  if (length == 0) return;
  const char command = (char)payload[0];
  Serial.printf("[MQTT] Perintah Masuk [%s]: %c\n", topic, command);

  if (command == 'L' || command == 'l') {
    motorLeft();
  } else if (command == 'R' || command == 'r') {
    motorRight();
  } else if (command == 'S' || command == 's') {
    motorStop();
  } else if (command == 'C' || command == 'c') {
    triggerCameraCapture();
  }
}

// ======================================================
// WI-FI & MQTT CONNECTION MANAGERS
// ======================================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println("\n[WiFi] Menghubungkan ke AP...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 30) {
    delay(400);
    Serial.print(".");
    attempt++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] CONNECTED! IP: %s | MAC: %s | Channel: %d\n",
                  WiFi.localIP().toString().c_str(),
                  WiFi.macAddress().c_str(),
                  WiFi.channel());
  } else {
    Serial.println("[WiFi] Gagal terhubung ke AP.");
  }
}

void connectMQTT() {
  if (mqttClient.connected() || WiFi.status() != WL_CONNECTED) return;

  Serial.printf("\n[MQTT] Menghubungkan ke EMQX Cloud (%s:%u)...\n", MQTT_HOST, MQTT_PORT);
  String clientId = "grenvis-esp32-" + WiFi.macAddress();
  clientId.replace(":", "");

  bool connected = mqttClient.connect(
    clientId.c_str(),
    MQTT_USERNAME,
    MQTT_PASSWORD,
    MQTT_TOPIC_STATUS,
    0,
    true,
    "offline"
  );

  if (connected) {
    Serial.println("[MQTT] BERHASIL TERHUBUNG KE EMQX CLOUD!");
    mqttClient.publish(MQTT_TOPIC_STATUS, "online", true);

    // Subscribe ke topik kontrol
    mqttClient.subscribe(MQTT_TOPIC_CONTROL, 1);
    mqttClient.subscribe(MQTT_TOPIC_CMD_AGRA, 1);
    Serial.printf("[MQTT] Subscribed to %s & %s\n", MQTT_TOPIC_CONTROL, MQTT_TOPIC_CMD_AGRA);
  } else {
    Serial.printf("[MQTT] Gagal koneksi EMQX. Status State = %d\n", mqttClient.state());
  }
}

// ======================================================
// TELEMETRY PUBLISHERS
// ======================================================
void publishMQTT() {
  if (!mqttClient.connected()) return;

  // Build Unified JSON Payload (Compatible with both GRENVIS & AGRAPATHA Dashboard)
  String payload = "{";
  // Suhu & Kelembapan
  payload += "\"temp\":" + String(currentTemperature, 2) + ",";
  payload += "\"temperature\":" + String(currentTemperature, 2) + ",";
  payload += "\"rh\":" + String(currentHumidity, 2) + ",";
  payload += "\"humidity\":" + String(currentHumidity, 2) + ",";

  // Tanah (Capacitive v1.2)
  payload += "\"soil_raw\":" + String(soilRaw) + ",";
  payload += "\"soilMoisture\":" + String(soilMoisture, 2) + ",";
  payload += "\"soil_moisture\":" + String(soilMoisture, 2) + ",";

  // Sensor Gas MQ-135 (Truthful Telemetry: Raw ADC published without fake ppm)
  payload += "\"mq135_raw\":" + String(mq135Raw) + ",";
  payload += "\"mq135\":" + String(mq135Raw) + ",";

  // Sensor Api (Flame Sensor: Digital DO detection & optional AO raw ADC)
  payload += "\"flame_detected\":" + String(flameDetected) + ",";
  payload += "\"flame\":" + String(flameDetected) + ",";
  if (flameRaw >= 0) {
    payload += "\"flame_raw\":" + String(flameRaw) + ",";
  }

  // Diagnostik Node & Rel
  payload += "\"nodeId\":\"ESP32-MAIN-" + WiFi.macAddress() + "\",";
  payload += "\"esp32_mac\":\"" + WiFi.macAddress() + "\",";
  payload += "\"uptime_seconds\":" + String(millis() / 1000UL) + ",";
  payload += "\"wifi_channel\":" + String(WiFi.channel()) + ",";
  payload += "\"limit_left\":" + String(digitalRead(LIMIT_LEFT) == LOW ? "true" : "false") + ",";
  payload += "\"limit_right\":" + String(digitalRead(LIMIT_RIGHT) == LOW ? "true" : "false") + ",";
  payload += "\"motor_state\":\"" + String(motorState == MOTOR_LEFT ? "LEFT" : motorState == MOTOR_RIGHT ? "RIGHT" : "STOPPED") + "\",";
  payload += "\"motor_driver\":\"L298N_OUT3_OUT4\",";
  payload += "\"is_realtime\":true,";

  // Status Vision
  payload += "\"vision_connected\":" + String(visionAvailable ? "true" : "false");

  if (visionAvailable) {
    payload += ",";
    payload += "\"esp32cam_mac\":\"" + String(esp32CamMac) + "\",";
    payload += "\"vision_scan\":" + String(visionScanNumber) + ",";
    payload += "\"vision_prediction\":\"" + String(visionPrediction) + "\",";
    payload += "\"vision_confidence\":" + String(visionConfidence, 2) + ",";
    payload += "\"vision_healthy\":" + String(visionHealthy, 2) + ",";
    payload += "\"vision_powdery\":" + String(visionPowdery, 2) + ",";
    payload += "\"vision_rust\":" + String(visionRust, 2) + ",";
    payload += "\"image_ready\":" + String(imageReady ? "true" : "false") + ",";
    payload += "\"image_size\":" + String(currentImageSize);
  }
  payload += "}";

  // Publish to both topics for 100% full compatibility
  mqttClient.publish(MQTT_TOPIC_DATA, payload.c_str());
  mqttClient.publish(MQTT_TOPIC_AGRAPATHA, payload.c_str());

  Serial.println("\n[MQTT] Telemetri Dipublikasikan ke EMQX:");
  Serial.printf("  Suhu: %.2f C | RH: %.2f %% | Tanah: %.1f %% | MQ-135 Raw: %d | Flame: %s\n",
                currentTemperature, currentHumidity, soilMoisture, mq135Raw, flameDetected ? "API!" : "Aman");
}

void publishImageMQTT() {
  uint8_t* pubBuf  = nullptr;
  uint32_t pubSize = 0;
  uint32_t pubScan = 0;

  portENTER_CRITICAL(&imageMux);
  if (imageReady && imageBuffer != nullptr && currentImageSize > 0) {
    pubBuf           = imageBuffer;
    pubSize          = currentImageSize;
    pubScan          = imageScanNumber;
    imageBuffer      = nullptr; // Detached from shared state: exclusive loopTask ownership
    currentImageSize = 0;
    expectedChunks   = 0;
    imageReady       = false;
    receivingImage   = false;
    newImageReady    = false;
    resetChunkTracking();
  }
  portEXIT_CRITICAL(&imageMux);

  if (pubBuf == nullptr) {
    return;
  }

  if (pubScan == lastPublishedImageScan) {
    free(pubBuf);
    return;
  }

  if (mqttClient.connected()) {
    const bool started = mqttClient.beginPublish(MQTT_TOPIC_IMAGE, pubSize, false);
    const size_t written = started ? mqttClient.write(pubBuf, pubSize) : 0;
    const bool ended = started && mqttClient.endPublish();

    if (ended && written == pubSize) {
      lastPublishedImageScan = pubScan;
      Serial.printf("[MQTT] Raw JPEG Berhasil Dipublikasikan: %lu byte\n", (unsigned long)pubSize);
    } else {
      Serial.println("[MQTT] Gagal mempublikasikan JPEG.");
    }
  } else {
    Serial.println("[MQTT] MQTT tidak terhubung. Frame JPEG dibatalkan.");
  }

  // Lifecycle selesai: bebaskan buffer dalam semua jalur (berhasil maupun gagal)
  free(pubBuf);
}

// ======================================================
// ESP-NOW RECEIVE HANDLER
// ======================================================
void onEspNowReceive(const esp_now_recv_info_t* info, const uint8_t* incomingData, int len) {
  if (incomingData == nullptr || len <= 0) return;

  if (info != nullptr && info->src_addr != nullptr) {
    memcpy(targetCamMac, info->src_addr, 6);
    hasLearnedCamMac = true;
    if (!esp_now_is_peer_exist(targetCamMac)) {
      esp_now_peer_info_t peer = {};
      memcpy(peer.peer_addr, targetCamMac, 6);
      peer.channel = WiFi.channel();
      peer.encrypt = false;
      peer.ifidx   = WIFI_IF_STA;
      esp_now_add_peer(&peer);
    }
    sprintf(esp32CamMac, "%02X:%02X:%02X:%02X:%02X:%02X",
            info->src_addr[0], info->src_addr[1], info->src_addr[2],
            info->src_addr[3], info->src_addr[4], info->src_addr[5]);
  }

  const uint8_t packetType = incomingData[0];

  if (packetType == PACKET_RESULT && len == sizeof(VisionResultPacket)) {
    VisionResultPacket packet;
    memcpy(&packet, incomingData, sizeof(packet));
    visionAvailable     = true;
    lastVisionReceived  = millis();
    visionScanNumber    = packet.scanNumber;
    strncpy(visionPrediction, packet.visionClass, sizeof(visionPrediction) - 1);
    visionPrediction[sizeof(visionPrediction) - 1] = '\0';
    visionConfidence    = packet.confidence;
    visionHealthy       = packet.healthy;
    visionPowdery       = packet.powdery;
    visionRust          = packet.rust;
    newVisionReady      = true;
    Serial.printf("\n[ESP-NOW] Metadata Diterima: %s (%.2f%%)\n", visionPrediction, visionConfidence);
  }
  else if (packetType == PACKET_IMAGE_START && len == (int)sizeof(ImageStartPacket)) {
    ImageStartPacket packet;
    memcpy(&packet, incomingData, sizeof(packet));

    if (packet.imageSize > 0 && packet.imageSize <= MAX_IMAGE_SIZE) {
      uint16_t calcChunks = (packet.imageSize + IMAGE_CHUNK_SIZE - 1) / IMAGE_CHUNK_SIZE;
      if (packet.totalChunks == calcChunks && packet.totalChunks <= MAX_IMAGE_CHUNKS) {
        // Alokasi memori DILUAR critical section (Rule 3)
        uint8_t* newBuf = (uint8_t*)malloc(packet.imageSize);
        uint8_t* oldBuf = nullptr;

        portENTER_CRITICAL(&imageMux);
        oldBuf = imageBuffer;

        if (newBuf != nullptr) {
          imageBuffer         = newBuf;
          currentImageSize    = packet.imageSize;
          imageScanNumber     = packet.scanNumber;
          expectedChunks      = packet.totalChunks;
          receivingImage      = true;
          imageReady          = false;
          newImageReady       = false;
          resetChunkTracking();
          lastChunkReceivedAt = millis();
        } else {
          imageBuffer         = nullptr;
          currentImageSize    = 0;
          expectedChunks      = 0;
          receivingImage      = false;
          imageReady          = false;
          newImageReady       = false;
          resetChunkTracking();
        }
        portEXIT_CRITICAL(&imageMux);

        // Bebaskan buffer lama DILUAR critical section (Rule 3)
        if (oldBuf != nullptr) {
          free(oldBuf);
        }

        if (newBuf != nullptr) {
          Serial.printf("[ESP-NOW] Mulai Terima Foto: %lu bytes (%u chunks)\n",
                        (unsigned long)packet.imageSize, packet.totalChunks);
        } else {
          Serial.printf("[ESP-NOW] Gagal alokasi RAM %lu bytes untuk foto!\n",
                        (unsigned long)packet.imageSize);
        }
      } else {
        Serial.printf("[ESP-NOW] Paket START tidak valid: totalChunks (%u) != terhitung (%u)\n",
                      packet.totalChunks, calcChunks);
      }
    } else {
      Serial.printf("[ESP-NOW] Ukuran foto tidak valid: %lu bytes (max: %u)\n",
                    (unsigned long)packet.imageSize, MAX_IMAGE_SIZE);
    }
  }
  else if (packetType == PACKET_IMAGE_CHUNK) {
    if (len < 9) return;
    ImageChunkPacket packet;
    memcpy(&packet, incomingData, len < (int)sizeof(packet) ? len : sizeof(packet));

    portENTER_CRITICAL(&imageMux);
    if (receivingImage && imageBuffer != nullptr &&
        packet.scanNumber == imageScanNumber && packet.chunkIndex < expectedChunks) {
      uint16_t expectedLen = (packet.chunkIndex < expectedChunks - 1)
                                 ? IMAGE_CHUNK_SIZE
                                 : (uint16_t)(currentImageSize - ((uint32_t)packet.chunkIndex * IMAGE_CHUNK_SIZE));

      uint32_t offset = (uint32_t)packet.chunkIndex * IMAGE_CHUNK_SIZE;

      if (packet.dataLength == expectedLen &&
          (int)(9 + packet.dataLength) <= len &&
          (offset + packet.dataLength) <= currentImageSize) {
        if (!isChunkReceived(packet.chunkIndex)) {
          memcpy(imageBuffer + offset, packet.data, packet.dataLength);
          markChunkReceived(packet.chunkIndex);
          receivedChunks++;
          lastChunkReceivedAt = millis();
        }
      }
    }
    portEXIT_CRITICAL(&imageMux);
  }
  else if (packetType == PACKET_IMAGE_END) {
    if (len < (int)sizeof(ImageEndPacket)) return;
    ImageEndPacket packet;
    memcpy(&packet, incomingData, sizeof(packet));

    uint8_t* badBuf = nullptr;
    bool frameVerified = false;
    uint32_t verifiedSize = 0;

    portENTER_CRITICAL(&imageMux);
    if (receivingImage && packet.scanNumber == imageScanNumber && packet.totalChunks == expectedChunks) {
      if (receivedChunks == expectedChunks && currentImageSize >= 4 && imageBuffer != nullptr) {
        // Validate JPEG header (0xFFD8) & footer (0xFFD9)
        bool validJpeg = (imageBuffer[0] == 0xFF && imageBuffer[1] == 0xD8) &&
                         (imageBuffer[currentImageSize - 2] == 0xFF && imageBuffer[currentImageSize - 1] == 0xD9);
        if (validJpeg) {
          receivingImage = false;
          imageReady     = true;
          newImageReady  = true;
          frameVerified  = true;
          verifiedSize   = currentImageSize;
        } else {
          badBuf           = imageBuffer;
          imageBuffer      = nullptr;
          currentImageSize = 0;
          expectedChunks   = 0;
          receivingImage   = false;
          imageReady       = false;
          newImageReady    = false;
          resetChunkTracking();
        }
      } else {
        badBuf           = imageBuffer;
        imageBuffer      = nullptr;
        currentImageSize = 0;
        expectedChunks   = 0;
        receivingImage   = false;
        imageReady       = false;
        newImageReady    = false;
        resetChunkTracking();
      }
    }
    portEXIT_CRITICAL(&imageMux);

    if (badBuf != nullptr) {
      free(badBuf);
      Serial.println("[ESP-NOW] Frame tidak lengkap atau bukan JPEG valid. Buffer dibebaskan.");
    } else if (frameVerified) {
      Serial.printf("[ESP-NOW] Foto JPEG Lengkap & Terverifikasi (%lu bytes)!\n",
                    (unsigned long)verifiedSize);
    }
  }
}

// ======================================================
// SERIAL MONITOR COMMANDS (DEBUGGING)
// ======================================================
void handleSerial() {
  if (!Serial.available()) return;
  char cmd = Serial.read();
  if (cmd == 'R' || cmd == 'r') motorRight();
  else if (cmd == 'L' || cmd == 'l') motorLeft();
  else if (cmd == 'S' || cmd == 's') motorStop();
  else if (cmd == 'C' || cmd == 'c') triggerCameraCapture();
  else if (cmd == 'K' || cmd == 'k') {
    Serial.printf("\n[LIMIT TEST] Kiri: %s | Kanan: %s\n",
                  digitalRead(LIMIT_LEFT) == LOW ? "TRIGGERED" : "OPEN",
                  digitalRead(LIMIT_RIGHT) == LOW ? "TRIGGERED" : "OPEN");
  }
}

// ======================================================
// SETUP
// ======================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n========================================");
  Serial.println("AGRAPATHA & GRENVIS ESP32 MAIN CONTROLLER");
  Serial.println("========================================");

  // Inisialisasi Sensor Pin
  dht.begin();
  pinMode(SOIL_PIN, INPUT);
  pinMode(MQ135_PIN, INPUT);
#if FLAME_SENSOR_USE_ANALOG
  pinMode(FLAME_AO_PIN, INPUT);
#else
  pinMode(FLAME_DO_PIN, INPUT);
#endif
  analogReadResolution(12);

  // Inisialisasi Motor L298N (OUT3 & OUT4)
  pinMode(MOTOR_IN3, OUTPUT);
  pinMode(MOTOR_IN4, OUTPUT);
  motorStop();

  // Inisialisasi Limit Switches
  pinMode(LIMIT_LEFT, INPUT_PULLUP);
  pinMode(LIMIT_RIGHT, INPUT_PULLUP);

  // Koneksi WiFi & ESP-NOW
  connectWiFi();

  if (esp_now_init() == ESP_OK) {
    esp_now_register_recv_cb(onEspNowReceive);
    esp_now_peer_info_t cameraPeer = {};
    memcpy(cameraPeer.peer_addr, ESP32_CAM_MAC, sizeof(ESP32_CAM_MAC));
    cameraPeer.channel = WiFi.channel();
    cameraPeer.encrypt = false;
    cameraPeer.ifidx   = WIFI_IF_STA;
    if (!esp_now_is_peer_exist(ESP32_CAM_MAC)) {
      esp_now_add_peer(&cameraPeer);
    }
    Serial.println("[ESP-NOW] Inisialisasi Berhasil & Siap Komunikasi.");
  }

  // Setup MQTT over TLS (Port 8883) with Root CA Certificate Verification
  secureClient.setCACert(MQTT_CA_CERT);
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setBufferSize(1536);
  mqttClient.setCallback(onMqttMessage);
  connectMQTT();

  Serial.println("========================================");
  Serial.println("SISTEM SIAP (Ketik 'R', 'L', 'S', 'C' di Serial Monitor)");
  Serial.println("========================================");
}

// ======================================================
// LOOP
// ======================================================
void loop() {
  checkLimitSwitch();
  handleSerial();

  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqttClient.connected()) connectMQTT();
  mqttClient.loop();

  // Inactivity timeout watchdog: batalkan frame yang tertinggal setelah 2500 ms tanpa progres
  uint8_t* timeoutBuf = nullptr;
  portENTER_CRITICAL(&imageMux);
  if (receivingImage && (millis() - lastChunkReceivedAt >= IMAGE_TIMEOUT_MS)) {
    timeoutBuf       = imageBuffer;
    imageBuffer      = nullptr;
    currentImageSize = 0;
    expectedChunks   = 0;
    receivingImage   = false;
    imageReady       = false;
    newImageReady    = false;
    resetChunkTracking();
  }
  portEXIT_CRITICAL(&imageMux);

  if (timeoutBuf != nullptr) {
    free(timeoutBuf);
    Serial.println("[ESP-NOW] Timeout reassembly (2500 ms tanpa progres): frame dibatalkan & buffer dibebaskan.");
  }

  // Kirim data sesegera mungkin saat vision / image baru selesai dirangkai
  if (newVisionReady) {
    newVisionReady = false;
    publishMQTT();
  }
  if (newImageReady) {
    newImageReady = false;
    publishImageMQTT();
  }

  // Interval loop telemetri berkala (3 detik)
  if (millis() - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = millis();
    readDht();
    readSoil();
    readMq135();
    readFlame();
    publishMQTT();
  }
}
