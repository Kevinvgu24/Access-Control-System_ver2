/**
 * @file MQ5_Driver.h
 * @brief ESP32 Driver for MQ-5 Semiconductor Flammable Gas Sensor (LPG, Methane/CH4, Propane).
 * @details Reads analog voltage, calculates Rs/R0 ratio, and calculates gas concentrations in PPM.
 */

#ifndef MQ5_DRIVER_H
#define MQ5_DRIVER_H

#include <Arduino.h>

class MQ5_Sensor {
public:
    /**
     * @brief Constructor
     * @param pin ESP32 Analog ADC pin connected to MQ-5 AOUT
     * @param rl_kOhm Load resistance RL on module in kOhms (default 4.7 kOhm)
     * @param vc_volts Supply voltage Vc to MQ-5 (default 5.0 Volts)
     * @param dividerRatio Voltage divider ratio if resistor divider is used on ADC pin (default 1.0)
     */
    MQ5_Sensor(uint8_t pin, float rl_kOhm = 4.7f, float vc_volts = 5.0f, float dividerRatio = 1.0f);

    /**
     * @brief Initialize ADC pin
     */
    void begin();

    /**
     * @brief Calibrate R0 in clean air (averages multiple readings)
     * @param samples Number of ADC samples to average (default 50)
     * @return Calculated R0 in kOhms
     */
    float calibrateR0(uint16_t samples = 50);

    /**
     * @brief Set R0 manually if pre-calibrated
     * @param r0_kOhm R0 value in kOhms
     */
    void setR0(float r0_kOhm);

    /**
     * @brief Get current R0 value
     */
    float getR0() const;

    /**
     * @brief Read raw ADC voltage output V_RL in Volts
     * @param samples Number of samples to average (default 10)
     * @return Voltage in Volts
     */
    float readVoltage(uint16_t samples = 10);

    /**
     * @brief Read current sensor resistance Rs in kOhms
     * @param samples Number of samples to average (default 10)
     * @return Rs in kOhms
     */
    float readRs(uint16_t samples = 10);

    /**
     * @brief Read current Rs/R0 ratio
     * @param samples Number of samples to average (default 10)
     * @return Ratio Rs/R0
     */
    float readRatio(uint16_t samples = 10);

    /**
     * @brief Calculate LPG / Propane concentration in PPM
     * @return Concentration in PPM
     */
    float readPPM_LPG();

    /**
     * @brief Calculate Methane (CH4) concentration in PPM
     * @return Concentration in PPM
     */
    float readPPM_Methane();

private:
    uint8_t _pin;
    float _rl;
    float _vc;
    float _dividerRatio;
    float _r0;

    static constexpr float CLEAN_AIR_RATIO = 6.5f; // Rs/R0 in clean air per datasheet

    // Log-log curve constants: PPM = a * (Rs/R0)^b
    static constexpr float LPG_A = 1163.8f;
    static constexpr float LPG_B = -2.162f;

    static constexpr float CH4_A = 2163.5f;
    static constexpr float CH4_B = -2.480f;
};

#endif // MQ5_DRIVER_H
