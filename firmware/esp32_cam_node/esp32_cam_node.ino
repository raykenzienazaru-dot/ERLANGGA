/**
 * ==============================================================================
 * AGRAPATHA & GRENVIS — ESP32-CAM AI VISION NODE
 * Board: AI-Thinker ESP32-CAM (OV2640 Sensor)
 * ==============================================================================
 * FEATURES:
 * - OV2640 Hardware Camera Capture (QVGA / 320x240 @ JPEG Quality 10)
 * - Direct Cloud AI Inference on Railway:
 *     URL: https://tes-tflite-production.up.railway.app/api/v1/predict
 *     Accepts multipart/form-data field 'file'
 * - Alternative Leaf Disease Inference on Railway:
 *     URL: https://web-production-e0039.up.railway.app/predict
 * - ESP-NOW Streaming: Transmits AI metadata & chunked JPEG to ESP32 Main
 * - Target Receiver MAC (ESP32 Main): 8C:AA:B5:37:71:18
 * ==============================================================================
 */

#include "esp_camera.h"
#include "soc/rtc_cntl_reg.h"
#include "soc/soc.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_now.h>
#include <esp_wifi.h>

// ======================================================
// 1. WI-FI & RAILWAY CLOUD AI BACKEND CONFIGURATION
// ======================================================
const char *WIFI_SSID = ".";
const char *WIFI_PASSWORD = "01020304";

// Primary Railway Backend for AGRAPATHA (Wildfire MobileNetV2 Inference)
const char *AI_HOST = "tes-tflite-production.up.railway.app";
const char *AI_PATH = "/api/v1/predict";

// Alternative Backend for Plant Leaf Disease (Set to true if testing leaf
// model)
const bool USE_LEAF_MODEL_FALLBACK = false;
const char *LEAF_AI_HOST = "web-production-e0039.up.railway.app";
const char *LEAF_AI_PATH = "/predict";

// Flash LED pin
#define FLASH_LED_PIN 4

// ======================================================
// 2. AI THINKER ESP32-CAM PIN DEFINITIONS
// ======================================================
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27

#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5

#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

// ======================================================
// 3. TARGET RECEIVER (ESP32 MAIN NODE)
// ======================================================
uint8_t receiverMAC[] = {0x8C, 0xAA, 0xB5, 0x37, 0x71, 0x18};
constexpr uint8_t DEFAULT_ESP_NOW_CHANNEL = 6;

// Packet Protocol Identifiers
#define PACKET_RESULT 1
#define PACKET_IMAGE_START 2
#define PACKET_IMAGE_CHUNK 3
#define PACKET_IMAGE_END 4
#define PACKET_CAPTURE_REQUEST 5

#define IMAGE_CHUNK_SIZE 200

typedef struct __attribute__((packed)) {
  uint8_t packetType;
  uint32_t scanNumber;
  char visionClass[16];
  float confidence;
  float healthy; // Score 1 (Non-Fire / Healthy)
  float powdery; // Score 2 (Smoke / Powdery)
  float rust;    // Score 3 (Fire / Rust)
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

// State Variables
uint32_t scanCounter = 0;
volatile bool captureRequested = false;
bool cameraHardwareReady = false;

// ======================================================
// 4. OV2640 CAMERA INITIALIZATION
// ======================================================
bool initCamera() {
  Serial.println("\n========================================");
  Serial.println("INISIALISASI KAMERA OV2640 HARDWARE");
  Serial.println("========================================");

  if (PWDN_GPIO_NUM != -1) {
    pinMode(PWDN_GPIO_NUM, OUTPUT);
    digitalWrite(PWDN_GPIO_NUM, HIGH);
    delay(100);
    digitalWrite(PWDN_GPIO_NUM, LOW);
    delay(100);
  }

  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;

  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;

  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    Serial.println(
        "[CAM] PSRAM Terdeteksi -> Resolusi QVGA (Optimal TFLite 224x224)");
    config.frame_size = FRAMESIZE_QVGA;
    config.jpeg_quality = 10;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    Serial.println("[CAM] PSRAM Tidak Aktif -> Alokasi DRAM Internal");
    config.frame_size = FRAMESIZE_QVGA;
    config.jpeg_quality = 12;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = ESP_FAIL;
  int freqs[] = {20000000, 10000000, 16500000};

  for (int attempt = 0; attempt < 3; attempt++) {
    config.xclk_freq_hz = freqs[attempt];
    Serial.printf("[CAM] Probe OV2640 (Percobaan %d/3, XCLK: %d MHz)...\n",
                  attempt + 1, config.xclk_freq_hz / 1000000);

    err = esp_camera_init(&config);
    if (err == ESP_OK) {
      Serial.printf("[CAM] Probe BERHASIL pada XCLK %d MHz!\n",
                    config.xclk_freq_hz / 1000000);
      break;
    }
    esp_camera_deinit();
    delay(150);
  }

  if (err != ESP_OK) {
    Serial.printf("[CAM ERROR] Hardware OV2640 GAGAL diinisialisasi (0x%x)!\n",
                  err);
    cameraHardwareReady = false;
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s != nullptr) {
    s->set_brightness(s, 1);
    s->set_contrast(s, 1);
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 0);
  }

  cameraHardwareReady = true;
  Serial.println("[CAM] HARDWARE KAMERA SIAP 100%!");
  return true;
}

