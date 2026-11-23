#pragma once

#include <cospas/c_api.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstdint>
#include <iostream>
#include <numbers>
#include <span>
#include <string>

namespace cospas::cli {

class FgbFm {
public:
    static constexpr unsigned audio_rate = 12000;

    explicit FgbFm(unsigned input_rate, double center_offset = 0,
                   double startup_mute_seconds = 0, std::ostream& output = std::cout)
        : input_rate_(input_rate), center_offset_(center_offset),
          startup_mute_seconds_(startup_mute_seconds), output_(output) {}

    void select(const cs_acquisition& acquisition, double elapsed_seconds = 0) {
        if (elapsed_seconds < startup_mute_seconds_) return;
        if (channel_ >= 0) {
            const auto& current = acquisition.fgb_channels[channel_];
            if (current.active && current.frequency_offset_hz == frequency_) return;
            flush();
            channel_ = -1;
        }
        for (int n = 0; n < int(std::size(acquisition.fgb_channels)); ++n) {
            const auto& candidate = acquisition.fgb_channels[n];
            if (candidate.active && std::isfinite(candidate.level_dbfs) &&
                std::abs(candidate.frequency_offset_hz + center_offset_) < input_rate_ * .5 &&
                (channel_ < 0 || candidate.level_dbfs > acquisition.fgb_channels[channel_].level_dbfs))
                channel_ = n;
        }
        if (channel_ < 0) return;
        frequency_ = acquisition.fgb_channels[channel_].frequency_offset_hz;
        step_ = std::polar(1.0, -2 * std::numbers::pi * (frequency_ + center_offset_) / input_rate_);
        oscillator_ = {1, 0};
        sum_ = previous_ = {};
        stages_ = {};
        clock_ = count_ = phase_ = 0;
        carrier_delay_ = {};
        carrier_samples_ = carrier_windows_ = stable_windows_ = 0;
        carrier_sum_ = {};
        carrier_weight_ = 0;
        carrier_found_ = false;
        dc_ = 0;
    }

    void push(std::span<const std::complex<float>> input) {
        if (channel_ < 0) return;
        for (const auto sample : input) feed(sample);
    }

    void push(std::span<const std::uint8_t> input) {
        if (channel_ < 0) return;
        for (std::size_t n = 0; n + 1 < input.size(); n += 2)
            feed({(input[n] - 127.5) / 128, (input[n + 1] - 127.5) / 128});
    }

    void flush() {
        if (!used_) return;
        static constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        std::string encoded;
        encoded.reserve((used_ + 2) / 3 * 4);
        for (std::size_t n = 0; n < used_; n += 3) {
            const unsigned a = pcm_[n], b = n + 1 < used_ ? pcm_[n + 1] : 0, c = n + 2 < used_ ? pcm_[n + 2] : 0;
            encoded += alphabet[a >> 2];
            encoded += alphabet[((a & 3) << 4) | (b >> 4)];
            encoded += n + 1 < used_ ? alphabet[((b & 15) << 2) | (c >> 6)] : '=';
            encoded += n + 2 < used_ ? alphabet[c & 63] : '=';
        }
        output_ << "{\"type\":\"fmAudio\",\"channel\":" << channel_
                << ",\"pcm\":\"" << encoded << "\"}\n" << std::flush;
        used_ = 0;
    }

private:
    void feed(std::complex<double> sample) {
        sum_ += sample * oscillator_;
        oscillator_ *= step_;
        ++count_;
        constexpr unsigned filter_rate = audio_rate * 4;
        clock_ += std::min(filter_rate, input_rate_);
        if (clock_ < input_rate_) return;
        clock_ -= input_rate_;
        auto value = sum_ / double(count_);
        count_ = 0;
        sum_ = {};
        for (auto& stage : stages_) {
            stage += .35 * (value - stage);
            value = stage;
        }
        if (++phase_ != 4) return;
        phase_ = 0;
        const auto rotated = value * std::conj(previous_);
        previous_ = value;
        const double angle = std::arg(rotated);
        if (!std::isfinite(angle)) return;
        dc_ += .04 * (angle - dc_);
        if (!carrier_found_) {
            detect_carrier(value);
            return;
        }
        const auto pcm = static_cast<std::uint16_t>(static_cast<std::int16_t>(
            std::clamp((angle - dc_) * 2, -1.0, 1.0) * 32767));
        pcm_[used_++] = static_cast<std::uint8_t>(pcm);
        pcm_[used_++] = static_cast<std::uint8_t>(pcm >> 8);
        if (used_ == pcm_.size()) flush();
    }

    void detect_carrier(std::complex<double> sample) {
        // A 0.5 ms lag exposes phase transitions while leaving room for candidate frequency error.
        if (carrier_windows_ >= 16) return;
        auto& delayed = carrier_delay_[carrier_samples_ % carrier_delay_.size()];
        const auto product = sample * std::conj(delayed);
        delayed = sample;
        carrier_sum_ += product;
        carrier_weight_ += std::abs(product);
        if (++carrier_samples_ != audio_rate / 100) return;
        const bool stable = carrier_weight_ > 1e-12 &&
            std::abs(carrier_sum_) >= .85 * carrier_weight_ &&
            std::abs(std::arg(carrier_sum_)) <= 2 * std::numbers::pi * .325;
        ++carrier_windows_;
        stable_windows_ = stable ? stable_windows_ + 1 : 0;
        // Allow acquisition latency within the nominal 160 ms preamble.
        carrier_found_ = stable_windows_ >= 6;
        carrier_samples_ = 0;
        carrier_sum_ = {};
        carrier_weight_ = 0;
    }

    unsigned input_rate_;
    double center_offset_, startup_mute_seconds_;
    std::ostream& output_;
    int channel_ = -1;
    double frequency_{}, dc_{};
    std::complex<double> step_{}, oscillator_{}, sum_{}, previous_{};
    std::array<std::complex<double>, 4> stages_{};
    std::array<std::complex<double>, audio_rate / 2000> carrier_delay_{};
    std::complex<double> carrier_sum_{};
    double carrier_weight_{};
    unsigned carrier_samples_{}, carrier_windows_{}, stable_windows_{};
    bool carrier_found_{};
    unsigned clock_{}, count_{}, phase_{};
    std::array<std::uint8_t, audio_rate / 25 * 2> pcm_{};
    std::size_t used_{};
};

}
