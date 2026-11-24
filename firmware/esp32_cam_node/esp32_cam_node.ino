/**
 * ==============================================================================
 * AGRAPATHA & GRENVIS — ESP32-CAM AI VISION NODE (ARM END-EFFECTOR MOUNT)
 * Board: AI-Thinker ESP32-CAM (OV2640 Sensor)
 * ==============================================================================
 * FITUR:
 * 1. Capture Citra Hardware OV2640 (QVGA / 320x240 @ JPEG Quality 12).
 * 2. Transmisi ke Railway Cloud Backend via HTTPS POST multipart/form-data (/predict/fire).
 * 3. Model Computer Vision: MobileNetV2 3-Kelas ("FIRE", "SMOKE", "SAFE").
 * 4. Transmisi Hasil AI ke NodeMCU ESP32-S Main Controller via ESP-NOW.
 * 5. Target MAC Main Controller: 8C:AA:B5:37:71:18.
 * ==============================================================================
 */

#include "esp_camera.h"
#include "soc/rtc_cntl_reg.h"
#include "soc/soc.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <ArduinoJson.h>

// ======================================================
// 1. PIN DEFINITIONS AI-THINKER ESP32-CAM
// ======================================================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

#define FLASH_LED_PIN      4

// ======================================================
// 2. KREDENSIAL & KONFIGURASI RAILWAY
// ======================================================
#if __has_include("credentials.h")
  #include "credentials.h"
#else
  const char* WIFI_SSID     = "YOUR_WIFI_SSID";
  const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
#endif

// Endpoint Railway FastAPI MobileNetV2
const char* AI_HOST = "tes-tflite-production.up.railway.app";
const char* AI_PATH = "/predict/fire";

// MAC Address NodeMCU ESP32-S Main Controller
const uint8_t TARGET_MAIN_MAC[6] = { 0x8C, 0xAA, 0xB5, 0x37, 0x71, 0x18 };
constexpr uint8_t DEFAULT_ESP_NOW_CHANNEL = 6;

// ======================================================
// 3. STRUKTUR PROTOKOL ESP-NOW
// ======================================================
#define PACKET_VISION_RESULT   1
#define PACKET_IMAGE_START     2
#define PACKET_IMAGE_CHUNK     3
#define PACKET_IMAGE_END       4
#define PACKET_CAPTURE_REQUEST 5

#define IMAGE_CHUNK_SIZE       200

typedef struct __attribute__((packed)) {
  uint8_t  packetType;        // 1 = Result
  uint32_t scanNumber;
  char     visionClass[16];   // "FIRE", "SMOKE", "SAFE", "Unknown"
  float    confidence;        // 0.0 - 1.0
  float    fireScore;
  float    smokeScore;
  float    safeScore;
  uint32_t timestampMs;
} CameraAiPacket;

typedef struct __attribute__((packed)) {
  uint8_t  packetType;
  uint32_t scanNumber;
  uint32_t imageSize;
  uint16_t totalChunks;
} ImageStartPacket;

typedef struct __attribute__((packed)) {
  uint8_t  packetType;
  uint32_t scanNumber;
  uint16_t chunkIndex;
  uint16_t dataLength;
  uint8_t  data[IMAGE_CHUNK_SIZE];
} ImageChunkPacket;

typedef struct __attribute__((packed)) {
  uint8_t  packetType;
  uint32_t scanNumber;
  uint16_t totalChunks;
} ImageEndPacket;

// Global Variables
bool cameraHardwareReady = false;
volatile bool captureRequested = false;
uint32_t scanCounter = 0;
unsigned long lastInferenceTime = 0;
const unsigned long AUTO_INFERENCE_INTERVAL_MS = 2000;

// ======================================================
// 4. INISIALISASI KAMERA OV2640
// ======================================================
bool initCamera() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Nonaktifkan brownout detector

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  
  // Resolusi QVGA (320x240) - ukuran optimal untuk inferensi MobileNetV2 224x224
  config.frame_size   = FRAMESIZE_QVGA;
  config.jpeg_quality = 12;
  config.fb_count     = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM ERROR] Gagal inisialisasi OV2640 (0x%x)\n", err);
    cameraHardwareReady = false;
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s != nullptr) {
    s->set_brightness(s, 1);
    s->set_contrast(s, 1);
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);
  }

  cameraHardwareReady = true;
  Serial.println("[CAM OK] Sensor Kamera OV2640 Siap.");
  return true;
}

