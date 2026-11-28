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

#pragma once

#include <array>
#include <complex>
#include <cstdint>
#include <functional>
#include <memory>
#include <span>

namespace cospas::cli {

class Spectrum {
public:
    using Line = std::array<float, 1024>;
    using Callback = std::function<void(const Line&, double, float)>;
    Spectrum(std::uint32_t rate, double source_center_hz, Callback callback, double dsp_center_hz = 406050000);
    ~Spectrum();
    void push(std::span<const std::complex<float>> input);
    void push_cu8(std::span<const std::uint8_t> input);
private:
    void sample(std::complex<float> value);
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

float spectrum_display_offset_db(std::size_t gain_index);
bool stop_requested();
#ifdef COSPAS_CLI_EMBEDDED
void set_stop_requested(bool value);
#endif

}