// ======================================================
// 5. ESP-NOW WIRELESS PROTOCOL
// ======================================================
void onEspNowReceive(const esp_now_recv_info_t *info,
                     const uint8_t *incomingData, int len) {
  if (incomingData == nullptr || len < 1)
    return;

  if (info != nullptr && info->src_addr != nullptr) {
    memcpy(receiverMAC, info->src_addr, 6);
    if (!esp_now_is_peer_exist(receiverMAC)) {
      esp_now_peer_info_t peer = {};
      memcpy(peer.peer_addr, receiverMAC, 6);
      peer.channel = WiFi.channel();
      peer.encrypt = false;
      esp_now_add_peer(&peer);
    }
  }

  if (incomingData[0] == PACKET_CAPTURE_REQUEST) {
    captureRequested = true;
    Serial.println(
        "\n>>> [ESP-NOW] TRIGGER CAPTURE DITERIMA DARI ESP32 MAIN / WEB! <<<");
  }
}

bool initESPNow() {
  Serial.println("\n========================================");
  Serial.println("INISIALISASI ESP-NOW PADA ESP32-CAM");
  Serial.println("========================================");

  WiFi.mode(WIFI_STA);
  uint8_t activeChannel = DEFAULT_ESP_NOW_CHANNEL;

  // Sambungkan ke WiFi untuk sinkronisasi channel dan akses ke Railway Cloud
  if (strlen(WIFI_SSID) > 0) {
    Serial.printf("[WiFi] Menghubungkan ke AP '%s'...\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    uint32_t startMs = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startMs < 5000) {
      delay(200);
      Serial.print(".");
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
      activeChannel = WiFi.channel();
      Serial.printf("[WiFi] Terhubung! IP: %s | Channel: %d\n",
                    WiFi.localIP().toString().c_str(), activeChannel);
    } else {
      Serial.printf("[WiFi] AP belum tersambung. Memakai channel default: %d\n",
                    DEFAULT_ESP_NOW_CHANNEL);
      esp_wifi_set_channel(DEFAULT_ESP_NOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
    }
  }

  Serial.printf("ESP32-CAM MAC : %s\n", WiFi.macAddress().c_str());
  Serial.printf("Target MAC    : %02X:%02X:%02X:%02X:%02X:%02X\n",
                receiverMAC[0], receiverMAC[1], receiverMAC[2], receiverMAC[3],
                receiverMAC[4], receiverMAC[5]);

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Init GAGAL!");
    return false;
  }

  esp_now_register_recv_cb(onEspNowReceive);

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, receiverMAC, 6);
  peerInfo.channel = activeChannel;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK &&
      !esp_now_is_peer_exist(receiverMAC)) {
    Serial.println("[ESP-NOW] Add Peer Gagal.");
    return false;
  }

  Serial.println("[ESP-NOW] Siap Berkomunikasi.");
  return true;
}