// ======================================================
// 5. QUERY INFERENSI KE RAILWAY CLOUD BACKEND
// ======================================================
bool queryCloudAiVision(const uint8_t *jpegBuf, size_t jpegLen, CameraAiPacket *outResult) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[AI-CLOUD] WiFi tidak terhubung.");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Menggunakan SSL tanpa verifikasi sertifikat lokal
  client.setTimeout(10000);

  Serial.printf("[AI-CLOUD] Mengirim citra (%u byte) ke https://%s%s...\n", jpegLen, AI_HOST, AI_PATH);

  if (!client.connect(AI_HOST, 443)) {
    Serial.println("[AI-CLOUD] Gagal membuka soket HTTPS ke Railway.");
    return false;
  }

  const String boundary = "----ESP32CAMBoundary" + String(millis());
  const String head = "--" + boundary + "\r\n" +
                      "Content-Disposition: form-data; name=\"file\"; filename=\"frame.jpg\"\r\n" +
                      "Content-Type: image/jpeg\r\n\r\n";
  const String tail = "\r\n--" + boundary + "--\r\n";
  const size_t totalLen = head.length() + jpegLen + tail.length();

  // Kirim Header HTTP POST
  client.println("POST " + String(AI_PATH) + " HTTP/1.1");
  client.println("Host: " + String(AI_HOST));
  client.println("Content-Type: multipart/form-data; boundary=" + boundary);
  client.println("Content-Length: " + String(totalLen));
  client.println("User-Agent: ESP32-CAM-AI-ARM/2.0");
  client.println("Connection: close");
  client.println();

  // Kirim Header Boundary
  client.print(head);

  // Streaming body gambar per 1024 byte agar aman di buffer RAM
  const size_t chunkSize = 1024;
  for (size_t offset = 0; offset < jpegLen; offset += chunkSize) {
    size_t toWrite = (jpegLen - offset > chunkSize) ? chunkSize : (jpegLen - offset);
    client.write(jpegBuf + offset, toWrite);
  }

  client.print(tail);
  client.flush();

  // Tunggu respon Railway
  unsigned long startWait = millis();
  while (!client.available() && millis() - startWait < 8000) {
    delay(50);
  }

  String statusLine = client.readStringUntil('\n');
  Serial.printf("[AI-CLOUD] Status: %s\n", statusLine.c_str());

  // Lewati HTTP Header
  while (client.available()) {
    String line = client.readStringUntil('\n');
    if (line == "\r" || line.length() == 0) break;
  }

  // Baca Payload JSON
  String payload = client.readString();
  client.stop();

  if (payload.length() == 0) {
    Serial.println("[AI-CLOUD] Respon kosong dari server.");
    return false;
  }

  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    Serial.printf("[AI-CLOUD ERROR] Deserialisasi JSON gagal: %s\n", err.c_str());
    return false;
  }

  const char* status = doc["status"] | "error";
  if (strcmp(status, "success") == 0) {
    const char* label = doc["class"] | "SAFE";
    strncpy(outResult->visionClass, label, sizeof(outResult->visionClass) - 1);
    outResult->visionClass[sizeof(outResult->visionClass) - 1] = '\0';
    outResult->confidence = doc["confidence"] | 0.0f;
    outResult->fireScore  = doc["scores"]["FIRE"]  | 0.0f;
    outResult->smokeScore = doc["scores"]["SMOKE"] | 0.0f;
    outResult->safeScore  = doc["scores"]["SAFE"]  | 0.0f;
    outResult->timestampMs = millis();

    Serial.printf("[AI-CLOUD HASIL] Kelas: %s (%.1f%%) | Fire: %.2f | Smoke: %.2f | Safe: %.2f\n",
                  outResult->visionClass, outResult->confidence * 100.0,
                  outResult->fireScore, outResult->smokeScore, outResult->safeScore);
    return true;
  }

  return false;
}

// ======================================================
// 6. ESP-NOW WIRELESS TRANSMITTER KE ESP32 MAIN
// ======================================================
void onEspNowReceive(const esp_now_recv_info_t *info, const uint8_t *incomingData, int len) {
  if (incomingData != nullptr && len > 0) {
    if (incomingData[0] == PACKET_CAPTURE_REQUEST) {
      captureRequested = true;
      Serial.println("[ESP-NOW] Permintaan capture diterima dari ESP32 Main.");
    }
  }
}

bool initESPNow() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW ERROR] Gagal inisialisasi.");
    return false;
  }

  esp_now_register_recv_cb(onEspNowReceive);

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, TARGET_MAIN_MAC, 6);
  peerInfo.channel = WiFi.channel();
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) == ESP_OK) {
    Serial.println("[ESP-NOW OK] Peer ESP32 Main terdaftar.");
    return true;
  }
  return false;
}

// ======================================================
// 7. SETUP & MAIN LOOP
// ======================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[AGRAPATHA] Inisialisasi ESP32-CAM AI Vision Node...");

  initCamera();

  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] Menghubungkan ke %s", WIFI_SSID);

  uint32_t startMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startMs < 8000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi OK] IP: %s | Channel: %d\n", WiFi.localIP().toString().c_str(), WiFi.channel());
  }

  initESPNow();
}

void loop() {
  unsigned long now = millis();

  // Eksekusi inferensi otomatis berkala atau sesuai permintaan trigger arm
  if ((now - lastInferenceTime >= AUTO_INFERENCE_INTERVAL_MS) || captureRequested) {
    lastInferenceTime = now;
    captureRequested = false;

    if (!cameraHardwareReady) return;

    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[CAM ERROR] Gagal mengambil buffer gambar.");
      return;
    }

    CameraAiPacket packet = {};
    packet.packetType = PACKET_VISION_RESULT;
    packet.scanNumber = ++scanCounter;

    // 1. Query Inferensi ke Railway API
    bool success = queryCloudAiVision(fb->buf, fb->len, &packet);
    if (!success) {
      // Fallback aman jika Railway offline / timeout
      strncpy(packet.visionClass, "Unknown", sizeof(packet.visionClass) - 1);
      packet.confidence = 0.0f;
      packet.fireScore = 0.0f;
      packet.smokeScore = 0.0f;
      packet.safeScore = 0.0f;
      packet.timestampMs = millis();
    }

    // 2. Transmisikan Hasil ke NodeMCU ESP32-S Main Controller via ESP-NOW
    esp_err_t sendErr = esp_now_send(TARGET_MAIN_MAC, (uint8_t *)&packet, sizeof(packet));
    if (sendErr == ESP_OK) {
      Serial.printf("[ESP-NOW OK] Hasil AI terkirim ke Main: %s (%.2f%%)\n",
                    packet.visionClass, packet.confidence * 100.0);
    } else {
      Serial.printf("[ESP-NOW ERROR] Gagal kirim ke Main (0x%x)\n", sendErr);
    }

    esp_camera_fb_return(fb);
  }
}
