/**
 * @file DHT11_Driver.h
 * @brief ESP32 Hardware-level Driver for DHT11 Temperature and Humidity Sensor.
 * @details Implements single-bus 1-wire microsecond timing protocol according to datasheet.
 */

#ifndef DHT11_DRIVER_H
#define DHT11_DRIVER_H

#include <Arduino.h>

class DHT11_Sensor {
public:
    enum Status {
        OK = 0,
        ERROR_TIMEOUT,
        ERROR_CHECKSUM,
        ERROR_TOO_FAST
    };

    /**
     * @brief Constructor
     * @param pin ESP32 GPIO connected to DHT11 DATA line
     */
    explicit DHT11_Sensor(uint8_t pin);

    /**
     * @brief Initialize the sensor pin
     */
    void begin();

    /**
     * @brief Read data from DHT11 sensor
     * @return Status OK (0) if successful, otherwise error code
     */
    Status read();

    /**
     * @brief Get last read temperature in Celsius
     */
    float getTemperature() const;

    /**
     * @brief Get last read relative humidity in percentage (%)
     */
    float getHumidity() const;

    /**
     * @brief Convert status code to human-readable string
     */
    static const char* statusToString(Status status);

private:
    uint8_t _pin;
    float _temperature;
    float _humidity;
    uint32_t _lastReadTime;

    /**
     * @brief Wait for a pin state with timeout (in microseconds)
     */
    bool waitForState(uint8_t state, uint32_t timeoutUs);
};

#endif // DHT11_DRIVER_H