// ======================================================
// 6. QUERY CLOUD AI INFERENCE (RAILWAY API MULTIPART)
// ======================================================
bool queryCloudAiVision(const uint8_t *jpegBuf, size_t jpegLen,
                        VisionResultPacket *outResult) {
  if (jpegBuf == nullptr || jpegLen == 0)
    return false;

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(
        "[AI-CLOUD] WiFi belum terhubung, melewati inferensi cloud.");
    return false;
  }

  const char *targetHost = USE_LEAF_MODEL_FALLBACK ? LEAF_AI_HOST : AI_HOST;
  const char *targetPath = USE_LEAF_MODEL_FALLBACK ? LEAF_AI_PATH : AI_PATH;

  Serial.println();
  Serial.printf("[AI-CLOUD] Mengirim %u byte JPEG ke Railway API...\n",
                (unsigned int)jpegLen);
  Serial.printf("[AI-CLOUD] URL: https://%s%s\n", targetHost, targetPath);

  WiFiClientSecure client;
  client.setInsecure(); // Bypass CA verification untuk endpoint Railway HTTPS
  client.setTimeout(12000);

  if (!client.connect(targetHost, 443)) {
    Serial.println("[AI-CLOUD] Gagal membuka soket HTTPS ke Railway.");
    return false;
  }

  // Siapkan header multipart form-data (sesuai spesifikasi FastAPI
  // /api/v1/predict)
  const String boundary = "----ESP32CAMBoundary" + String(millis());
  const String head = "--" + boundary + "\r\n" +
                      "Content-Disposition: form-data; name=\"file\"; "
                      "filename=\"camera.jpg\"\r\n" +
                      "Content-Type: image/jpeg\r\n\r\n";
  const String tail = "\r\n--" + boundary + "--\r\n";
  const size_t totalLen = head.length() + jpegLen + tail.length();

  // Kirim Header HTTP
  client.println("POST " + String(targetPath) + " HTTP/1.1");
  client.println("Host: " + String(targetHost));
  client.println("Content-Type: multipart/form-data; boundary=" + boundary);
  client.println("Content-Length: " + String(totalLen));
  client.println("User-Agent: ESP32-CAM-AI/1.0");
  client.println("Connection: close");
  client.println();

  // Streaming body multipart
  client.print(head);

  // Kirim chunk gambar per 1024 byte agar aman di buffer TCP ESP32
  const size_t chunkSize = 1024;
  for (size_t offset = 0; offset < jpegLen; offset += chunkSize) {
    size_t toWrite =
        (jpegLen - offset > chunkSize) ? chunkSize : (jpegLen - offset);
    client.write(jpegBuf + offset, toWrite);
  }

  client.print(tail);
  client.flush();

  // Baca respon dari Railway
  unsigned long startWait = millis();
  while (!client.available() && millis() - startWait < 10000) {
    delay(50);
  }

  String statusLine = client.readStringUntil('\n');
  Serial.printf("[AI-CLOUD] Respon Status: %s\n", statusLine.c_str());

  // Lewati HTTP Header
  while (client.available()) {
    String line = client.readStringUntil('\n');
    if (line == "\r" || line.length() == 0)
      break;
  }

  // Ambil Payload JSON
  String payload = client.readString();
  client.stop();

  Serial.printf("[AI-CLOUD] Respon Payload: %s\n", payload.c_str());

  // 1. Ekstrak label prediksi
  int predIdx = payload.indexOf("\"predicted_label\":\"");
  if (predIdx != -1) {
    int start = predIdx + 19;
    int end = payload.indexOf("\"", start);
    String label = payload.substring(start, end);
    strncpy(outResult->visionClass, label.c_str(),
            sizeof(outResult->visionClass) - 1);
    outResult->visionClass[sizeof(outResult->visionClass) - 1] = '\0';
  } else {
    // Fallback format jika memakai model leaf disease
    int altIdx = payload.indexOf("\"prediction\":\"");
    if (altIdx != -1) {
      int start = altIdx + 14;
      int end = payload.indexOf("\"", start);
      String label = payload.substring(start, end);
      strncpy(outResult->visionClass, label.c_str(),
              sizeof(outResult->visionClass) - 1);
      outResult->visionClass[sizeof(outResult->visionClass) - 1] = '\0';
    } else {
      strncpy(outResult->visionClass, "Unknown",
              sizeof(outResult->visionClass) - 1);
    }
  }

  // Helper untuk parsing float value dari JSON
  auto parseJsonVal = [&](const char *key, float fallback) -> float {
    int idx = payload.indexOf(key);
    if (idx != -1) {
      int start = idx + strlen(key);
      int end = payload.indexOf(",", start);
      if (end == -1)
        end = payload.indexOf("}", start);
      if (end != -1)
        return payload.substring(start, end).toFloat();
    }
    return fallback;
  };

  outResult->confidence = parseJsonVal("\"confidence_percentage\":",
                                       parseJsonVal("\"confidence\":", 0.0));
  outResult->healthy =
      parseJsonVal("\"Non-Fire\":", parseJsonVal("\"healthy\":", 0.0)) * 100.0;
  outResult->powdery =
      parseJsonVal("\"Smoke\":", parseJsonVal("\"powdery\":", 0.0)) * 100.0;
  outResult->rust =
      parseJsonVal("\"Fire\":", parseJsonVal("\"rust\":", 0.0)) * 100.0;

  Serial.printf("[AI-CLOUD] HASIL PREDIKSI: %s (%.2f%%) [Class1=%.1f%%, "
                "Class2=%.1f%%, Class3=%.1f%%]\n",
                outResult->visionClass, outResult->confidence,
                outResult->healthy, outResult->powdery, outResult->rust);
  return true;
}

