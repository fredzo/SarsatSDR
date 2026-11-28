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

#include <complex>
#include <cstdio>
#include <cstdint>
#include <mutex>
#include <span>
#include <string>
#include <vector>

namespace cospas {

class IqRecorder {
public:
    ~IqRecorder();
    void configure(std::uint32_t rate, double mixer_hz, std::uint32_t center_hz);
    // Takes ownership of the stream, including when starting fails.
    void start(std::FILE* file);
    void push(std::span<const std::uint8_t> iq);
    void stop();
    void finish_session();
private:
    void stop_locked();
    std::mutex mutex_;
    std::FILE* file_{};
    bool available_{};
    std::uint32_t rate_{}, center_hz_{}, data_bytes_{};
    std::complex<double> oscillator_{1, 0}, step_{1, 0};
    std::uint64_t samples_{};
    std::vector<std::uint8_t> header_;
    std::string failure_;
};

IqRecorder& iq_recorder();

}
