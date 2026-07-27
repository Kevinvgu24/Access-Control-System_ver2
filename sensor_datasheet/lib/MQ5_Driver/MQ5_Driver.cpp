/**
 * @file MQ5_Driver.cpp
 * @brief Implementation of MQ-5 Gas Sensor Driver for ESP32.
 */

#include "MQ5_Driver.h"
#include <math.h>

MQ5_Sensor::MQ5_Sensor(uint8_t pin, float rl_kOhm, float vc_volts, float dividerRatio)
    : _pin(pin), _rl(rl_kOhm), _vc(vc_volts), _dividerRatio(dividerRatio), _r0(10.0f) {}

void MQ5_Sensor::begin() {
    pinMode(_pin, INPUT);
#if defined(ESP32)
    analogSetAttenuation(ADC_11db); // Full range 0 - 3.3V
#endif
}

float MQ5_Sensor::readVoltage(uint16_t samples) {
    uint32_t rawSum = 0;
    for (uint16_t i = 0; i < samples; i++) {
#if defined(ESP32)
        rawSum += analogReadMilliVolts(_pin);
#else
        rawSum += analogRead(_pin) * (3300 / 1023);
#endif
        delay(2);
    }
    float avgMilliVolts = static_cast<float>(rawSum) / samples;
    float pinVolts = (avgMilliVolts / 1000.0f);
    
    // Scale pin voltage by hardware voltage divider ratio if used
    float sensorVout = pinVolts * _dividerRatio;

    // Constrain Vout below Vc to prevent division by zero or negative resistance
    if (sensorVout >= _vc) {
        sensorVout = _vc - 0.001f;
    }
    if (sensorVout < 0.001f) {
        sensorVout = 0.001f;
    }

    return sensorVout;
}

float MQ5_Sensor::readRs(uint16_t samples) {
    float vout = readVoltage(samples);
    // Rs formula derived from voltage divider: V_RL = Vc * RL / (Rs + RL) => Rs = RL * (Vc - V_RL) / V_RL
    float rs = _rl * (_vc - vout) / vout;
    return rs;
}

float MQ5_Sensor::calibrateR0(uint16_t samples) {
    float rsSum = 0.0f;
    for (uint16_t i = 0; i < samples; i++) {
        rsSum += readRs(1);
        delay(50);
    }
    float avgRsCleanAir = rsSum / samples;
    _r0 = avgRsCleanAir / CLEAN_AIR_RATIO;
    return _r0;
}

void MQ5_Sensor::setR0(float r0_kOhm) {
    if (r0_kOhm > 0.0f) {
        _r0 = r0_kOhm;
    }
}

float MQ5_Sensor::getR0() const {
    return _r0;
}

float MQ5_Sensor::readRatio(uint16_t samples) {
    float rs = readRs(samples);
    return rs / _r0;
}

float MQ5_Sensor::readPPM_LPG() {
    float ratio = readRatio(10);
    if (ratio <= 0.0f) return 0.0f;
    // Formula: PPM = a * (Rs/R0)^b
    return LPG_A * powf(ratio, LPG_B);
}

float MQ5_Sensor::readPPM_Methane() {
    float ratio = readRatio(10);
    if (ratio <= 0.0f) return 0.0f;
    // Formula: PPM = a * (Rs/R0)^b
    return CH4_A * powf(ratio, CH4_B);
}
