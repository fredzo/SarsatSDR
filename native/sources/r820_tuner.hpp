#pragma once

#include "rtl_usb.hpp"

namespace cospas {

struct R820TunerStatus {
    bool initialized{};
    std::uint8_t filter_code{};
    std::uint8_t i2c_address{};
    std::uint32_t intermediate_frequency_hz{3570000};
    std::optional<double> actual_frequency_hz;
};

class R820Tuner {
public:
    explicit R820Tuner(RtlUsbRegisters& registers, bool blog_v4 = false);
    R820Tuner(const R820Tuner&) = delete;
    R820Tuner& operator=(const R820Tuner&) = delete;
    void initialize();
    std::uint32_t set_bandwidth(std::uint32_t bandwidth_hz);
    double tune(std::uint32_t frequency_hz);
    const R820TunerStatus& status() const noexcept;
private:
    void write(std::uint8_t address, std::uint8_t value);
    void masked(std::uint8_t address, std::uint8_t value, std::uint8_t mask);
    void standard();
    std::uint8_t calibrate();
    void select_frontend(std::uint32_t lo_hz);
    double pll(std::uint32_t lo_hz);
    RtlUsbRegisters& registers_;
    R820TunerStatus status_;
    bool blog_v4_{};
    std::uint8_t rf_input_{};
};

}