// ======================================================
// 7. SEND METADATA & CHUNKS TO ESP32 MAIN VIA ESP-NOW
// ======================================================
void sendScanResult(uint32_t scanNumber, uint32_t imageSize,
                    const VisionResultPacket *cloudResult = nullptr) {
  VisionResultPacket packet;
  packet.packetType = PACKET_RESULT;
  packet.scanNumber = scanNumber;
  packet.imageSize = imageSize;

  if (cloudResult != nullptr && strlen(cloudResult->visionClass) > 0) {
    strncpy(packet.visionClass, cloudResult->visionClass,
            sizeof(packet.visionClass) - 1);
    packet.visionClass[sizeof(packet.visionClass) - 1] = '\0';
    packet.confidence = cloudResult->confidence;
    packet.healthy = cloudResult->healthy;
    packet.powdery = cloudResult->powdery;
    packet.rust = cloudResult->rust;
  } else {
    strncpy(packet.visionClass, "Unprocessed", sizeof(packet.visionClass) - 1);
    packet.visionClass[sizeof(packet.visionClass) - 1] = '\0';
    packet.confidence = 0.0;
    packet.healthy = 0.0;
    packet.powdery = 0.0;
    packet.rust = 0.0;
  }

  esp_now_send(receiverMAC, (uint8_t *)&packet, sizeof(packet));
  Serial.printf("[ESP-NOW] Metadata scan #%u terkirim ke ESP32 Main.\n",
                scanNumber);
}

void sendImageBufferESPNow(const uint8_t *buf, uint32_t imageSize,
                           uint32_t scanNumber) {
  if (buf == nullptr || imageSize == 0)
    return;
  uint16_t totalChunks = (imageSize + IMAGE_CHUNK_SIZE - 1) / IMAGE_CHUNK_SIZE;

  Serial.printf("[ESP-NOW] Mengirim foto JPEG (%u bytes, %u chunks)...\n",
                imageSize, totalChunks);

  // 1. Packet Mulai
  ImageStartPacket startPacket;
  startPacket.packetType = PACKET_IMAGE_START;
  startPacket.scanNumber = scanNumber;
  startPacket.imageSize = imageSize;
  startPacket.totalChunks = totalChunks;
  esp_now_send(receiverMAC, (uint8_t *)&startPacket, sizeof(startPacket));
  delay(20);

  // 2. Chunks
  for (uint16_t i = 0; i < totalChunks; i++) {
    ImageChunkPacket chunkPacket;
    chunkPacket.packetType = PACKET_IMAGE_CHUNK;
    chunkPacket.scanNumber = scanNumber;
    chunkPacket.chunkIndex = i;

    uint32_t offset = i * IMAGE_CHUNK_SIZE;
    uint16_t remaining = imageSize - offset;
    uint16_t chunkLength =
        (remaining > IMAGE_CHUNK_SIZE) ? IMAGE_CHUNK_SIZE : remaining;

    chunkPacket.dataLength = chunkLength;
    memcpy(chunkPacket.data, buf + offset, chunkLength);

    esp_now_send(receiverMAC, (uint8_t *)&chunkPacket, sizeof(chunkPacket));
    delay(15); // Jeda aman radio Wi-Fi buffer

    if (i % 10 == 0 || i == totalChunks - 1) {
      Serial.printf("[ESP-NOW] Chunk %u/%u\n", i + 1, totalChunks);
    }
  }

  // 3. Packet Selesai
  ImageEndPacket endPacket;
  endPacket.packetType = PACKET_IMAGE_END;
  endPacket.scanNumber = scanNumber;
  endPacket.totalChunks = totalChunks;
  esp_now_send(receiverMAC, (uint8_t *)&endPacket, sizeof(endPacket));
  Serial.println("[ESP-NOW] Seluruh chunk gambar berhasil ditransmisikan!");
}

