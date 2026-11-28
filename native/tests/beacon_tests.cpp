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

#include "beacon.hpp"

#include <cstdlib>
#include <array>
#include <iostream>
#include <string>

namespace {
int failures = 0;

std::string field(const std::vector<cospas::cli::BeaconField>& fields, const std::string& name) {
    for (const auto& item : fields)
        if (item.name == name) return item.value;
    return "<missing>";
}

void expect(const std::vector<cospas::cli::BeaconField>& fields, const std::string& name, const std::string& value) {
    const auto actual = field(fields, name);
    if (actual == value) return;
    std::cerr << name << ": expected '" << value << "' got '" << actual << "'\n";
    ++failures;
}

void set_bits(std::string& hex, int first, int last, unsigned value) {
    constexpr char digits[] = "0123456789ABCDEF";
    for (int bit = first; bit <= last; ++bit) {
        const auto index = std::size_t((bit - 1) / 4);
        const auto mask = 1u << (3 - (bit - 1) % 4);
        auto nibble = unsigned(hex[index] <= '9' ? hex[index] - '0' : hex[index] - 'A' + 10);
        nibble = (value & (1u << (last - bit))) ? nibble | mask : nibble & ~mask;
        hex[index] = digits[nibble];
    }
}

void expect_type(std::string_view hex, unsigned generation, std::string_view expected) {
    const auto actual = cospas::cli::beacon_type(hex, generation);
    if (actual == expected) return;
    std::cerr << "Beacon type: expected '" << expected << "' got '" << actual << "'\n";
    ++failures;
}
}

int main() {
    constexpr std::array user_types{"ORB", "ELT", "EPIRB", "SRIAL", "NAT", "2G", "EPIRB", "TEST"};
    constexpr std::array location_types{"Unk.", "Unk.", "EPIRB", "ELT", "ELT", "ELT", "EPIRB", "PLB",
                                        "ELT", "ELT", "EPIRB", "PLB", "SHIP", "RLS", "TEST", "TEST"};
    for (unsigned n = 0; n < user_types.size(); ++n) {
        std::string hex(36, '0');
        set_bits(hex, 25, 26, 3);
        set_bits(hex, 37, 39, n);
        expect_type(hex, 1, user_types[n]);
    }
    for (unsigned n = 0; n < location_types.size(); ++n) {
        std::string hex(36, '0');
        set_bits(hex, 25, 25, 1);
        set_bits(hex, 37, 40, n);
        expect_type(hex, 1, location_types[n]);
    }
    std::string short_frame(36, '0');
    set_bits(short_frame, 37, 40, 8);
    expect_type(short_frame, 1, "Unk.");
    constexpr std::array sgb_types{"ELT", "EPIRB", "PLB", "ELT(DT)", "Spare", "Spare", "Spare", "SYSTM"};
    for (unsigned n = 0; n < sgb_types.size(); ++n) {
        std::string hex(63, '0');
        set_bits(hex, 140, 142, n);
        expect_type(hex, 2, sgb_types[n]);
    }
    const auto fgb = cospas::cli::describe_beacon("FFFED08E320000002B802C8C053698EC7F97", 1, true);
    expect(fgb, "Frame Mode", "Self-test");
    expect(fgb, "Protocol", "Standard Protocol (2)");
    expect(fgb, "Protocol Description", "EPIRB - MMSI / Location");
    expect(fgb, "Country", "FRA(227) - France");
    expect(fgb, "Hex ID", "1C64000000FFBFF");
    expect(fgb, "Latitude", "43.603333");
    expect(fgb, "Longitude", "1.457778");
    expect(fgb, "Main Locating Device", "Internal");

    const auto orbito = cospas::cli::describe_beacon("FFFED0CE410D3A497539805A100E5A1EDA04", 1, true);
    expect(orbito, "Protocol Description", "Orbitography Protocol");
    expect(orbito, "Hex ID", "9C821A7492EA730");
    expect(orbito, "Position", "GPS not synchronized");

    const auto sgb = cospas::cli::describe_beacon("3FFFE1A738C95C7BE00BD8BE00000000001FFFF0FFFF7FFFEF0470400A448FD", 2, false);
    expect(sgb, "23 Hex ID", "9C77FFFE1A7F00000000000");
    expect(sgb, "TAC Number", "65535 (0xFFFF)");
    expect(sgb, "Serial Number", "8615 (0x21A7)");
    expect(sgb, "Country", "FRA(227) - France");
    expect(sgb, "Type", "SYSTM");
    expect(sgb, "Vessel ID", "Reserved Type");
    expect(sgb, "Test Protocol", "Active (Non-operational)");
    expect(sgb, "Position", "43.56049\xC2\xB0N, 1.48080\xC2\xB0" "E");
    expect(sgb, "Elapsed Time", "63 hours");
    expect(sgb, "Last Position", "2046 minutes ago");
    expect(sgb, "Altitude", "Not available");
    expect(sgb, "HDOP", "DOP not available");
    expect(sgb, "GNSS Status", "No fix");

    const auto spec = cospas::cli::describe_beacon("0039823D32618658622811F0000000000003FFF004030680258000000000000", 2, false);
    expect(spec, "23 Hex ID", "9934039823D000000000000");
    expect(spec, "Position", "48.79315\xC2\xB0N, 69.00876\xC2\xB0" "E");
    expect(spec, "Type", "ELT");
    expect(spec, "Elapsed Time", "1 hours");
    expect(spec, "Last Position", "6 minutes ago");
    expect(spec, "Altitude", "432 m");
    expect(spec, "VDOP", "DOP >1 and \xE2\x89\xA4" "2");
    expect(spec, "Battery", ">75% and <=100% remaining");
    expect(spec, "GNSS Status", "3D location");
    return failures ? EXIT_FAILURE : EXIT_SUCCESS;
}
