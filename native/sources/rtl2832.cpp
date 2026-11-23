#include "rtl2832.hpp"
#include "dsp_tables.hpp"

#include <libusb.h>

#include <array>
#include <cmath>
#include <stdexcept>
#include <string>

namespace cospas {
namespace {

void check(int status, const char* operation) {
    if (status != 0)
        throw std::runtime_error(std::string(operation) + ": " + libusb_error_name(status) +
                                 " (code " + std::to_string(status) + ")");
}

std::array<std::uint8_t, 20> packed_fir() {
    const auto& coefficients = dsp_tables::rtl_demod_fir;
    std::array<std::uint8_t, 20> result{};
    for (std::size_t n = 0; n < 8; ++n) result[n] = static_cast<std::uint8_t>(coefficients[n]);
    for (std::size_t n = 8; n < 16; n += 2) {
        const auto first = static_cast<std::uint16_t>(coefficients[n]);
        const auto second = static_cast<std::uint16_t>(coefficients[n + 1]);
        const auto offset = 8 + (n - 8) * 3 / 2;
        result[offset] = static_cast<std::uint8_t>(first >> 4);
        result[offset + 1] = static_cast<std::uint8_t>((first << 4) | ((second >> 8) & 15));
        result[offset + 2] = static_cast<std::uint8_t>(second);
    }
    return result;
}

}

Rtl2832::Rtl2832(RtlUsbRegisters& registers, bool blog_v4) : registers_(registers), blog_v4_(blog_v4) {}

void Rtl2832::write(std::uint8_t block, std::uint16_t address, std::uint16_t value, std::uint8_t width) {
    check(registers_.write_register(block, address, value, width), "Writing RTL2832 system register");
}

void Rtl2832::demod(std::uint8_t page, std::uint8_t address, std::uint16_t value, std::uint8_t width) {
    check(registers_.write_demod_register(page, address, value, width), "Writing RTL2832 demod register");
}

void Rtl2832::baseband() {
    write(1, 0x2000, 0x09);
    write(1, 0x2158, 0x0002, 2);
    write(1, 0x2148, 0x1002, 2);
    write(2, 0x300b, 0x22);
    write(2, 0x3000, 0xe8);
    demod(1, 0x01, 0x14);
    demod(1, 0x01, 0x10);
    demod(1, 0x15, 0x00);
    demod(1, 0x16, 0x0000, 2);
    for (std::uint8_t address = 0x16; address <= 0x1b; ++address) demod(1, address, 0);
    const auto fir = packed_fir();
    for (std::size_t n = 0; n < fir.size(); ++n) demod(1, static_cast<std::uint8_t>(0x1c + n), fir[n]);
    demod(0, 0x19, 0x05);
    demod(1, 0x93, 0xf0);
    demod(1, 0x94, 0x0f);
    demod(1, 0x11, 0x00);
    demod(1, 0x04, 0x00);
    demod(0, 0x61, 0x60);
    demod(0, 0x06, 0x80);
    demod(1, 0xb1, 0x1a);
    demod(0, 0x0d, 0x83);
}

void Rtl2832::set_intermediate_frequency(std::uint32_t frequency_hz) {
    const auto word = static_cast<std::uint32_t>(static_cast<std::int32_t>(
        std::floor(double(frequency_hz) * (4194304.0 / 28800000.0) * -1.0)));
    demod(1, 0x19, static_cast<std::uint16_t>((word >> 16) & 0x3f));
    demod(1, 0x1a, static_cast<std::uint8_t>(word >> 8));
    demod(1, 0x1b, static_cast<std::uint8_t>(word));
}

void Rtl2832::disable_bias_tee() {
    std::array<std::uint8_t, 1> value{};
    // Drive GPIO0 low before enabling its output, avoiding a transient Bias-T pulse.
    check(registers_.read_register(2, 0x3001, value), "Reading RTL2832 GPIO output");
    write(2, 0x3001, std::uint8_t(value[0] & 0xfe));
    check(registers_.read_register(2, 0x3004, value), "Reading RTL2832 GPIO direction");
    write(2, 0x3004, std::uint8_t(value[0] & 0xfe));
    check(registers_.read_register(2, 0x3003, value), "Reading RTL2832 GPIO enable");
    write(2, 0x3003, std::uint8_t(value[0] | 1));
}

std::int32_t Rtl2832::dsp_offset_hz() noexcept {
    return dsp_tables::rtl_dsp_offset_hz;
}

void Rtl2832::initialize(std::uint32_t frequency_hz) {
    // The tuner runs 70 kHz above the requested DSP center during decoding.
    if (frequency_hz < 100000000 || frequency_hz > 999070000)
        throw std::invalid_argument("RTL2832 tuner frequency must be within 100000000..999070000 Hz");
    initialized_ = false;
    tuner_.reset();
    registers_.invalidate_tuner_cache();
    try {
        baseband();
        disable_bias_tee();
        check(registers_.set_i2c_repeater(true), "Enabling RTL2832 tuner probe");
        const auto probe = [&](std::uint8_t address) {
            std::array<std::uint8_t, 1> chip{};
            const int result = registers_.read_i2c(address, chip);
            if (result == LIBUSB_ERROR_PIPE) return false; // Firmware reports an absent I2C address as STALL.
            check(result, "Reading RTL-SDR tuner chip ID");
            return chip[0] == 0x69;
        };
        if (probe(0x34)) registers_.tuner_address_ = 0x34;
        else if (probe(0x74)) registers_.tuner_address_ = 0x74;
        else throw std::runtime_error("Unsupported RTL-SDR tuner: no R820/R828D chip ID 0x69 at 0x34/0x74");
        check(registers_.set_i2c_repeater(false), "Closing RTL2832 tuner probe");
        tuner_.emplace(registers_, blog_v4_);
        demod(1, 0xb1, 0x1a);
        demod(0, 0x08, 0x4d);
        // Preserve the transient 35.7 MHz IF; bandwidth setup replaces it.
        set_intermediate_frequency(35700000);
        demod(1, 0x15, 0x01);
        demod(0, 0x06, 0x80);
        tuner_->initialize();
        set_intermediate_frequency(tuner_->set_bandwidth(rtl_sample_rate_hz));
        tuner_->tune(162000000);
        constexpr std::uint32_t ratio = static_cast<std::uint32_t>(28800000ULL * 4194304 / rtl_sample_rate_hz)
                                        & 0x0ffffffc;
        demod(1, 0x9f, static_cast<std::uint16_t>(ratio >> 16), 2);
        demod(1, 0xa1, static_cast<std::uint16_t>(ratio), 2);
        demod(1, 0x3f, 0);
        demod(1, 0x3e, 0);
        demod(1, 0x01, 0x14);
        demod(1, 0x01, 0x10);
        tuner_->tune(frequency_hz);
        const auto fir = packed_fir();
        for (std::size_t n = 0; n < fir.size(); ++n) {
            std::array<std::uint8_t, 1> actual{};
            check(registers_.read_demod_register(1, static_cast<std::uint8_t>(0x1c + n), actual),
                  "Reading back RTL2832 FIR");
            if (actual[0] != fir[n])
                throw std::runtime_error("RTL2832 FIR readback mismatch at register " + std::to_string(0x1c + n));
        }
    } catch (const std::exception& error) {
        registers_.invalidate_tuner_cache();
        const int cleanup = registers_.set_i2c_repeater(false);
        if (cleanup != 0)
            throw std::runtime_error(std::string(error.what()) + "; closing RTL2832 repeater failed (code " +
                                     std::to_string(cleanup) + ")");
        throw;
    }
    initialized_ = true;
}

void Rtl2832::reset_buffer() {
    if (!initialized_) throw std::logic_error("RTL2832 must be initialized before resetting the I/Q buffer");
    try {
        write(1, 0x2148, 0x1002, 2);
        write(1, 0x2148, 0, 2);
    } catch (const std::exception&) {
        initialized_ = false;
        registers_.invalidate_tuner_cache();
        throw;
    }
}

const R820TunerStatus& Rtl2832::status() const {
    if (!initialized_) throw std::logic_error("RTL2832 receiver is not initialized");
    return tuner_->status();
}

}
