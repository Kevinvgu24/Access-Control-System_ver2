#include <Arduino.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <TinyGPS++.h>
#include <WiFi.h>

// ================= CẤU HÌNH =================
const char *WIFI_SSID = "VGU_Student_Guest";  // Thay bằng tên Wi-Fi
const char *WIFI_PASSWORD = "";               // Thay bằng mật khẩu Wi-Fi
const char *MQTT_BROKER_IP = "broker.emqx.io"; // Public Cloud MQTT Broker (EMQX)
const int MQTT_PORT = 1883;
const char *LAB_CODE = "304"; // THAY BẰNG LAB CODE CỦA BẠN (Ví dụ: lab_1, B203, ...)
char MQTT_TOPIC[128];

// Chân giao tiếp UART cho GPS (HardwareSerial 2)
#define RXD2 16
#define TXD2 17
#define GPS_BAUD 115200

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

WiFiClient espClient;
PubSubClient mqttClient(espClient);

String mqttClientId;
const uint32_t TX_INTERVAL = 3000; // Gửi dữ liệu mỗi 3 giây
uint32_t lastTxMs = 0;
uint32_t lastMqttRetryMs = 0;

// ================= KẾT NỐI WI-FI (TỰ ĐỘNG KHÔI PHỤC) =================
void setupWiFi() {
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);
  
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ Wi-Fi Connected!");
    Serial.print("ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n⚠️ Wi-Fi connection pending, auto-reconnect active in background...");
  }

  // Tạo Hardware-based Unique Client ID từ MAC Address để tránh đụng độ trên Public Broker
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  mqttClientId = "SmartDoor_GPS_" + mac;
  Serial.print("Generated Hardware Unique MQTT Client ID: ");
  Serial.println(mqttClientId);
}

// ================= PHÁT TÍN HIỆU GHÉP NỐI BAN ĐẦU (INSTANT PAIRING ANNOUNCEMENT) =================
void sendPairingAnnouncement() {
  if (mqttClient.connected()) {
    StaticJsonDocument<256> doc;
    doc["node_id"] = mqttClientId;
    doc["event"] = "pairing_announcement";
    doc["status"] = "booting";
    doc["device_name"] = "ESP32 Subnode 2 (LC76G GPS)";
    doc["sensors"] = "LC76G GNSS GPS & CO2";
    
    char payload[256];
    serializeJson(doc, payload);
    mqttClient.publish("smartlab/subnodes/announce", payload);
    mqttClient.publish(MQTT_TOPIC, payload);
    Serial.println("📡 Broadcasted instant Startup Pairing Announcement to Server!");
  }
}

// ================= KẾT NỐI MQTT (NON-BLOCKING) =================
void checkMQTTConnection() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (!mqttClient.connected()) {
    uint32_t currentMs = millis();
    if (currentMs - lastMqttRetryMs >= 5000) {
      lastMqttRetryMs = currentMs;
      Serial.print("Connecting to MQTT Broker...");
      if (mqttClient.connect(mqttClientId.c_str())) {
        Serial.println(" ✅ Connected!");
        sendPairingAnnouncement(); // Phát tín hiệu ghép nối ngay khi vừa khởi động!
      } else {
        Serial.print(" ❌ Failed, rc=");
        Serial.print(mqttClient.state());
        Serial.println(" (Retrying in 5 seconds...)");
      }
    }
  }
}

void setup() {
  Serial.begin(115200);
  // Khởi tạo UART2 kết nối GPS với baudrate 115200
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, RXD2, TXD2);
  Serial.println("GPS Module Initialized.");

  setupWiFi();
  
  // Tạo MQTT Topic chuẩn xác với Lab Code
  snprintf(MQTT_TOPIC, sizeof(MQTT_TOPIC), "smartdoor/%s/sensors/gps", LAB_CODE);
  Serial.print("Target MQTT Topic: ");
  Serial.println(MQTT_TOPIC);
  
  mqttClient.setServer(MQTT_BROKER_IP, MQTT_PORT);
  mqttClient.setBufferSize(512);
  mqttClient.setKeepAlive(30);
}

void loop() {
  // 1. Luôn luôn đọc dữ liệu từ UART GPS liên tục
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // 2. Tự động kiểm tra và phục hồi kết nối Wi-Fi & MQTT không gây treo loop
  checkMQTTConnection();

  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  // 3. Gửi dữ liệu cảm biến định kỳ mỗi 3s
  uint32_t currentMs = millis();
  if (currentMs - lastTxMs >= TX_INTERVAL) {
    lastTxMs = currentMs;

    bool gnss_ok = gps.location.isValid();

    double lat = gnss_ok ? gps.location.lat() : 0.0;
    double lng = gnss_ok ? gps.location.lng() : 0.0;
    float altitude = gps.altitude.isValid() ? gps.altitude.meters() : 0.0;
    float speed = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
    int satellites = gps.satellites.isValid() ? gps.satellites.value() : 0;

    // Đóng gói JSON
    StaticJsonDocument<384> doc;
    doc["node_id"] = mqttClientId;
    doc["device_name"] = "Subnode 2 - GPS Tracker (LC76G)";
    doc["timestamp_ms"] = currentMs;
    doc["latitude"] = serialized(String(lat, 6));
    doc["longitude"] = serialized(String(lng, 6));
    doc["altitude"] = serialized(String(altitude, 1));
    doc["speed"] = serialized(String(speed, 1));
    doc["satellites"] = satellites;
    doc["gnss_ok"] = gnss_ok;
    doc["online"] = true;

    char payload[384];
    serializeJson(doc, payload);

    if (mqttClient.connected()) {
      mqttClient.publish(MQTT_TOPIC, payload);
      Serial.print("📤 Sent MQTT Payload to [");
      Serial.print(MQTT_TOPIC);
      Serial.print("]: ");
      Serial.println(payload);
    }
  }
}
