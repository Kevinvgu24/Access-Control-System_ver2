/**
 * ====================================================================================
 * PROJECT: Smart Door Access Control & IoT Telemetry System
 * HARDWARE: ESP32 Subnode (ESP32-WROOM-32 / ESP32-S3)
 * TARGET BROKER: Raspberry Pi 5 Server (Mosquitto MQTT Broker on Port 1883)
 *
 * DESCRIPTION:
 * Standard boilerplate firmware template for ESP32 developers.
 * Demonstrates plug-and-play dynamic sensor registration (DHT11, PM2.5 Fine Dust, CO2,
 * Light Lux, GNSS GPS) and automatic telemetry transmission to RPi 5.
 * ====================================================================================
 */

#include <Arduino.h>
#include "esp32_sensor_framework.hpp"

// ------------------------------------------------------------------------------------
// 1. NETWORK & SUBNODE CONFIGURATION
// ------------------------------------------------------------------------------------
const char* WIFI_SSID     = "YOUR_WIFI_SSID";           // Change to your Wi-Fi SSID
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";       // Change to your Wi-Fi Password
const char* RPI5_MQTT_IP  = "192.168.1.100";           // Change to Raspberry Pi 5 IP Address
const int   MQTT_PORT     = 1883;

// Unique identifier for this ESP32 Subnode (e.g., "subnode1", "subnode2", "subnode3")
const char* SUBNODE_ID    = "subnode1";
const char* DEVICE_NAME   = "Subnode 1 - Environment & Air Quality";

// Instantiate the Telemetry Framework
ESP32SubnodeFramework node(SUBNODE_ID, DEVICE_NAME, RPI5_MQTT_IP, MQTT_PORT);

// ------------------------------------------------------------------------------------
// 2. SENSOR PIN DEFINITIONS & HARDWARE SIMULATION HINTS
// ------------------------------------------------------------------------------------
#define DHT_PIN         4       // GPIO4 for DHT11 / DHT22 Sensor
#define SDS011_RX_PIN   16      // GPIO16 (RX2) for Fine Dust Sensor SDS011
#define SDS011_TX_PIN   17      // GPIO17 (TX2) for Fine Dust Sensor SDS011
#define LIGHT_ADC_PIN   34      // GPIO34 for LDR Light Sensor

// Sample timing variables
unsigned long last_sensor_read_ms = 0;
const unsigned long SENSOR_READ_INTERVAL_MS = 2000;

void setup() {
    // Initialize Hardware Serial Monitor
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n=======================================================");
    Serial.println("  ESP32 SUBNODE DYNAMIC TELEMETRY FIRMWARE STARTING");
    Serial.println("=======================================================");

    // --------------------------------------------------------------------------------
    // 3. REGISTER DYNAMIC SENSORS ATTACHED TO THIS ESP32
    // Developer Note: Add, remove, or change sensors below according to deployment!
    // Format: registerSensor(sensor_id, display_name, metric_key, unit, category)
    // --------------------------------------------------------------------------------
    node.registerSensor("dht11_temp", "DHT11 Temperature", "temperature_c", "°C",    "environment");
    node.registerSensor("dht11_hum",  "DHT11 Humidity",    "humidity_pct",  "% RH",  "environment");
    node.registerSensor("sds011_pm25","SDS011 Fine Dust",  "pm25_ugm3",     "µg/m³", "air_quality");
    node.registerSensor("mhz19_co2",  "MH-Z19 CO2 Sensor", "co2_ppm",       "ppm",   "air_quality");
    node.registerSensor("ldr_light",  "LDR Ambient Light", "light_lux",     "Lux",   "environment");

    // Initialize Wi-Fi and MQTT connection to RPi 5
    node.beginWiFi(WIFI_SSID, WIFI_PASSWORD);
}

void loop() {
    // Maintain MQTT Connection & handle heartbeat timers
    node.loop();

    // Read physical sensors every 2 seconds
    if (millis() - last_sensor_read_ms > SENSOR_READ_INTERVAL_MS) {
        last_sensor_read_ms = millis();

        // ----------------------------------------------------------------------------
        // 4. READ PHYSICAL SENSORS & UPDATE METRICS
        // Developer Note: Replace simulated readings below with real sensor library calls!
        // (e.g., dht.readTemperature(), sds.readPM25(), analogRead(LIGHT_ADC_PIN))
        // ----------------------------------------------------------------------------
        float current_temp = 28.5 + (random(-10, 10) / 10.0);
        float current_hum  = 62.0 + (random(-20, 20) / 10.0);
        float current_pm25 = 14.2 + (random(-30, 30) / 10.0);
        float current_co2  = 415.0 + random(0, 35);
        float current_lux  = 350.0 + random(0, 50);

        // Update values in the dynamic framework
        node.updateMetric("temperature_c", current_temp, true);   // true = sensor operating OK
        node.updateMetric("humidity_pct",  current_hum,  true);
        node.updateMetric("pm25_ugm3",     current_pm25, true);
        node.updateMetric("co2_ppm",       current_co2,  true);
        node.updateMetric("light_lux",     current_lux,  true);

        Serial.printf("[Sensors Read] Temp: %.1f°C | Hum: %.1f%% | PM2.5: %.1f µg/m³ | CO2: %.0f ppm\n",
                      current_temp, current_hum, current_pm25, current_co2);
    }
}