// ======================================================
// 8. CAPTURE & DISPATCH SEQUENCE
// ======================================================
void captureAndSend() {
  scanCounter++;
  Serial.println("\n========================================");
  Serial.printf("SCAN #%lu: MENGAMBIL FOTO FISIK KAMERA\n",
                (unsigned long)scanCounter);
  Serial.println("========================================");

  if (!cameraHardwareReady && !initCamera()) {
    Serial.println("[CAM ERROR] Sensor fisik OV2640 tidak siap.");
    return;
  }

  // Flash pencahayaan sejenak
  digitalWrite(FLASH_LED_PIN, HIGH);
  delay(120);
  camera_fb_t *fb = esp_camera_fb_get();
  digitalWrite(FLASH_LED_PIN, LOW);

  if (!fb || fb->len == 0) {
    Serial.println("[CAM ERROR] Gagal capture frame kamera.");
    if (fb)
      esp_camera_fb_return(fb);
    return;
  }

  const uint8_t *imageBuffer = fb->buf;
  uint32_t imageSize = fb->len;
  Serial.printf("[CAM] Berhasil capture foto OV2640: %u bytes\n",
                (unsigned int)imageSize);

  // 1. Inferensi Cloud AI di Railway
  VisionResultPacket cloudResult = {};
  bool hasCloud = queryCloudAiVision(imageBuffer, imageSize, &cloudResult);

  // 2. Transmisi frame gambar utuh ke ESP32 Main via ESP-NOW
  sendImageBufferESPNow(imageBuffer, imageSize, scanCounter);
  delay(40);

  // 3. Transmisi hasil klasifikasi AI
  sendScanResult(scanCounter, imageSize, hasCloud ? &cloudResult : nullptr);

  esp_camera_fb_return(fb);
  Serial.println("[CAM] Frame selesai & memori framebuffer dibebaskan.");
}

// ======================================================
// 9. SETUP & LOOP
// ======================================================
void setup() {
  // Matikan brownout detector agar ESP32-CAM tidak restart mendadak saat
  // WiFi/kamera bekerja
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================");
  Serial.println("AGRAPATHA & GRENVIS ESP32-CAM NODE");
  Serial.println("========================================");

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  initCamera();
  initESPNow();

  Serial.println("\n========================================");
  Serial.println("SISTEM VISION SIAP");
  Serial.println("Ketik 'A' di Serial Monitor untuk trigger foto manual.");
  Serial.println("========================================");
}

void loop() {
  // Trigger Manual dari Serial Monitor PC
  if (Serial.available()) {
    char cmd = Serial.read();
    if (cmd == 'A' || cmd == 'a') {
      Serial.println("[SERIAL] Trigger foto manual diterima!");
      captureAndSend();
    }
  }

  // Trigger Otomatis dari Limit Switch ESP32 Main atau Web Dashboard
  if (captureRequested) {
    captureRequested = false;
    Serial.println("[TRIGGER] Trigger foto otomatis dieksekusi!");
    captureAndSend();
  }

  delay(20);
}
