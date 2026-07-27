/**
 * @file DHT11_Driver.cpp
 * @brief Implementation of DHT11 Temperature and Humidity Sensor Driver for ESP32.
 */

#include "DHT11_Driver.h"

DHT11_Sensor::DHT11_Sensor(uint8_t pin)
    : _pin(pin), _temperature(0.0f), _humidity(0.0f), _lastReadTime(0) {}

void DHT11_Sensor::begin() {
    pinMode(_pin, INPUT_PULLUP);
}

DHT11_Sensor::Status DHT11_Sensor::read() {
    // Datasheet recommendation: minimum sampling interval is 1 second
    uint32_t now = millis();
    if (_lastReadTime != 0 && (now - _lastReadTime < 1000)) {
        return ERROR_TOO_FAST;
    }

    uint8_t data[5] = {0, 0, 0, 0, 0};

    // 1. Host sends Start Signal: LOW for >= 18ms
    pinMode(_pin, OUTPUT);
    digitalWrite(_pin, LOW);
    delay(20); // 20 ms pulse

    // Pull HIGH for 20-40us and set to INPUT with pull-up
    digitalWrite(_pin, HIGH);
    delayMicroseconds(30);
    pinMode(_pin, INPUT_PULLUP);

    // Disable interrupts on ESP32 to maintain precise microsecond timing
    portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
    portENTER_CRITICAL(&mux);

    // 2. Sensor Response: LOW ~80us, then HIGH ~80us
    if (!waitForState(LOW, 100)) {
        portEXIT_CRITICAL(&mux);
        return ERROR_TIMEOUT;
    }
    if (!waitForState(HIGH, 100)) {
        portEXIT_CRITICAL(&mux);
        return ERROR_TIMEOUT;
    }
    if (!waitForState(LOW, 100)) {
        portEXIT_CRITICAL(&mux);
        return ERROR_TIMEOUT;
    }

    // 3. Read 40 bits (5 bytes)
    for (int i = 0; i < 40; i++) {
        // Each bit starts with ~50us LOW level
        if (!waitForState(HIGH, 100)) {
            portEXIT_CRITICAL(&mux);
            return ERROR_TIMEOUT;
        }

        // Measure HIGH duration: 26-28us for 0, ~70us for 1
        uint32_t startUs = micros();
        if (!waitForState(LOW, 100)) {
            portEXIT_CRITICAL(&mux);
            return ERROR_TIMEOUT;
        }
        uint32_t highDuration = micros() - startUs;

        // Shift bit into data buffer
        uint8_t byteIdx = i / 8;
        data[byteIdx] <<= 1;
        if (highDuration > 45) { // Midpoint threshold between 28us and 70us
            data[byteIdx] |= 1;
        }
    }

    portEXIT_CRITICAL(&mux);

    // 4. Verify Checksum: data[4] == (data[0] + data[1] + data[2] + data[3]) & 0xFF
    uint8_t checksum = (data[0] + data[1] + data[2] + data[3]) & 0xFF;
    if (data[4] != checksum) {
        return ERROR_CHECKSUM;
    }

    // Update stored values (Integral + Decimal)
    _humidity = static_cast<float>(data[0]) + static_cast<float>(data[1]) * 0.1f;
    _temperature = static_cast<float>(data[2]) + static_cast<float>(data[3]) * 0.1f;
    _lastReadTime = now;

    return OK;
}

float DHT11_Sensor::getTemperature() const {
    return _temperature;
}

float DHT11_Sensor::getHumidity() const {
    return _humidity;
}

bool DHT11_Sensor::waitForState(uint8_t state, uint32_t timeoutUs) {
    uint32_t start = micros();
    while (digitalRead(_pin) != state) {
        if ((micros() - start) > timeoutUs) {
            return false;
        }
    }
    return true;
}

const char* DHT11_Sensor::statusToString(Status status) {
    switch (status) {
        case OK:             return "OK";
        case ERROR_TIMEOUT:  return "Error: Timeout reading pin";
        case ERROR_CHECKSUM: return "Error: Checksum mismatch";
        case ERROR_TOO_FAST: return "Error: Read requested too quickly (<1s)";
        default:             return "Unknown Error";
    }
}
