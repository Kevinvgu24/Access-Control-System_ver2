/**
 * @file MLX90614_Driver.cpp
 * @brief Implementation of MLX90614 Infra Red Thermometer Driver for ESP32.
 */

#include "MLX90614_Driver.h"
#include <math.h>

MLX90614_Sensor::MLX90614_Sensor(uint8_t addr, TwoWire *wirePointer)
    : _addr(addr), _wire(wirePointer) {}

bool MLX90614_Sensor::begin(int sdaPin, int sclPin, uint32_t frequency) {
    if (sdaPin >= 0 && sclPin >= 0) {
        _wire->begin(sdaPin, sclPin, frequency);
    } else {
        _wire->begin();
        _wire->setClock(frequency);
    }

    // Ping device to verify connection
    _wire->beginTransmission(_addr);
    return (_wire->endTransmission() == 0);
}

uint8_t MLX90614_Sensor::calculatePEC(const uint8_t *data, uint8_t len) {
    uint8_t crc = 0;
    for (uint8_t i = 0; i < len; i++) {
        uint8_t inbyte = data[i];
        for (uint8_t j = 0; j < 8; j++) {
            uint8_t mix = (crc ^ inbyte) & 0x80;
            crc <<= 1;
            if (mix) {
                crc ^= 0x07; // Polynomial X^8 + X^2 + X^1 + 1
            }
            inbyte <<= 1;
        }
    }
    return crc;
}

bool MLX90614_Sensor::read16(uint8_t reg, uint16_t &value) {
    // 1. Send I2C Start + Slave Address Write (0x5A << 1 | 0) + Register Address
    _wire->beginTransmission(_addr);
    _wire->write(reg);
    if (_wire->endTransmission(false) != 0) { // Keep I2C bus active with repeated start
        return false;
    }

    // 2. Request 3 bytes: DataLow, DataHigh, PEC
    uint8_t bytesReceived = _wire->requestFrom(static_cast<uint8_t>(_addr), static_cast<uint8_t>(3));
    if (bytesReceived < 3) {
        return false;
    }

    uint8_t dataLow = _wire->read();
    uint8_t dataHigh = _wire->read();
    uint8_t pec = _wire->read();

    // 3. Verify Packet Error Code (PEC)
    // PEC is calculated over: [SlaveAddr_Write, Reg, SlaveAddr_Read, DataLow, DataHigh]
    uint8_t pecBuffer[5];
    pecBuffer[0] = (_addr << 1) | 0; // Write Address
    pecBuffer[1] = reg;
    pecBuffer[2] = (_addr << 1) | 1; // Read Address
    pecBuffer[3] = dataLow;
    pecBuffer[4] = dataHigh;

    uint8_t calculatedPec = calculatePEC(pecBuffer, 5);
    if (calculatedPec != pec) {
        return false; // Checksum error
    }

    // Check MSB error flag (bit 15) for temperature RAM registers per datasheet
    if (dataHigh & 0x80) {
        return false; // Sensor error bit set
    }

    value = (static_cast<uint16_t>(dataHigh) << 8) | dataLow;
    return true;
}

float MLX90614_Sensor::readAmbientTempC() {
    uint16_t raw;
    if (!read16(TA_AMBIENT, raw)) {
        return NAN;
    }
    // Datasheet formula: Temp(K) = raw * 0.02 -> Temp(°C) = (raw * 0.02) - 273.15
    float tempC = (static_cast<float>(raw) * 0.02f) - 273.15f;
    return tempC;
}

float MLX90614_Sensor::readObjectTempC() {
    uint16_t raw;
    if (!read16(TOBJ1_OBJECT, raw)) {
        return NAN;
    }
    // Datasheet formula: Temp(K) = raw * 0.02 -> Temp(°C) = (raw * 0.02) - 273.15
    float tempC = (static_cast<float>(raw) * 0.02f) - 273.15f;
    return tempC;
}

float MLX90614_Sensor::readObject2TempC() {
    uint16_t raw;
    if (!read16(TOBJ2_OBJECT, raw)) {
        return NAN;
    }
    float tempC = (static_cast<float>(raw) * 0.02f) - 273.15f;
    return tempC;
}
