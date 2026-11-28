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

#include "rtl_usb.hpp"

namespace cospas {

inline constexpr std::size_t rtl_iq_queue_blocks = 128; // About 890 ms at 921.6 kS/s.

struct RtlIqBlock {
    std::array<std::uint8_t, rtl_block_samples * 2> bytes{};
    std::size_t transferred{};
    bool timed_out{};
};

class RtlIqCapture {
public:
    explicit RtlIqCapture(RtlUsbSampleIo& source);
    ~RtlIqCapture();
    RtlIqCapture(const RtlIqCapture&) = delete;
    RtlIqCapture& operator=(const RtlIqCapture&) = delete;
    // Drain queued blocks before EOF or the terminal transport/continuity error.
    bool read(RtlIqBlock& block);
    // Join the producer before closing its USB device; queued blocks remain readable.
    void stop() noexcept;
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}
