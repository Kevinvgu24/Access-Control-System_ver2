/**
 * @file main.cpp
 * @brief Integration Example for ESP32 Reading 4 Sensors and Sending Data to Raspberry Pi 5 via MQTT.
 * 
 * Sensors:
 * 1. DHT11 (Digital GPIO 4)
 * 2. MQ-5 (Analog ADC GPIO 34)
 * 3. SHT3x-ARP (Analog RH GPIO 35, Temp GPIO 32)
 * 4. MLX90614 (I2C SDA GPIO 21, SCL GPIO 22)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h> // Arduino MQTT Client Library
#include <ArduinoJson.h>   // For JSON telemetry payload formatting

#include "DHT11_Driver.h"
#include "MQ5_Driver.h"
#include "SHT3x_ARP_Driver.h"
#include "MLX90614_Driver.h"

// --- Wi-Fi & MQTT Configurations ---
const char* WIFI_SSID       = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD   = "YOUR_WIFI_PASSWORD";
const char* MQTT_BROKER_IP  = "192.168.1.100"; // IP address of Raspberry Pi 5 MQTT Broker (Mosquitto)
const int   MQTT_PORT       = 1883;
const char* MQTT_TOPIC     = "esp32/sensors/data";
const char* MQTT_CLIENT_ID = "ESP32_Sensor_Node_1";

// --- Hardware Pin Definitions for ESP32 ---
#define DHT11_PIN        4   // Digital pin for DHT11 DATA
#define MQ5_ADC_PIN      34  // ADC pin for MQ-5 Analog Out
#define SHT3X_RH_PIN     35  // ADC pin for SHT3x-ARP Humidity
#define SHT3X_TEMP_PIN   32  // ADC pin for SHT3x-ARP Temperature
#define MLX_SDA_PIN      21  // I2C SDA
#define MLX_SCL_PIN      22  // I2C SCL

// --- Sensor Instances ---
DHT11_Sensor      dht11(DHT11_PIN);
MQ5_Sensor        mq5(MQ5_ADC_PIN, 4.7f, 5.0f, 1.0f); // RL = 4.7k, Vc = 5.0V
SHT3x_ARP_Sensor  sht3x(SHT3X_RH_PIN, SHT3X_TEMP_PIN, 3.3f, 1.0f); // VDD = 3.3V
MLX90614_Sensor   mlx90614(MLX90614_Sensor::DEFAULT_I2C_ADDR);

// --- Network Instances ---
WiFiClient espClient;
PubSubClient mqttClient(espClient);

unsigned long lastPublishTime = 0;
const unsigned long PUBLISH_INTERVAL_MS = 5000; // Send data every 5 seconds

void setupWiFi() {
    Serial.print("Connecting to Wi-Fi: ");
    Serial.println(WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nWi-Fi Connected!");
    Serial.print("ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
}

void reconnectMQTT() {
    while (!mqttClient.connected()) {
        Serial.print("Attempting MQTT connection to ");
        Serial.print(MQTT_BROKER_IP);
        Serial.print("...");

        if (mqttClient.connect(MQTT_CLIENT_ID)) {
            Serial.println(" Connected to MQTT Broker!");
        } else {
            Serial.print(" Failed, rc=");
            Serial.print(mqttClient.state());
            Serial.println(" Retrying in 5 seconds...");
            delay(5000);
        }
    }
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n========================================");
    Serial.println("  ESP32 Multi-Sensor Telemetry Node     ");
    Serial.println("========================================");

    // Initialize Sensor Drivers
    dht11.begin();
    mq5.begin();
    sht3x.begin();
    
    if (mlx90614.begin(MLX_SDA_PIN, MLX_SCL_PIN)) {
        Serial.println("[OK] MLX90614 IR Sensor initialized.");
    } else {
        Serial.println("[WARN] MLX90614 not detected on I2C bus!");
    }

    // Calibrate MQ-5 R0 in clean air during startup
    Serial.println("Calibrating MQ-5 sensor R0 in clean air...");
    float r0 = mq5.calibrateR0(30);
    Serial.print("MQ-5 Calibrated R0: ");
    Serial.print(r0);
    Serial.println(" kOhms");

    // Setup Network
    setupWiFi();
    mqttClient.setServer(MQTT_BROKER_IP, MQTT_PORT);
}

void loop() {
    if (!mqttClient.connected()) {
        reconnectMQTT();
    }
    mqttClient.loop();

    unsigned long now = millis();
    if (now - lastPublishTime >= PUBLISH_INTERVAL_MS) {
        lastPublishTime = now;

        // 1. Read DHT11
        float dhtTemp = 0.0f, dhtHum = 0.0f;
        DHT11_Sensor::Status dhtStatus = dht11.read();
        if (dhtStatus == DHT11_Sensor::OK) {
            dhtTemp = dht11.getTemperature();
            dhtHum = dht11.getHumidity();
        } else {
            Serial.print("[DHT11 Read Warning] ");
            Serial.println(DHT11_Sensor::statusToString(dhtStatus));
        }

        // 2. Read MQ-5
        float mq5_lpg_ppm = mq5.readPPM_LPG();
        float mq5_ch4_ppm = mq5.readPPM_Methane();

        // 3. Read SHT3x-ARP
        float shtTempC = sht3x.readTemperatureC(10);
        float shtHumidity = sht3x.readHumidity(10);

        // 4. Read MLX90614 IR Thermometer
        float mlxAmbientC = mlx90614.readAmbientTempC();
        float mlxObjectC  = mlx90614.readObjectTempC();

        // Build JSON Telemetry Payload
        StaticJsonDocument<512> doc;
        doc["node_id"] = MQTT_CLIENT_ID;
        doc["uptime_ms"] = now;

        JsonObject dhtData = doc.createNestedObject("dht11");
        dhtData["temperature_c"] = dhtTemp;
        dhtData["humidity_pct"]  = dhtHum;

        JsonObject mq5Data = doc.createNestedObject("mq5");
        mq5Data["lpg_ppm"]     = mq5_lpg_ppm;
        mq5Data["methane_ppm"] = mq5_ch4_ppm;

        JsonObject shtData = doc.createNestedObject("sht3x_arp");
        shtData["temperature_c"] = shtTempC;
        shtData["humidity_pct"]  = shtHumidity;

        JsonObject mlxData = doc.createNestedObject("mlx90614");
        mlxData["ambient_c"] = isnan(mlxAmbientC) ? 0.0 : mlxAmbientC;
        mlxData["object_c"]  = isnan(mlxObjectC)  ? 0.0 : mlxObjectC;

        char payloadBuffer[512];
        serializeJson(doc, payloadBuffer);

        // Publish to MQTT Broker on Raspberry Pi 5
        Serial.print("Publishing to MQTT topic [");
        Serial.print(MQTT_TOPIC);
        Serial.println("]:");
        Serial.println(payloadBuffer);

        mqttClient.publish(MQTT_TOPIC, payloadBuffer);
    }
}
