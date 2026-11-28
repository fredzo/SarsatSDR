/*
 * SarsatSDR
 * Copyright (C) 2026 Frederic BORRY - F4JRX
 * Authors: Frederic BORRY - F4JRX and Copilot (AI-assisted development).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

#include "r820_tuner.hpp"
#include "dsp_tables.hpp"

#include <libusb.h>

#include <chrono>
#include <limits>
#include <stdexcept>
#include <string>
#include <thread>

namespace cospas {
namespace {

constexpr std::uint32_t crystal_hz = 28800000;
constexpr std::uint32_t crystal_khz = (crystal_hz + 500) / 1000;

std::string usb_error(int status, const char* operation) {
    return std::string(operation) + ": " + libusb_error_name(status) + " (code " + std::to_string(status) + ")";
}

void check(int status, const char* operation) {
    if (status != 0) throw std::runtime_error(usb_error(status, operation));
}

template<class Action>
void with_repeater(RtlUsbRegisters& registers, Action action) {
    const int opened = registers.set_i2c_repeater(true);
    try {
        check(opened, "Enabling R820 I2C repeater");
        action();
    } catch (const std::exception& error) {
        const int closed = registers.set_i2c_repeater(false);
        if (closed != 0)
            throw std::runtime_error(std::string(error.what()) + "; " + usb_error(closed, "Closing R820 I2C repeater"));
        throw;
    }
    check(registers.set_i2c_repeater(false), "Closing R820 I2C repeater");
}

struct PllPlan {
    std::uint32_t mix_div{}, div_num{}, integer{}, remainder_khz{}, sdm{};
};

PllPlan plan(std::uint32_t lo_hz) {
    PllPlan result;
    for (std::uint32_t div = 2, number = 0; div <= 64; div *= 2, ++number) {
        const auto vco_khz = std::uint64_t(lo_hz / 1000) * div;
        if (vco_khz >= 1770000 && vco_khz < 3540000) {
            result.mix_div = div;
            result.div_num = number;
            break;
        }
    }
    if (result.mix_div == 0) throw std::invalid_argument("Frequency outside R820 PLL VCO range");
    const auto vco_hz = std::uint64_t(lo_hz) * result.mix_div;
    result.integer = static_cast<std::uint32_t>(vco_hz / (2 * crystal_hz));
    if (result.integer < 13 || result.integer > 63)
        throw std::invalid_argument("No valid R820 PLL integer divider");
    result.remainder_khz = static_cast<std::uint32_t>((vco_hz - 2ULL * crystal_hz * result.integer) / 1000);
    auto remainder = result.remainder_khz;
    for (std::uint32_t denominator = 2; remainder > 1 && denominator <= 32768; denominator *= 2) {
        const auto scaled = std::uint64_t(remainder) * denominator;
        if (scaled > 2 * crystal_khz) {
            result.sdm += 65536 / denominator;
            remainder = static_cast<std::uint32_t>((scaled - 2 * crystal_khz) / denominator);
            if (denominator == 32768) break;
        }
    }
    return result;
}

}

R820Tuner::R820Tuner(RtlUsbRegisters& registers, bool blog_v4) : registers_(registers), blog_v4_(blog_v4) {
    if (blog_v4 && registers_.tuner_address_ != 0x74)
        throw std::invalid_argument("RTL-SDR Blog V4 requires an R828D tuner at I2C address 0x74");
}

void R820Tuner::write(std::uint8_t address, std::uint8_t value) {
    check(registers_.write_tuner_register(address, value), "Writing R820 tuner register");
}

void R820Tuner::masked(std::uint8_t address, std::uint8_t value, std::uint8_t mask) {
    std::uint8_t cached{};
    check(registers_.read_cached_tuner_register(address, cached), "Reading R820 register image");
    write(address, static_cast<std::uint8_t>((cached & ~mask) | (value & mask)));
}

void R820Tuner::standard() {
    masked(0x1d, 0xe5, 0xc7);
    masked(0x1c, 0x24, 0xf8);
    write(0x0d, 0x53);
    write(0x0e, 0x75);
    masked(0x05, 0x00, 0x60);
    masked(0x06, 0x00, 0x08);
    masked(0x11, 0x38, 0x38);
    masked(0x17, 0xa0, 0x30);
    masked(0x0a, 0x40, 0x60);
    masked(0x1d, 0x00, 0x38);
    masked(0x1c, 0x00, 0x04);
    masked(0x06, 0x00, 0x40);
    masked(0x1a, 0x30, 0x30);
    masked(0x1d, 0x18, 0x38);
    masked(0x1c, 0x24, 0x04);
    masked(0x1e, 0x0e, 0x1f);
    masked(0x1a, 0x20, 0x30);
}

std::uint8_t R820Tuner::calibrate() {
    // Restore the desired image here without rewriting it to hardware.
    registers_.cache_ = dsp_tables::r820_initial_registers;
    registers_.cached_.fill(true);
    masked(0x0c, 0x00, 0x0f);
    masked(0x13, 0x31, 0x3f);
    masked(0x1d, 0x00, 0x38);
    std::uint8_t code = 15;
    for (int attempt = 0; attempt < 2; ++attempt) {
        masked(0x0b, 0x6b, 0x3c);
        masked(0x0f, 0x04, 0x04);
        masked(0x10, 0x00, 0x03);
        pll(56000000);
        masked(0x0b, 0x10, 0x10);
        masked(0x0b, 0x00, 0x10);
        masked(0x0f, 0x00, 0x04);
        std::array<std::uint8_t, 5> status{};
        check(registers_.read_tuner_registers(0, status), "Reading R820 filter calibration");
        code = status[4] & 15;
        if (code != 15) break;
    }
    if (code == 15) throw std::runtime_error("R820 filter calibration failed twice (code 15)");
    masked(0x0a, std::uint8_t(code | 0x10), 0x1f);
    masked(0x0b, 0x6b, 0xef);
    masked(0x07, 0x00, 0x80);
    masked(0x06, 0x10, 0x30);
    masked(0x1e, 0x60, 0x60);
    masked(0x05, 0x01, 0x80);
    masked(0x19, 0x60, 0x60);
    return code;
}

void R820Tuner::initialize() {
    status_ = {};
    status_.i2c_address = registers_.tuner_address_;
    rf_input_ = 0;
    registers_.invalidate_tuner_cache();
    std::uint8_t code{};
    try {
        with_repeater(registers_, [&] {
            check(registers_.write_tuner_registers(5, dsp_tables::r820_initial_registers),
                  "Writing initial R820 register image");
            standard();
            code = calibrate();
            standard();
        });
    } catch (const std::exception&) {
        registers_.invalidate_tuner_cache();
        throw;
    }
    status_.filter_code = code;
    status_.initialized = true;
}

void R820Tuner::select_frontend(std::uint32_t lo_hz) {
    const auto mhz = lo_hz / 1000000;
    const auto& ranges = dsp_tables::r820_frequency_ranges;
    std::size_t selected = 0;
    while (selected + 1 < ranges.size() && mhz >= ranges[selected + 1][0]) ++selected;
    const auto& range = ranges[selected];
    masked(0x17, blog_v4_ ? 0 : static_cast<std::uint8_t>(range[1]), 0x08);
    masked(0x1a, static_cast<std::uint8_t>(range[2]), 0xc3);
    write(0x1b, static_cast<std::uint8_t>(range[3]));
    masked(0x10, static_cast<std::uint8_t>(range[6]), 0x0b);
    masked(0x08, 0x00, 0x3f);
    masked(0x09, 0x00, 0x3f);
}

std::uint32_t R820Tuner::set_bandwidth(std::uint32_t bandwidth_hz) {
    if (!status_.initialized) throw std::logic_error("R820 tuner must be initialized before setting bandwidth");
    if (bandwidth_hz == 0) throw std::invalid_argument("R820 bandwidth must be positive");
    std::uint8_t high = 0x10, low = 0x0b;
    std::uint32_t intermediate = 4570000;
    if (bandwidth_hz <= 7000000) {
        low = 0x2a;
        if (bandwidth_hz <= 6000000) {
            intermediate = 3570000;
            low = 0x6b;
            const auto& widths = dsp_tables::r820_bandwidths;
            const auto widest = static_cast<std::uint32_t>(widths.front());
            if (bandwidth_hz <= widest + 730000) {
                high = 0;
                low = 0x80;
                intermediate = 2300000;
                std::uint32_t accumulated = 0;
                if (bandwidth_hz > widest + 350000) {
                    bandwidth_hz -= 380000;
                    intermediate += 380000;
                    accumulated += 380000;
                } else low |= 0x20;
                if (bandwidth_hz > widest) {
                    bandwidth_hz -= 350000;
                    intermediate += 350000;
                    accumulated += 350000;
                } else low |= 0x40;
                std::size_t selected = 0;
                while (selected + 1 < widths.size() &&
                       static_cast<std::uint32_t>(widths[selected + 1]) >= bandwidth_hz)
                    ++selected;
                low |= static_cast<std::uint8_t>(15 - selected);
                accumulated += static_cast<std::uint32_t>(widths[selected]);
                intermediate -= accumulated / 2;
            }
        }
    }
    status_.actual_frequency_hz.reset();
    try {
        with_repeater(registers_, [&] {
            masked(0x0a, high, 0x10);
            masked(0x0b, low, 0xef);
        });
    } catch (const std::exception&) {
        status_ = {};
        registers_.invalidate_tuner_cache();
        throw;
    }
    status_.intermediate_frequency_hz = intermediate;
    return intermediate;
}

double R820Tuner::pll(std::uint32_t lo_hz) {
    const auto values = plan(lo_hz);
    masked(0x10, 0x00, 0x10);
    masked(0x1a, 0x00, 0x0c);
    masked(0x12, 0x06, 0xff);
    std::array<std::uint8_t, 7> fine{};
    check(registers_.read_tuner_registers(0, fine), "Reading R820 VCO fine tune");
    auto div_num = static_cast<std::uint8_t>(values.div_num);
    const auto fine_tune = (fine[4] >> 4) & 3;
    const auto target_fine = registers_.tuner_address_ == 0x74 ? 1 : 2;
    if (fine_tune > target_fine) div_num = static_cast<std::uint8_t>(div_num - 1);
    else if (fine_tune < target_fine) ++div_num;
    masked(0x10, static_cast<std::uint8_t>(div_num << 5), 0xe0);
    const auto ni = (values.integer - 13) / 4;
    const auto si = values.integer - 4 * ni - 13;
    write(0x14, static_cast<std::uint8_t>((si << 6) + ni));
    masked(0x12, values.remainder_khz == 0 ? 8 : 0, 8);
    write(0x16, static_cast<std::uint8_t>(values.sdm >> 8));
    write(0x15, static_cast<std::uint8_t>(values.sdm));
    bool locked = false;
    for (int attempt = 0; attempt < 2; ++attempt) {
        // USB control latency alone does not guarantee PLL settling, especially on Android.
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        std::array<std::uint8_t, 5> status{};
        check(registers_.read_tuner_registers(0, status), "Reading R820 PLL lock");
        if (status[2] & 0x40) { locked = true; break; }
        if (attempt == 0) masked(0x12, 0x06, 0xff);
    }
    if (!locked) throw std::runtime_error("R820 PLL did not lock after two status reads at " +
                                         std::to_string(lo_hz) + " Hz");
    double actual = double(values.sdm * crystal_khz);
    actual = actual * 1000.0 / 32768.0;
    actual = ((actual + double(2ULL * values.integer * crystal_hz)) / double(values.mix_div) -
              double(status_.intermediate_frequency_hz)) / 1000000.0;
    masked(0x1a, 0x08, 0x08);
    return actual;
}

double R820Tuner::tune(std::uint32_t frequency_hz) {
    if (!status_.initialized) throw std::logic_error("R820 tuner must be initialized before tuning");
    if (blog_v4_ && frequency_hz <= 26500000)
        throw std::invalid_argument("RTL-SDR Blog V4 HF upconversion is not yet ported");
    if (frequency_hz > std::numeric_limits<std::uint32_t>::max() - status_.intermediate_frequency_hz)
        throw std::invalid_argument("R820 frequency plus IF overflows 32 bits");
    const auto lo_hz = frequency_hz + status_.intermediate_frequency_hz;
    plan(lo_hz);
    status_.actual_frequency_hz.reset();
    double actual_mhz{};
    try {
        with_repeater(registers_, [&] {
            select_frontend(lo_hz);
            actual_mhz = pll(lo_hz);
            if (blog_v4_) {
                const std::uint8_t input = frequency_hz < 250000000 ? 2 : 3;
                if (input != rf_input_) {
                    masked(0x06, 0, 0x08);
                    masked(0x05, input == 2 ? 0x40 : 0, 0x40);
                    masked(0x05, input == 2 ? 0x20 : 0, 0x20);
                    rf_input_ = input;
                }
            } else if (registers_.tuner_address_ == 0x74) {
                const std::uint8_t input = float(frequency_hz) <= 345000000.0f ? 0x60 : 0;
                if (input != rf_input_) {
                    masked(0x05, input, 0x60);
                    rf_input_ = input;
                }
            }
        });
    } catch (const std::exception&) {
        status_ = {};
        registers_.invalidate_tuner_cache();
        throw;
    }
    status_.actual_frequency_hz = actual_mhz * 1000000.0;
    return *status_.actual_frequency_hz;
}

const R820TunerStatus& R820Tuner::status() const noexcept { return status_; }

}
