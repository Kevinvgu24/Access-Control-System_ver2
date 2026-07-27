# 🛠️ ESP32 Dynamic Subnode Firmware & Developer Guide

Welcome to the **ESP32 Dynamic Sensor Subnode Framework** for the Smart Door Access Control & IoT Telemetry System.

This framework allows developers to program any ESP32 board (ESP32-WROOM, ESP32-S3, ESP32-CAM, etc.) with **any dynamic combination of sensors** (DHT11/22, Fine Dust PM2.5/PM10, CO2, Light Lux, GNSS GPS, MQ2/MQ135 Gas, etc.) and automatically connect to the **Raspberry Pi 5 Server** via MQTT.

---

## 📁 Repository Structure

- `firmware/esp32_sensor_framework.hpp`: C++ Header framework handling Wi-Fi, MQTT reconnects, Manifest declarations, and dynamic JSON telemetry serialization.
- `firmware/esp32_subnode_template.ino`: Ready-to-use Arduino IDE / PlatformIO sketch boilerplate.

---

## ⚙️ Hardware & Software Requirements

### Required Libraries (Arduino IDE Library Manager)
1. **PubSubClient** by Nick O'Leary (v2.8.0+) - MQTT Protocol
2. **ArduinoJson** by Benoit Blanchon (v6.21.0+) - JSON Parsing & Serialization
3. **WiFi** (Built-in for ESP32)

---

## 🚀 Quick Start Guide

### Step 1: Open Template Sketch
Open `firmware/esp32_subnode_template.ino` in Arduino IDE or VS Code PlatformIO.

### Step 2: Configure Wi-Fi & Raspberry Pi 5 IP
Edit lines 18-20 in `esp32_subnode_template.ino`:
```cpp
const char* WIFI_SSID     = "YOUR_WIFI_SSID";       // Your local Wi-Fi SSID
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";   // Your local Wi-Fi Password
const char* RPI5_MQTT_IP  = "192.168.1.100";       // Raspberry Pi 5 IP Address
```

### Step 3: Define Subnode ID & Register Sensors
Assign a unique `SUBNODE_ID` (e.g. `subnode1`, `subnode2`, `subnode3`):
```cpp
const char* SUBNODE_ID    = "subnode1";
const char* DEVICE_NAME   = "Subnode 1 - Environment & Air Quality";
```

Register any dynamic sensors attached to your ESP32 in `setup()`:
```cpp
// Format: node.registerSensor(sensor_id, display_name, metric_key, unit, category);
node.registerSensor("dht11_temp", "DHT11 Temperature", "temperature_c", "°C",    "environment");
node.registerSensor("dht11_hum",  "DHT11 Humidity",    "humidity_pct",  "% RH",  "environment");
node.registerSensor("sds011_pm25","SDS011 Fine Dust",  "pm25_ugm3",     "µg/m³", "air_quality");
node.registerSensor("mhz19_co2",  "MH-Z19 CO2 Sensor", "co2_ppm",       "ppm",   "air_quality");
node.registerSensor("ldr_light",  "LDR Ambient Light", "light_lux",     "Lux",   "environment");
```

### Step 4: Update Metrics in `loop()`
Read your physical sensors and update the values:
```cpp
node.updateMetric("temperature_c", current_temp, true);   // true = sensor operating OK
node.updateMetric("humidity_pct",  current_hum,  true);
node.updateMetric("pm25_ugm3",     current_pm25, true);
```

### Step 5: Flash & Verify
Flash the ESP32 board and open the Serial Monitor at **115200 Baud**.
You should see:
```text
[ESP32 Subnode] Connecting to WiFi.....
[ESP32 Subnode] WiFi Connected! IP: 192.168.1.105
[ESP32 Subnode] Attempting MQTT connection to RPi 5...CONNECTED!
[ESP32 Subnode] Published Manifest Schema to RPi 5
[ESP32 Subnode] Published Telemetry Payload: {"node_id":"subnode1","status_ok":true,...}
```

---

## 📡 MQTT Topic Specification

| Topic Pattern | Direction | Description |
|---|---|---|
| `smartdoor/subnodes/<subnode_id>/manifest` | ESP32 ➔ RPi 5 | Published once on boot/reconnect. Declares dynamic sensor schema. |
| `smartdoor/subnodes/<subnode_id>/telemetry` | ESP32 ➔ RPi 5 | Published periodically (every 2.5s). Pushes metric readings & health status. |

---

## 🟢 Automatic Web App UI Integration
Once flashed, the Raspberry Pi 5 server will automatically detect the subnode, register its dynamic schema, and render live metrics and health status cards on the **System Dashboard** (`/system`) without requiring any Web App code edits!
