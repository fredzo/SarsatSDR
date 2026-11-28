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

#include <cospas/decoder.hpp>
#include "wav.hpp"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>
#include <numbers>
#include <stdexcept>
#include <utility>

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
template<class Action>
void rejected(Action action) {
    try { action(); } catch (const std::invalid_argument&) { return; }
    throw std::runtime_error("Invalid stream operation accepted");
}
void compare(std::vector<cospas::Frame> expected, std::vector<cospas::Frame> actual, double origin = 0) {
    const auto order = [](const auto& a, const auto& b) { return a.time_seconds < b.time_seconds; };
    std::stable_sort(expected.begin(), expected.end(), order);
    std::stable_sort(actual.begin(), actual.end(), order);
    require(expected.size() == actual.size(), "Streaming frame count differs");
    for (std::size_t n = 0; n < expected.size(); ++n) {
        const auto& a = expected[n];
        const auto& b = actual[n];
        require(a.generation == b.generation && a.self_test == b.self_test, "Streaming changed frame mode");
        require(a.raw_bits == b.raw_bits && a.corrected_bits == b.corrected_bits &&
                a.bch_valid == b.bch_valid && a.corrected_errors == b.corrected_errors,
                "Streaming changed received bits or BCH");
        require(std::abs(a.time_seconds + origin - b.time_seconds) < 1e-10 &&
                std::abs(a.frequency_offset_hz - b.frequency_offset_hz) < .001,
                "Streaming changed frame time or frequency");
        for (const auto fields : {std::pair(&a.phase_error, &b.phase_error),
                                  std::pair(&a.recovered_i, &b.recovered_i),
                                  std::pair(&a.recovered_q, &b.recovered_q)}) {
            require(fields.first->size() == fields.second->size(), "Streaming trace length differs");
            for (std::size_t k = 0; k < fields.first->size(); ++k)
                require(std::abs((*fields.first)[k] - (*fields.second)[k]) < 1e-4f,
                        "Streaming changed engineering trace");
        }
    }
}
void feed(cospas::StreamDecoder& stream, std::span<const cospas::Sample> iq,
          std::vector<cospas::Frame>& output) {
    constexpr std::array<std::size_t, 6> chunks{1, 17, 4093, 100, 1601, 31};
    std::size_t position = 0, index = 0;
    while (position < iq.size()) {
        const auto count = std::min(chunks[index++ % chunks.size()], iq.size() - position);
        stream.push(iq.subspan(position, count), output);
        position += count;
    }
}
}

