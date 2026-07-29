#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ================= CẤU HÌNH =================
const char *WIFI_SSID = "VGU_Student_Guest";  // Thay bằng tên Wi-Fi
const char *WIFI_PASSWORD = "";               // Thay bằng mật khẩu Wi-Fi
const char *MQTT_BROKER_IP = "broker.emqx.io"; // Public Cloud MQTT Broker (EMQX)
const int MQTT_PORT = 1883;
const char *LAB_CODE = "304"; // THAY BẰNG LAB CODE CỦA BẠN (Ví dụ: lab_1, B203, ...)
char MQTT_TOPIC[128];

#define DHTPIN 4      // Chân DATA của DHT11 nối với GPIO 4
#define DHTTYPE DHT11 // Loại cảm biến DHT11

DHT dht(DHTPIN, DHTTYPE);
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
  mqttClientId = "SmartDoor_DHT11_" + mac;
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
    doc["device_name"] = "ESP32 Subnode 1 (DHT11)";
    doc["sensors"] = "DHT11 Temp & Humidity";
    
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
  dht.begin();
  Serial.println("DHT11 Sensor Initialized.");

  setupWiFi();
  
  // Tạo MQTT Topic chuẩn xác với Lab Code
  snprintf(MQTT_TOPIC, sizeof(MQTT_TOPIC), "smartdoor/%s/sensors/dht11", LAB_CODE);
  Serial.print("Target MQTT Topic: ");
  Serial.println(MQTT_TOPIC);
  
  mqttClient.setServer(MQTT_BROKER_IP, MQTT_PORT);
  mqttClient.setBufferSize(512);
  mqttClient.setKeepAlive(30);
}

void loop() {
  // 1. Tự động kiểm tra và phục hồi kết nối Wi-Fi & MQTT không gây treo loop
  checkMQTTConnection();

  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  // 2. Gửi dữ liệu cảm biến định kỳ mỗi 3s
  uint32_t currentMs = millis();
  if (currentMs - lastTxMs >= TX_INTERVAL) {
    lastTxMs = currentMs;

    float h = dht.readHumidity();
    float t = dht.readTemperature(); // Độ C

    bool dht_ok = true;
    if (isnan(h) || isnan(t)) {
      Serial.println("❌ Failed to read from DHT sensor!");
      dht_ok = false;
      t = 0.0;
      h = 0.0;
    }

    // Đóng gói JSON
    StaticJsonDocument<256> doc;
    doc["node_id"] = mqttClientId;
    doc["device_name"] = "Subnode 1 - Environment (DHT11)";
    doc["timestamp_ms"] = currentMs;
    doc["temperature"] = serialized(String(t, 1));
    doc["humidity"] = serialized(String(h, 1));
    doc["dht_ok"] = dht_ok;
    doc["online"] = true;

    char payload[256];
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
