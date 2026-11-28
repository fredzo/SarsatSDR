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
#include "frontend_mixer.hpp"
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
cospas::Bits bits(const std::string& value, std::size_t count) {
    cospas::Bits result;
    for (const char digit : value) {
        const int n = digit <= '9' ? digit - '0' : digit - 'A' + 10;
        for (int bit = 3; bit >= 0; --bit) result.push_back(std::uint8_t((n >> bit) & 1));
    }
    result.erase(result.begin(), result.begin() + static_cast<std::ptrdiff_t>(result.size() - count));
    return result;
}
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
template<class Action>
void require_invalid(Action action) {
    try { action(); }
    catch (const std::invalid_argument&) { return; }
    throw std::runtime_error("Invalid decoder configuration was accepted");
}
}

int main() {
    try {
        // Original ippsTone_32fc, hint=2, with float phase retained after each 3200 samples.
        const std::array<std::size_t, 9> indices{0, 1, 7, 1599, 3199, 3200, 6399, 6400, 9599};
        struct ToneOracle {
            float frequency;
            std::array<cospas::Sample, 9> samples;
        };
        const std::array<ToneOracle, 3> oracles{{
            {10000, {{{1, 0}, {.9907182f, -.13593173f}, {.578035653f, -.816011548f},
                      {-.305893123f, .9520659f}, {-.8844889f, -.466561228f},
                      {-.939699769f, -.3420005f}, {.671589851f, .7409231f},
                      {.7660713f, .642755568f}, {-.377696753f, -.925929368f}}}},
            {-70000, {{{1, 0}, {.578035653f, .8160115f}, {.92177856f, .38771677f},
                       {.822277665f, -.5690865f}, {.9673315f, -.2535147f},
                       {.76602304f, .642813146f}, {.9039608f, .427615285f},
                       {.1735826f, .9848193f}, {.4175781f, .90864104f}}}},
            {-69750.9765625f, {{{1, 0}, {.580803156f, .814044058f}, {.9307329f, .365699619f},
                               {.9693346f, .24574469f}, {.12282826f, .992427945f},
                               {-.736541f, .676393f}, {-.7617393f, -.647883654f},
                               {.08498515f, -.996382236f}, {.999276161f, -.03804225f}}}}
        }};
        for (const auto& oracle : oracles) for (const float sign : {-1.0f, 1.0f}) {
            cospas::FrontendMixer mixer(sign * oracle.frequency);
            for (int pass = 0; pass < 2; ++pass) {
                std::size_t next = 0;
                for (std::size_t n = 0; n <= indices.back(); ++n) {
                    const auto value = mixer.process({1, 0});
                    if (n == indices[next]) {
                        const auto expected = sign > 0 ? oracle.samples[next] : std::conj(oracle.samples[next]);
                        require(std::abs(value - expected) < 1e-6f, "NCO differs from expected oscillator samples");
                        if (++next == indices.size()) break;
                    }
                }
                mixer.reset();
            }
        }
        cospas::FrontendMixer bypass(0);
        const cospas::Sample unchanged{.375f, -.125f};
        require(bypass.process(unchanged) == unchanged, "Zero NCO changed WAV samples");
        for (const float invalid_hz : {230400.0f, -230400.0f, std::numeric_limits<float>::infinity(),
                                      std::numeric_limits<float>::quiet_NaN()})
            require_invalid([=] { cospas::FrontendMixer mixer(invalid_hz); });
        for (const int degree : {-1, 0, 31, 255})
            require_invalid([=] { cospas::BchDecoder invalid(degree, 0x11d, 6); });
        for (const int polynomial : {-1, 0x80, 0x81, 0x189})
            require_invalid([=] { cospas::BchDecoder invalid(7, polynomial, 3); });
        cospas::DecoderSettings invalid;
        invalid.sgb_detection_threshold = std::numeric_limits<float>::quiet_NaN();
        require_invalid([&] { cospas::decode({}, 230400, invalid); });
        invalid.sgb_detection_threshold = -1;
        require_invalid([&] { cospas::decode({}, 230400, invalid); });
        for (const int runtime : {0, -1}) {
            invalid = cospas::DecoderSettings{};
            invalid.fgb_runtime_ms = runtime;
            require_invalid([&] { cospas::decode({}, 230400, invalid); });
        }
        for (const float feedback : {-1.0f, std::numeric_limits<float>::infinity(),
                                     std::numeric_limits<float>::quiet_NaN()}) {
            invalid = cospas::DecoderSettings{};
            invalid.sgb_feedback = feedback;
            require_invalid([&] { cospas::decode({}, 230400, invalid); });
        }
        for (const int header : {-1, 4}) {
            invalid = cospas::DecoderSettings{};
            invalid.fgb_header_errors = header;
            require_invalid([&] { cospas::decode({}, 230400, invalid); });
        }
        const auto fgb = bits("FFFED08E320000002B802C8C053698EC7F97", 144);
        for (int count = 0; count <= 3; ++count) {
            for (const bool test : {false, true}) {
                auto header = fgb;
                if (!test) for (std::size_t n = 16; n < 24; ++n) header[n] ^= 1;
                for (int n = 0; n < count; ++n) header[std::size_t(n * 8 + 2)] ^= 1;
                bool self_test = !test;
                require(cospas::fgb_header_errors(header, self_test) == count && self_test == test,
                        "FGB header distance or frame sync mode failed");
            }
        }
        for (const auto config : {std::array{7, 0x89, 3, 24, 82}, std::array{6, 0x43, 2, 106, 38}}) {
            const cospas::BchDecoder decoder(config[0], config[1], config[2]);
            const auto word = std::span(fgb).subspan(std::size_t(config[3]), std::size_t(config[4]));
            for (int count = 0; count <= config[2]; ++count) {
                cospas::Bits damaged(word.begin(), word.end());
                for (int n = 0; n < count; ++n) damaged[std::size_t(n * 11)] ^= 1;
                const auto corrected = decoder.decode(damaged);
                require(corrected.valid && corrected.corrected_errors == count &&
                        std::equal(corrected.bits.begin(), corrected.bits.end(), word.begin()),
                        "FGB BCH correction failed");
            }
        }
        const auto sgb = bits("3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470400A448FD", 250);
        const cospas::BchDecoder decoder(8, 0x11d, 6);
        for (int count = 0; count <= 6; ++count) {
            auto damaged = sgb;
            for (int n = 0; n < count; ++n) damaged[std::size_t(n * 37)] ^= 1;
            const auto corrected = decoder.decode(damaged);
            require(corrected.valid && corrected.corrected_errors == count && corrected.bits == sgb,
                    "SGB BCH correction failed");
        }
        const auto self_test = bits("0039823D38C95CD5500BAAB0000000000007FFF000007FE0058129B30C1E32A", 250);
        require(cospas::hex(self_test, true) == "8039823D38C95CD5500BAAB0000000000007FFF000007FE0058129B30C1E32A",
                "SGB self-test marker must not modify BCH-protected bits");
        std::cout << "BCH and SGB framing checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
