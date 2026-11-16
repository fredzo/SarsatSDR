#include "beacon.hpp"

#include <cstdlib>
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
}

int main() {
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
    expect(sgb, "Type", "System Beacon");
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