int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::invalid_argument("Expected SGB capture path");
        const auto signal = cospas::read_wav(argv[1]);
        cospas::DecoderSettings settings;
        settings.fgb = false;
        cospas::DecodeDiagnostics diagnostics;
        const auto expected = cospas::decode(signal.samples, signal.sample_rate_hz, settings, &diagnostics);
        require(!expected.empty(), "Expected a real SGB frame");
        auto alternate_settings = settings;
        alternate_settings.sgb_phase_gain = .83f;
        alternate_settings.sgb_frequency_gain = 3.81f;
        alternate_settings.sgb_feedback = 4;
        alternate_settings.sgb_max_errors = 5;
        compare(cospas::decode(signal.samples, signal.sample_rate_hz, alternate_settings), expected);
        cospas::StreamDecoder stream(signal.sample_rate_hz, settings);
        std::vector<cospas::Frame> actual;
        feed(stream, signal.samples, actual);
        stream.finish(actual);
        compare(expected, actual);
        require(stream.diagnostics().sgb_candidates == diagnostics.sgb_candidates &&
                stream.diagnostics().sgb_bch_rejections == diagnostics.sgb_bch_rejections &&
                stream.diagnostics().sgb_max_detection_level == diagnostics.sgb_max_detection_level,
                "Chunking changed acquisition diagnostics");
        rejected([&] { stream.finish(actual); });
        rejected([&] { stream.push({}, actual); });

        stream.reset(2 * std::uint64_t(signal.sample_rate_hz));
        actual.clear();
        stream.push(std::span(signal.samples).first(signal.samples.size() / 2), actual);
        stream.reset(2 * std::uint64_t(signal.sample_rate_hz));
        actual.clear();
        const std::array<cospas::Sample, 1> invalid{{{0, std::numeric_limits<float>::infinity()}}};
        rejected([&] { stream.push(invalid, actual); });
        require(stream.next_sample_index() == 2 * std::uint64_t(signal.sample_rate_hz),
                "Invalid chunk advanced stream position");
        feed(stream, signal.samples, actual);
        stream.finish(actual);
        compare(expected, actual, 2);
        for (const float mixer_hz : {-10000.0f, 10000.0f}) {
            auto shifted = signal.samples;
            for (std::size_t n = 0; n < shifted.size(); ++n) {
                const double angle = 2 * std::numbers::pi * mixer_hz * double(n) / signal.sample_rate_hz;
                shifted[n] *= cospas::Sample{static_cast<float>(std::cos(angle)),
                                             static_cast<float>(std::sin(angle))};
            }
            cospas::StreamDecoder mixed(signal.sample_rate_hz, settings, mixer_hz);
            std::vector<cospas::Frame> whole;
            mixed.push(shifted, whole);
            mixed.finish(whole);
            require(whole.size() == expected.size(), "NCO lost a real SGB frame");
            for (std::size_t n = 0; n < whole.size(); ++n) {
                require(whole[n].corrected_bits == expected[n].corrected_bits &&
                        whole[n].bch_valid == expected[n].bch_valid, "NCO changed protected SGB payload");
                require(std::abs(whole[n].frequency_offset_hz - expected[n].frequency_offset_hz) < 2,
                        "NCO failed to restore SGB frequency (wrong sign or omitted mixer)");
            }
            mixed.reset();
            actual.clear();
            feed(mixed, std::span(shifted).first(12345), actual);
            mixed.reset();
            actual.clear();
            feed(mixed, shifted, actual);
            mixed.finish(actual);
            compare(whole, actual);
        }
        stream.reset(std::numeric_limits<std::uint64_t>::max());
        rejected([&] { stream.push(std::span(signal.samples).first(1), actual); });
        const auto fgb_signal = cospas::read_wav(std::filesystem::path(argv[1]).parent_path() / "fgb.wav");
        const auto preroll = std::size_t(fgb_signal.sample_rate_hz) * 2;
        std::vector<cospas::Sample> padded(preroll);
        for (std::size_t n = 0; n < preroll; ++n)
            padded[n] = fgb_signal.samples[n % (fgb_signal.sample_rate_hz / 5)];
        padded.insert(padded.end(), fgb_signal.samples.begin(), fgb_signal.samples.end());
        settings = cospas::DecoderSettings{};
        settings.fgb = true;
        settings.sgb = false;
        cospas::DecodeDiagnostics fgb_diagnostics;
        const auto expected_fgb = cospas::decode(padded, fgb_signal.sample_rate_hz, settings, &fgb_diagnostics);
        require(!expected_fgb.empty(), "Expected a real FGB frame");
        alternate_settings = settings;
        alternate_settings.fgb_alpha = .7f;
        alternate_settings.fgb_beta = .2f;
        alternate_settings.fgb_zeta = .03f;
        alternate_settings.fgb_max_errors = 2;
        const auto words = [](const std::vector<cospas::Frame>& frames) {
            std::vector<std::vector<std::uint8_t>> result;
            for (const auto& frame : frames) result.push_back(frame.corrected_bits);
            std::sort(result.begin(), result.end());
            return result;
        };
        require(words(cospas::decode(padded, fgb_signal.sample_rate_hz, alternate_settings)) == words(expected_fgb),
                "Alternate FGB loop gains changed decoded words or emitted a duplicate burst");
        cospas::StreamDecoder fgb_stream(fgb_signal.sample_rate_hz, settings);
        actual.clear();
        feed(fgb_stream, std::span(padded).first(padded.size() / 2), actual);
        fgb_stream.reset(2 * std::uint64_t(fgb_signal.sample_rate_hz));
        actual.clear();
        feed(fgb_stream, padded, actual);
        fgb_stream.finish(actual);
        compare(expected_fgb, actual, 2);
        require(fgb_stream.diagnostics().fgb_candidates == fgb_diagnostics.fgb_candidates &&
                fgb_stream.diagnostics().fgb_trial_count == fgb_diagnostics.fgb_trial_count,
                "Reset changed FGB acquisition diagnostics");
        require(fgb_diagnostics.fgb_trial_count > 0, "FGB reset test needs an acquisition trial");
        for (std::size_t n = 0; n < fgb_diagnostics.fgb_trial_count; ++n)
            require(fgb_stream.diagnostics().fgb_trials[n].time_seconds ==
                    fgb_diagnostics.fgb_trials[n].time_seconds + 2, "FGB trial lost absolute time after reset");
        settings.fgb_runtime_ms = 100;
        require(cospas::decode(padded, fgb_signal.sample_rate_hz, settings).empty(),
                "FGB RunTime must stop trials before enough samples exist to decode a frame");
        std::cout << "Streaming matches batch bits, traces, timing and diagnostics; reset and finalization checked\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
