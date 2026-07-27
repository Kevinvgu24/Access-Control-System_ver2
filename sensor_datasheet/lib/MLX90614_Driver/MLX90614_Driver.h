/**
 * @file MLX90614_Driver.h
 * @brief ESP32 Driver for Melexis MLX90614 Infra Red Thermometer (SMBus / I2C).
 * @details Reads RAM registers for Ambient and Object temperatures with CRC-8 / PEC verification.
 */

#ifndef MLX90614_DRIVER_H
#define MLX90614_DRIVER_H

#include <Arduino.h>
#include <Wire.h>

class MLX90614_Sensor {
public:
    static constexpr uint8_t DEFAULT_I2C_ADDR = 0x5A;

    // RAM Addresses per datasheet section 8.3.4
    enum RAM_Register {
        RAW_IR_CH1   = 0x04,
        RAW_IR_CH2   = 0x05,
        TA_AMBIENT   = 0x06,
        TOBJ1_OBJECT = 0x07,
        TOBJ2_OBJECT = 0x08
    };

    /**
     * @brief Constructor
     * @param addr I2C 7-bit slave address (default 0x5A)
     * @param wirePointer Pointer to TwoWire instance (default &Wire)
     */
    explicit MLX90614_Sensor(uint8_t addr = DEFAULT_I2C_ADDR, TwoWire *wirePointer = &Wire);

    /**
     * @brief Initialize I2C bus
     * @param sdaPin ESP32 SDA GPIO
     * @param sclPin ESP32 SCL GPIO
     * @param frequency I2C clock frequency (default 100kHz per SMBus spec)
     * @return true if device responds at address, false otherwise
     */
    bool begin(int sdaPin = -1, int sclPin = -1, uint32_t frequency = 100000);

    /**
     * @brief Read Ambient (Die) Temperature in °C
     * @return Temperature in °C, or NAN on error
     */
    float readAmbientTempC();

    /**
     * @brief Read Object 1 Temperature in °C
     * @return Temperature in °C, or NAN on error
     */
    float readObjectTempC();

    /**
     * @brief Read Object 2 Temperature in °C (dual-zone sensors)
     * @return Temperature in °C, or NAN on error
     */
    float readObject2TempC();

    /**
     * @brief Read 16-bit register word with PEC validation
     * @param reg RAM or EEPROM register address
     * @param value Output parameter for 16-bit word value
     * @return true if read and PEC validation succeeded, false otherwise
     */
    bool read16(uint8_t reg, uint16_t &value);

    /**
     * @brief Calculate SMBus Packet Error Code (CRC-8)
     * @param data Pointer to data bytes
     * @param len Number of bytes
     * @return CRC-8 PEC byte
     */
    static uint8_t calculatePEC(const uint8_t *data, uint8_t len);

private:
    uint8_t _addr;
    TwoWire *_wire;
};

#endif // MLX90614_DRIVER_H
