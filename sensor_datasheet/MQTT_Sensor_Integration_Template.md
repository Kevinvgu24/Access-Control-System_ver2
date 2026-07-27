# 📡 MQTT Sensor Integration Template cho Smart Lab (Raspberry Pi 5)

Tài liệu này cung cấp hướng dẫn và mẫu (template) chi tiết để các nhà phát triển sau này có thể dễ dàng lập trình thêm các cảm biến mới trên ESP32/ESP8266. 
Hệ thống **Raspberry Pi 5** đóng vai trò là MQTT Broker trung tâm, sẽ tự động lắng nghe, thu thập và hiển thị dữ liệu của các cảm biến này lên biểu đồ Dashboard.

## 1. Kiến trúc Hệ thống

- **MQTT Broker (Máy chủ):** Mosquitto chạy trên Raspberry Pi 5. (Mặc định IP: `192.168.1.100`, Port: `1883`)
- **MQTT Topic (Chủ đề):** `smartdoor/sensors/telemetry` (Raspberry Pi lắng nghe tất cả bản tin tại topic này).
- **Định dạng dữ liệu:** JSON phẳng (Flat JSON).

## 2. Định dạng JSON Chuẩn (Standard Payload)

Để Raspberry Pi tự động hiểu và vẽ được biểu đồ, gói tin JSON gửi đi từ ESP32 **PHẢI** chứa các trường dữ liệu tương ứng với cảm biến. 

Ví dụ các trường dữ liệu mà Frontend (React) đang hỗ trợ vẽ biểu đồ:
- `temperature` (float): Nhiệt độ (°C)
- `humidity` (float): Độ ẩm (%)
- `pm25` (float): Bụi mịn PM2.5 (µg/m3)
- `co2` (float): Nồng độ CO2 (ppm)
- `light` (float): Cường độ ánh sáng (Lux)
- `latitude` / `longitude` (double): Tọa độ GPS
- `altitude` (float): Độ cao (m)
- `speed` (float): Tốc độ (km/h)
- `satellites` (int): Số lượng vệ tinh
- `dht_ok`, `gnss_ok` (boolean): Trạng thái hoạt động của cảm biến

### Ví dụ Payload Gửi Đi (Sensor Nhiệt Độ & Độ Ẩm):
```json
{
  "node_id": "ESP32_DHT11_Node1",
  "timestamp_ms": 125433,
  "temperature": 25.4,
  "humidity": 60.2,
  "dht_ok": true
}
```

### Ví dụ Payload Gửi Đi (Sensor Khí Quang học PM2.5 & CO2):
```json
{
  "node_id": "ESP32_AirQuality_Node3",
  "timestamp_ms": 130000,
  "pm25": 15.5,
  "co2": 450.0,
  "online": true
}
```

## 3. Template Code Mẫu (Arduino IDE / PlatformIO)

Dưới đây là khung code mẫu (boilerplate) dùng cho bất kỳ cảm biến nào.

**Thư viện yêu cầu cài đặt:**
- `PubSubClient` (Nick O'Leary)
- `ArduinoJson` (Benoit Blanchon)

```cpp
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ================= CẤU HÌNH =================
const char* WIFI_SSID       = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD   = "YOUR_WIFI_PASSWORD";
const char* MQTT_BROKER_IP  = "192.168.1.100";  // Thay bằng IP của Raspberry Pi 5
const int   MQTT_PORT       = 1883;
const char* MQTT_TOPIC      = "smartdoor/sensors/telemetry";
const char* MQTT_CLIENT_ID  = "ESP32_NewSensor_NodeX";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

const uint32_t TX_INTERVAL = 2000; // Gửi dữ liệu mỗi 2 giây
uint32_t lastTxMs = 0;

// ================= HÀM KẾT NỐI =================
void setupWiFi() {
    Serial.print("Connecting to Wi-Fi...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500); Serial.print(".");
    }
    Serial.println(" Connected!");
}

void reconnectMQTT() {
    while (!mqttClient.connected()) {
        Serial.print("Connecting to MQTT...");
        if (mqttClient.connect(MQTT_CLIENT_ID)) {
            Serial.println(" Connected!");
        } else {
            Serial.println(" Failed! Retrying in 5s...");
            delay(5000);
        }
    }
}

// ================= KHỞI TẠO =================
void setup() {
    Serial.begin(115200);
    
    // Khởi tạo cảm biến của bạn tại đây...
    // mySensor.begin();

    setupWiFi();
    mqttClient.setServer(MQTT_BROKER_IP, MQTT_PORT);
}

// ================= VÒNG LẶP =================
void loop() {
    if (WiFi.status() != WL_CONNECTED) setupWiFi();
    if (!mqttClient.connected()) reconnectMQTT();
    mqttClient.loop();

    uint32_t currentMs = millis();
    if (currentMs - lastTxMs >= TX_INTERVAL) {
        lastTxMs = currentMs;

        // Đọc dữ liệu từ cảm biến của bạn
        // float temp = mySensor.readTemperature();
        float myValue = random(10, 50); // Dữ liệu giả lập

        // Khởi tạo file JSON
        StaticJsonDocument<256> doc;
        doc["node_id"] = MQTT_CLIENT_ID;
        doc["timestamp_ms"] = currentMs;
        
        // Thêm các trường tham số (Frontend sẽ tự động nhận diện nếu tên trường khớp)
        doc["temperature"] = myValue; 
        doc["online"] = true;

        // Đóng gói và gửi qua MQTT
        char payload[256];
        serializeJson(doc, payload);
        mqttClient.publish(MQTT_TOPIC, payload);

        Serial.print("Data sent: ");
        Serial.println(payload);
    }
}
```

## 4. Cách Tích hợp vào Dashboard

1. Nạp code trên vào vi điều khiển ESP32 / ESP8266.
2. Cấp nguồn cho mạch ESP.
3. Mạch sẽ kết nối Wi-Fi, kết nối tới Mosquito Broker trên Raspberry Pi 5.
4. Payload JSON sẽ được gửi đi mỗi 2 giây.
5. Mã nguồn Frontend React của Smart Lab (nằm trong `web_app/src/components/sensors/SensorTelemetryWidget.tsx`) sẽ tự động đọc các tham số như `temperature`, `humidity`, `pm25`... từ MQTT Stream và hiển thị chúng dưới dạng UI Badge siêu thực! Không cần bạn phải code thêm ở Frontend (nếu chỉ dùng các cảm biến có sẵn trong danh sách hỗ trợ).
