/**
 * @file main.cpp (Standalone Local ESP32 Sensor Reader)
 * @brief Simple test firmware to read all 4 sensors connected to ESP32 and output to Serial Monitor.
 * 
 * Hardware Connections:
 * =========================================================================================
 * 1. DHT11 (Temperature & Humidity 1-Wire):
 *    - VCC  -> 3.3V or 5V
 *    - DATA -> GPIO 4 (Pull-up resistor 4.7k-10k to 3.3V)
 *    - GND  -> GND
 * 
 * 2. MQ-5 (Flammable Gas Sensor):
 *    - VCC  -> 5V (Requires 5V for internal heater)
 *    - GND  -> GND
 *    - AOUT -> Resistor Divider (10k / 20k) -> GPIO 34 (ADC1_CH6)
 *      Note: MQ-5 AOUT can reach ~4V. Use voltage divider (AOUT -- 10k -- GPIO34 -- 20k -- GND)
 * 
 * 3. SHT3x-ARP (Analog Temperature & Humidity):
 *    - VDD  -> 3.3V
 *    - VSS  -> GND
 *    - RH   -> GPIO 35 (ADC1_CH7)
 *    - T    -> GPIO 32 (ADC1_CH4)
 * 
 * 4. MLX90614 (Infrared Non-contact Thermometer):
 *    - VDD  -> 3.3V (MLX90614BAA)
 *    - VSS  -> GND
 *    - SDA  -> GPIO 21 (I2C SDA, 4.7k pull-up to 3.3V)
 *    - SCL  -> GPIO 22 (I2C SCL, 4.7k pull-up to 3.3V)
 * =========================================================================================
 */

#include <Arduino.h>
#include "DHT11_Driver.h"
#include "MQ5_Driver.h"
#include "SHT3x_ARP_Driver.h"
#include "MLX90614_Driver.h"

// Pin Definitions
#define DHT11_PIN       4
#define MQ5_ADC_PIN     34
#define SHT3X_RH_PIN    35
#define SHT3X_TEMP_PIN  32
#define MLX_SDA_PIN     21
#define MLX_SCL_PIN     22

// Voltage divider ratio for MQ-5 on 3.3V ESP32 ADC:
// (10k + 20k) / 20k = 1.5 multiplier
const float MQ5_VOLTAGE_DIVIDER_RATIO = 1.5f;

// Sensor Objects
DHT11_Sensor     dht11(DHT11_PIN);
MQ5_Sensor       mq5(MQ5_ADC_PIN, 4.7f, 5.0f, MQ5_VOLTAGE_DIVIDER_RATIO);
SHT3x_ARP_Sensor sht3x(SHT3X_RH_PIN, SHT3X_TEMP_PIN, 3.3f, 1.0f);
MLX90614_Sensor  mlx(MLX90614_Sensor::DEFAULT_I2C_ADDR);

void setup() {
    Serial.begin(115200);
    while (!Serial) delay(10);

    Serial.println();
    Serial.println("=================================================");
    Serial.println("   ESP32 Standalone Sensor Reader & Test Bench  ");
    Serial.println("=================================================");

    // 1. Initialize DHT11
    dht11.begin();
    Serial.println("[Init] DHT11 initialized on GPIO 4");

    // 2. Initialize MQ-5
    mq5.begin();
    Serial.println("[Init] MQ-5 initialized on GPIO 34");
    Serial.println("[Init] Calibrating MQ-5 R0 in clean air (Please wait 3 seconds)...");
    float r0 = mq5.calibrateR0(30);
    Serial.print("       -> MQ-5 Calibrated R0 = ");
    Serial.print(r0);
    Serial.println(" kOhms");

    // 3. Initialize SHT3x-ARP
    sht3x.begin();
    Serial.println("[Init] SHT3x-ARP initialized (RH: GPIO 35, Temp: GPIO 32)");

    // 4. Initialize MLX90614
    if (mlx.begin(MLX_SDA_PIN, MLX_SCL_PIN)) {
        Serial.println("[Init] MLX90614 IR Thermometer connected on I2C (GPIO 21/22)");
    } else {
        Serial.println("[WARN] MLX90614 not detected! Check SDA/SCL wiring & pull-ups.");
    }

    Serial.println("=================================================");
    Serial.println("Starting Sensor Reading Loop...\n");
}

void loop() {
    Serial.println("-------------------------------------------------");
    Serial.print("Uptime: ");
    Serial.print(millis() / 1000);
    Serial.println(" s");

    // ---------------- 1. Read DHT11 ----------------
    DHT11_Sensor::Status dhtStatus = dht11.read();
    if (dhtStatus == DHT11_Sensor::OK) {
        Serial.print("1. [DHT11]     Nhiệt độ: ");
        Serial.print(dht11.getTemperature(), 1);
        Serial.print(" °C | Độ ẩm: ");
        Serial.print(dht11.getHumidity(), 1);
        Serial.println(" %");
    } else {
        Serial.print("1. [DHT11]     Lỗi: ");
        Serial.println(DHT11_Sensor::statusToString(dhtStatus));
    }

    // ---------------- 2. Read MQ-5 ----------------
    float vout = mq5.readVoltage(10);
    float lpg_ppm = mq5.readPPM_LPG();
    float ch4_ppm = mq5.readPPM_Methane();
    Serial.print("2. [MQ-5]      Điện áp: ");
    Serial.print(vout, 2);
    Serial.print(" V | LPG: ");
    Serial.print(lpg_ppm, 1);
    Serial.print(" PPM | Methane: ");
    Serial.print(ch4_ppm, 1);
    Serial.println(" PPM");

    // ---------------- 3. Read SHT3x-ARP ----------------
    float shtTemp = sht3x.readTemperatureC(10);
    float shtHum  = sht3x.readHumidity(10);
    Serial.print("3. [SHT3x-ARP] Nhiệt độ: ");
    Serial.print(shtTemp, 2);
    Serial.print(" °C | Độ ẩm: ");
    Serial.print(shtHum, 2);
    Serial.println(" %");

    // ---------------- 4. Read MLX90614 ----------------
    float ambC = mlx.readAmbientTempC();
    float objC = mlx.readObjectTempC();
    if (!isnan(ambC) && !isnan(objC)) {
        Serial.print("4. [MLX90614]  Nhiệt độ môi trường: ");
        Serial.print(ambC, 2);
        Serial.print(" °C | Nhiệt độ hồng ngoại (Vật thể): ");
        Serial.print(objC, 2);
        Serial.println(" °C");
    } else {
        Serial.println("4. [MLX90614]  Lỗi đọc dữ liệu qua I2C/SMBus (PEC Mismatch / No ACK)");
    }

    Serial.println();
    delay(2000); // Read every 2 seconds
}
