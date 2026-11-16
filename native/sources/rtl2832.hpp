#pragma once

#include "r820_tuner.hpp"

namespace cospas {

inline constexpr std::uint32_t rtl_sample_rate_hz = 921600;

class Rtl2832 {
public:
    explicit Rtl2832(RtlUsbRegisters& registers, bool blog_v4 = false);
    Rtl2832(const Rtl2832&) = delete;
    Rtl2832& operator=(const Rtl2832&) = delete;
    void initialize(std::uint32_t frequency_hz);
    void reset_buffer();
    static std::int32_t dsp_offset_hz() noexcept;
    const R820TunerStatus& status() const;
private:
    void write(std::uint8_t block, std::uint16_t address, std::uint16_t value, std::uint8_t width = 1);
    void demod(std::uint8_t page, std::uint8_t address, std::uint16_t value, std::uint8_t width = 1);
    void baseband();
    void set_intermediate_frequency(std::uint32_t frequency_hz);
    void disable_bias_tee();
    RtlUsbRegisters& registers_;
    std::optional<R820Tuner> tuner_;
    bool blog_v4_{};
    bool initialized_{};
};

}
