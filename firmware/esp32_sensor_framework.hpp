/**
 * ESP32 Plug-and-Play Dynamic Sensor Telemetry Framework
 * Language: C++ (Arduino IDE / PlatformIO / ESP-IDF)
 *
 * Description:
 * Allows any ESP32 Subnode to dynamically declare its attached sensors
 * (DHT11, PM2.5 Fine Dust, CO2, GPS LC76G, Light Lux, etc.) and transmit
 * auto-describing telemetry JSON payloads to Raspberry Pi 5 via MQTT.
 */

#ifndef ESP32_SENSOR_FRAMEWORK_HPP
#define ESP32_SENSOR_FRAMEWORK_HPP

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

struct SensorMetric {
    String id;          // e.g. "dht11_temp"
    String name;        // e.g. "DHT11 Temperature Sensor"
    String key;         // e.g. "temperature_c"
    String unit;        // e.g. "°C"
    String category;    // e.g. "environment", "air_quality", "gnss"
    float value;        // Current reading
    bool is_valid;      // Health status
};

class ESP32SubnodeFramework {
private:
    String subnode_id;
    String device_name;
    String mqtt_broker;
    int mqtt_port;
    
    WiFiClient espClient;
    PubSubClient mqttClient;
    
    std::vector<SensorMetric> registered_sensors;
    unsigned long last_telemetry_ms;
    unsigned long telemetry_interval_ms;

public:
    ESP32SubnodeFramework(const char* id, const char* name, const char* broker_ip, int port = 1883)
        : subnode_id(id), device_name(name), mqtt_broker(broker_ip), mqtt_port(port),
          mqttClient(espClient), last_telemetry_ms(0), telemetry_interval_ms(2500) {}

    void registerSensor(const String& id, const String& name, const String& key, const String& unit, const String& category) {
        SensorMetric sensor;
        sensor.id = id;
        sensor.name = name;
        sensor.key = key;
        sensor.unit = unit;
        sensor.category = category;
        sensor.value = 0.0;
        sensor.is_valid = true;
        registered_sensors.push_back(sensor);
    }

    void updateMetric(const String& key, float value, bool isValid = true) {
        for (auto& sensor : registered_sensors) {
            if (sensor.key == key) {
                sensor.value = value;
                sensor.is_valid = isValid;
                break;
            }
        }
    }

    void beginWiFi(const char* ssid, const char* password) {
        WiFi.mode(WIFI_STA);
        WiFi.begin(ssid, password);
        Serial.print("[ESP32 Subnode] Connecting to WiFi");
        while (WiFi.status() != WL_CONNECTED) {
            delay(500);
            Serial.print(".");
        }
        Serial.println("\n[ESP32 Subnode] WiFi Connected! IP: " + WiFi.localIP().toString());
        
        mqttClient.setServer(mqtt_broker.c_str(), mqtt_port);
    }

    void publishManifest() {
        if (!mqttClient.connected()) return;
        
        StaticJsonDocument<1024> doc;
        doc["node_id"] = subnode_id;
        doc["device_name"] = device_name;
        doc["fw_version"] = "2.1.0";
        doc["ip_address"] = WiFi.localIP().toString();

        JsonArray capabilities = doc.createNestedArray("capabilities");
        for (const auto& sensor : registered_sensors) {
            JsonObject cap = capabilities.createNestedObject();
            cap["id"] = sensor.id;
            cap["name"] = sensor.name;
            cap["metric_key"] = sensor.key;
            cap["unit"] = sensor.unit;
            cap["category"] = sensor.category;
        }

        String output;
        serializeJson(doc, output);
        String topic = "smartdoor/subnodes/" + subnode_id + "/manifest";
        mqttClient.publish(topic.c_str(), output.c_str(), true);
        Serial.println("[ESP32 Subnode] Published Manifest Schema to RPi 5: " + output);
    }

    void publishTelemetry() {
        if (!mqttClient.connected()) return;

        StaticJsonDocument<1024> doc;
        doc["node_id"] = subnode_id;
        doc["device_name"] = device_name;
        doc["status_ok"] = true;

        JsonObject metrics = doc.createNestedObject("metrics");
        JsonObject status = doc.createNestedObject("sensor_status");

        for (const auto& sensor : registered_sensors) {
            metrics[sensor.key] = sensor.value;
            status[sensor.id] = sensor.is_valid ? "OK" : "FAULT";
            if (!sensor.is_valid) {
                doc["status_ok"] = false;
                doc["error_msg"] = "Sensor " + sensor.name + " reported fault";
            }
        }

        String output;
        serializeJson(doc, output);
        String topic = "smartdoor/subnodes/" + subnode_id + "/telemetry";
        mqttClient.publish(topic.c_str(), output.c_str());
        Serial.println("[ESP32 Subnode] Published Telemetry Payload: " + output);
    }

    void loop() {
        if (!mqttClient.connected()) {
            reconnectMQTT();
        }
        mqttClient.loop();

        if (millis() - last_telemetry_ms > telemetry_interval_ms) {
            last_telemetry_ms = millis();
            publishTelemetry();
        }
    }

private:
    void reconnectMQTT() {
        while (!mqttClient.connected()) {
            Serial.print("[ESP32 Subnode] Attempting MQTT connection to RPi 5...");
            String clientId = "ESP32Subnode-" + subnode_id;
            if (mqttClient.connect(clientId.c_str())) {
                Serial.println("CONNECTED!");
                publishManifest();
            } else {
                Serial.print("failed, rc=");
                Serial.print(mqttClient.state());
                Serial.println(" try again in 5 seconds");
                delay(5000);
            }
        }
    }
};

#endif // ESP32_SENSOR_FRAMEWORK_HPP
