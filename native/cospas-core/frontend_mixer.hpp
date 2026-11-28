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

#include <cmath>
#include <complex>
#include <cstddef>
#include <stdexcept>

namespace cospas {

class FrontendMixer {
public:
    explicit FrontendMixer(float frequency_hz) : conjugate_(frequency_hz >= 0) {
        if (!std::isfinite(frequency_hz) || std::abs(frequency_hz) >= 230400)
            throw std::invalid_argument("Frontend mixer frequency must be finite and inside +/-230400 Hz");
        const auto angular = static_cast<float>(frequency_hz * 2.0L * pi / 460800.0L);
        const auto normalized = static_cast<float>(std::abs(static_cast<long double>(angular) / (2 * pi)));
        step_ = double(normalized) * 2 * double(pi);
    }
    void reset() noexcept { phase_ = 0; position_ = 0; }
    std::complex<float> process(std::complex<float> value) noexcept {
        if (step_ == 0) return value;
        const double angle = double(phase_) + double(position_) * step_;
        const float real = static_cast<float>(std::cos(angle));
        const float imag = static_cast<float>(std::sin(angle)) * (conjugate_ ? -1.0f : 1.0f);
        if (++position_ == 3200) {
            // Carry float phase between fixed internal blocks, not caller chunks.
            phase_ = static_cast<float>(std::fmod(double(phase_) + 3200 * step_, 2 * double(pi)));
            position_ = 0;
        }
        return value * std::complex<float>{real, imag};
    }
private:
    static constexpr long double pi = 3.141592653589793238462643383279502884L;
    double step_{};
    float phase_{};
    std::size_t position_{};
    bool conjugate_;
};

}
