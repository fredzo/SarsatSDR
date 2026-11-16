#include "rtl_control.hpp"
#include "dsp_tables.hpp"

#include <algorithm>
#include <array>
#include <stdexcept>
#include <string>

namespace cospas {
namespace {

struct GainAttempt {
    int status{};
    int cleanup_status{};
    const char* stage{"enabling I2C repeater"};
    std::uint8_t address{};

    bool succeeded() const noexcept { return status == 0 && cleanup_status == 0; }
};

GainAttempt apply_gain(RtlRegisterIo& io, const std::array<std::uint8_t, 3>& gain) {
    struct Write { std::uint8_t address, value, mask; };
    const std::array<Write, 5> writes{{
        {0x05, 0x10, 0x10},
        {0x05, gain[0], 0x0f},
        {0x07, 0x00, 0x10},
        {0x07, gain[1], 0x0f},
        {0x0c, gain[2], 0x9f},
    }};
    GainAttempt result;
    result.status = io.set_i2c_repeater(true);
    if (result.status == 0) {
        for (const auto& write : writes) {
            std::uint8_t cached{};
            result.address = write.address;
            result.stage = "reading cached tuner register";
            result.status = io.read_cached_tuner_register(write.address, cached);
            if (result.status != 0) break;
            const auto value = static_cast<std::uint8_t>((cached & ~write.mask) | (write.value & write.mask));
            result.stage = "writing tuner register";
            result.status = io.write_tuner_register(write.address, value);
            if (result.status != 0) break;
        }
    }
    result.cleanup_status = io.set_i2c_repeater(false);
    return result;
}

std::string describe(const GainAttempt& attempt) {
    std::string result;
    if (attempt.status != 0) {
        result = std::string(attempt.stage);
        if (attempt.address != 0) result += " " + std::to_string(attempt.address);
        result += " (code " + std::to_string(attempt.status) + ")";
    }
    if (attempt.cleanup_status != 0) {
        if (!result.empty()) result += "; ";
        result += "disabling I2C repeater (code " + std::to_string(attempt.cleanup_status) + ")";
    }
    return result;
}

}

RtlFrontendControl::RtlFrontendControl(RtlRegisterIo& io, int initial_gain_index, RtlAgcSettings settings)
    : io_(io), settings_(settings) {
    if (settings_.delay_blocks < 0 || settings_.delay_blocks > 50 ||
        settings_.clipping_samples < 0 || settings_.clipping_samples > int(rtl_block_samples)) {
        throw std::invalid_argument("Invalid RTL FE_AGC settings");
    }
    set_gain(initial_gain_index);
}

void RtlFrontendControl::set_gain(int index) {
    index = std::clamp(index, 0, 11);
    if (gain_index_ == index) return;
    gain_index_.reset();
    const auto& gain = dsp_tables::rtl_gain_presets[std::size_t(index)];
    const auto first = apply_gain(io_, gain);
    if (!first.succeeded()) {
        const auto second = apply_gain(io_, gain);
        if (!second.succeeded()) {
            throw std::runtime_error("RTL gain preset " + std::to_string(index) +
                                     " failed twice: first: " + describe(first) +
                                     "; second: " + describe(second));
        }
    }
    gain_index_ = index;
}

std::optional<int> RtlFrontendControl::gain_index() const noexcept { return gain_index_; }

void RtlFrontendControl::set_automatic_gain(bool enabled) noexcept { automatic_gain_ = enabled; }

RtlAgcObservation RtlFrontendControl::process_cu8(std::span<const std::uint8_t> iq) {
    if (iq.size() != rtl_block_samples * 2) {
        throw std::invalid_argument("RTL FE_AGC requires exactly 6400 complex CU8 samples");
    }
    if (!gain_index_) throw std::logic_error("RTL gain is unknown after a failed register transaction");
    RtlAgcObservation result;
    std::uint32_t positive_sum{}, positive_count{};
    for (std::size_t sample = 0; sample < iq.size(); sample += 2) {
        const auto i = iq[sample];
        if (i >= 250) {
            ++result.clipped_samples;
        } else if (i > 128) {
            positive_sum += i;
            ++positive_count;
        }
    }
    if (positive_count != 0) {
        // Positive integer division matches truncation of((mean(I) - 128) * 2).
        result.positive_level = static_cast<std::uint8_t>(2 * (positive_sum - 128 * positive_count) / positive_count);
    }
    result.clipped = result.clipped_samples > std::uint32_t(settings_.clipping_samples);
    if (automatic_gain_) {
        if (settings_.delay_blocks < delay_counter_) {
            int next = *gain_index_;
            if (result.clipped) {
                if (next < 11) ++next;
            } else if (result.positive_level < 30 && next > 1) {
                --next;
            }
            if (next != *gain_index_) {
                set_gain(next);
                result.gain_changed = true;
            }
            delay_counter_ = 0;
        }
        ++delay_counter_;
    }
    return result;
}

}
