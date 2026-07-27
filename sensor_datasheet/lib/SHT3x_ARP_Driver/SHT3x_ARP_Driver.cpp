/**
 * @file SHT3x_ARP_Driver.cpp
 * @brief Implementation of Sensirion SHT3x-ARP Analog Sensor Driver for ESP32.
 */

#include "SHT3x_ARP_Driver.h"

SHT3x_ARP_Sensor::SHT3x_ARP_Sensor(uint8_t pinRH, uint8_t pinT, float vdd_volts, float dividerRatio)
    : _pinRH(pinRH), _pinT(pinT), _vdd(vdd_volts), _dividerRatio(dividerRatio) {}

void SHT3x_ARP_Sensor::begin() {
    pinMode(_pinRH, INPUT);
    pinMode(_pinT, INPUT);
#if defined(ESP32)
    analogSetAttenuation(ADC_11db); // Full range 0 - 3.3V
#endif
}

float SHT3x_ARP_Sensor::readPinVoltage(uint8_t pin, uint16_t samples) {
    uint32_t rawSum = 0;
    for (uint16_t i = 0; i < samples; i++) {
#if defined(ESP32)
        rawSum += analogReadMilliVolts(pin);
#else
        rawSum += analogRead(pin) * (3300 / 1023);
#endif
        delay(2);
    }
    float avgMilliVolts = static_cast<float>(rawSum) / samples;
    float measuredVolts = (avgMilliVolts / 1000.0f) * _dividerRatio;
    return measuredVolts;
}

void SHT3x_ARP_Sensor::readVoltages(float &vrh_out, float &vt_out, uint16_t samples) {
    vrh_out = readPinVoltage(_pinRH, samples);
    vt_out = readPinVoltage(_pinT, samples);
}

float SHT3x_ARP_Sensor::readHumidity(uint16_t samples) {
    float vrh = readPinVoltage(_pinRH, samples);
    // Datasheet Equation 1: RH(%) = -12.5 + 125 * (VRH / VDD)
    float rh = -12.5f + 125.0f * (vrh / _vdd);

    // Constrain RH to valid percentage range [0.0%, 100.0%]
    if (rh < 0.0f) rh = 0.0f;
    if (rh > 100.0f) rh = 100.0f;

    return rh;
}

float SHT3x_ARP_Sensor::readTemperatureC(uint16_t samples) {
    float vt = readPinVoltage(_pinT, samples);
    // Datasheet Equation 2 (°C): T(°C) = -66.875 + 218.75 * (VT / VDD)
    float tempC = -66.875f + 218.75f * (vt / _vdd);
    return tempC;
}

float SHT3x_ARP_Sensor::readTemperatureF(uint16_t samples) {
    float vt = readPinVoltage(_pinT, samples);
    // Datasheet Equation 2 (°F): T(°F) = -88.375 + 393.75 * (VT / VDD)
    float tempF = -88.375f + 393.75f * (vt / _vdd);
    return tempF;
}
