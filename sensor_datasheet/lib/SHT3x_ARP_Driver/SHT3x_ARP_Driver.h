/**
 * @file SHT3x_ARP_Driver.h
 * @brief ESP32 Driver for Sensirion SHT3x-ARP Analog Ratiometric Humidity & Temperature Sensor.
 * @details Converts analog output voltages VRH and VT using ratiometric formulas specified in datasheet.
 */

#ifndef SHT3X_ARP_DRIVER_H
#define SHT3X_ARP_DRIVER_H

#include <Arduino.h>

class SHT3x_ARP_Sensor {
public:
    /**
     * @brief Constructor
     * @param pinRH ESP32 Analog ADC pin connected to SHT3x-ARP RH pin (Pin 1)
     * @param pinT ESP32 Analog ADC pin connected to SHT3x-ARP T pin (Pin 4)
     * @param vdd_volts Sensor supply voltage VDD in Volts (e.g. 3.3V or 5.0V)
     * @param dividerRatio Voltage divider scaling ratio if external divider is used (default 1.0)
     */
    SHT3x_ARP_Sensor(uint8_t pinRH, uint8_t pinT, float vdd_volts = 3.3f, float dividerRatio = 1.0f);

    /**
     * @brief Initialize ADC pins
     */
    void begin();

    /**
     * @brief Read Relative Humidity in %RH
     * @param samples Number of ADC samples to average (default 10)
     * @return Humidity in %RH (constrained 0-100%)
     */
    float readHumidity(uint16_t samples = 10);

    /**
     * @brief Read Temperature in degrees Celsius (°C)
     * @param samples Number of ADC samples to average (default 10)
     * @return Temperature in °C
     */
    float readTemperatureC(uint16_t samples = 10);

    /**
     * @brief Read Temperature in degrees Fahrenheit (°F)
     * @param samples Number of ADC samples to average (default 10)
     * @return Temperature in °F
     */
    float readTemperatureF(uint16_t samples = 10);

    /**
     * @brief Read raw analog voltages VRH and VT
     * @param vrh_out Output parameter for VRH voltage in Volts
     * @param vt_out Output parameter for VT voltage in Volts
     * @param samples Number of ADC samples to average
     */
    void readVoltages(float &vrh_out, float &vt_out, uint16_t samples = 10);

private:
    uint8_t _pinRH;
    uint8_t _pinT;
    float _vdd;
    float _dividerRatio;

    /**
     * @brief Read averaged voltage from specified ADC pin
     */
    float readPinVoltage(uint8_t pin, uint16_t samples);
};

#endif // SHT3X_ARP_DRIVER_H
