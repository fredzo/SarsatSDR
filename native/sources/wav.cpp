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

#include "wav.hpp"

#include <bit>
#include <charconv>
#include <cmath>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string_view>

namespace cospas {
namespace {
std::uint32_t u32(const unsigned char* p) {
    return std::uint32_t(p[0]) | (std::uint32_t(p[1]) << 8) |
           (std::uint32_t(p[2]) << 16) | (std::uint32_t(p[3]) << 24);
}
std::uint16_t u16(const unsigned char* p) {
    return std::uint16_t(std::uint16_t(p[0]) | (std::uint16_t(p[1]) << 8));
}
void read(std::ifstream& input, unsigned char* data, std::size_t count) {
    if (!input.read(reinterpret_cast<char*>(data), static_cast<std::streamsize>(count)))
        throw std::runtime_error("Truncated WAV file");
}
}

WavSignal read_wav(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("Cannot open WAV input");
    const auto file_size = std::filesystem::file_size(path);
    std::array<unsigned char, 40> header{};
    read(input, header.data(), 12);
    if (std::string(reinterpret_cast<char*>(header.data()), 4) != "RIFF" ||
        std::string(reinterpret_cast<char*>(header.data() + 8), 4) != "WAVE")
        throw std::runtime_error("Expected RIFF/WAVE I/Q input");
    const std::uint64_t riff_end = std::uint64_t(u32(header.data() + 4)) + 8;
    if (riff_end > file_size || riff_end < 12) throw std::runtime_error("Invalid RIFF size");
    std::uint16_t format = 0, channels = 0, bits = 0, alignment = 0;
    std::uint32_t rate = 0;
    std::optional<std::uint32_t> center_hz;
    std::uint64_t data_offset = 0, data_size = 0, offset = 12;
    while (offset + 8 <= riff_end) {
        input.seekg(static_cast<std::streamoff>(offset));
        read(input, header.data(), 8);
        const auto size = u32(header.data() + 4);
        const auto body = offset + 8;
        if (size > riff_end - body) throw std::runtime_error("WAV chunk exceeds RIFF boundary");
        const std::string id(reinterpret_cast<char*>(header.data()), 4);
        if (id == "fmt ") {
            if (size < 16) throw std::runtime_error("Short WAV format chunk");
            read(input, header.data(), 16);
            format = u16(header.data());
            channels = u16(header.data() + 2);
            rate = u32(header.data() + 4);
            alignment = u16(header.data() + 12);
            bits = u16(header.data() + 14);
        } else if (id == "LIST" && size >= 4 && size <= 4096) {
            std::vector<unsigned char> info(size);
            read(input, info.data(), info.size());
            if (std::string(reinterpret_cast<char*>(info.data()), 4) == "INFO") {
                for (std::size_t p = 4; p + 8 <= info.size();) {
                    const auto length = u32(info.data() + p + 4);
                    if (length > info.size() - p - 8) throw std::runtime_error("Invalid WAV INFO chunk");
                    if (std::string(reinterpret_cast<char*>(info.data() + p), 4) == "ICMT") {
                        const std::string_view comment(reinterpret_cast<char*>(info.data() + p + 8), length);
                        constexpr std::string_view prefix = "SarsatSDR centerHz=";
                        if (comment.starts_with(prefix)) {
                            const auto value = comment.substr(prefix.size(), comment.find('\0') - prefix.size());
                            std::uint32_t hz = 0;
                            const auto [end, error] = std::from_chars(value.data(), value.data() + value.size(), hz);
                            if (error != std::errc{} || end != value.data() + value.size() || hz < 100000000 || hz > 999000000)
                                throw std::runtime_error("Invalid I/Q WAV center frequency");
                            center_hz = hz;
                        }
                    }
                    p += 8 + length + (length & 1);
                }
            }
        } else if (id == "data") {
            if (data_offset) throw std::runtime_error("Multiple WAV data chunks are unsupported");
            data_offset = body;
            data_size = size;
        }
        offset = body + size + (size & 1);
    }
    if (!data_offset || channels != 2 || rate < 76800 || rate > 10000000 ||
        !((format == 1 && (bits == 8 || bits == 16)) || (format == 3 && bits == 32)) ||
        alignment != 2 * (bits / 8) || data_size % alignment != 0)
        throw std::runtime_error("Unsupported or invalid stereo I/Q WAV format");
    WavSignal result{rate, {}, center_hz};
    result.samples.resize(static_cast<std::size_t>(data_size / alignment));
    input.seekg(static_cast<std::streamoff>(data_offset));
    std::vector<unsigned char> buffer(65536 - 65536 % alignment);
    std::size_t index = 0;
    for (std::uint64_t remaining = data_size; remaining;) {
        const auto size = static_cast<std::size_t>(std::min<std::uint64_t>(remaining, buffer.size()));
        read(input, buffer.data(), size);
        for (std::size_t p = 0; p < size; p += alignment) {
            const auto component = [&](std::size_t position) {
                if (bits == 8) return (float(buffer[position]) - 128.0f) / 128.0f;
                if (bits == 16) return float(std::bit_cast<std::int16_t>(u16(buffer.data() + position))) / 32768.0f;
                return std::bit_cast<float>(u32(buffer.data() + position));
            };
            const float i = component(p), q = component(p + bits / 8);
            if (!std::isfinite(i) || !std::isfinite(q)) throw std::runtime_error("Non-finite WAV I/Q sample");
            result.samples[index++] = {i, q};
        }
        remaining -= size;
    }
    return result;
}
}
