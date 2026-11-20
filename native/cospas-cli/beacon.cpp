#include "beacon.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <string>

namespace cospas::cli {
namespace {

struct CountryEntry {
    int code;
    const char* alpha;
    const char* name;
};

constexpr CountryEntry countries[] = {
#include "beacon_countries.inc"
};

constexpr std::array<char, 64> baudot{' ', '5', ' ', '9', ' ', ' ', ' ', ' ', ' ', ' ', '4', ' ', '8', '0', ' ', ' ',
                                      '3', ' ', ' ', ' ', ' ', '6', ' ', '/', '-', '2', ' ', ' ', '7', '1', ' ', ' ',
                                      ' ', 'T', ' ', 'O', ' ', 'H', 'N', 'M', ' ', 'L', 'R', 'G', 'I', 'P', 'C', 'V',
                                      'E', 'Z', 'D', 'B', 'S', 'Y', 'F', 'X', 'A', 'W', 'J', ' ', 'U', 'Q', 'K', ' '};

std::string format(const char* pattern, auto... values) {
    char buffer[128];
    std::snprintf(buffer, sizeof(buffer), pattern, values...);
    return buffer;
}

std::string country(unsigned code) {
    const auto found = std::find_if(std::begin(countries), std::end(countries),
                                    [&](const CountryEntry& entry) { return entry.code == int(code); });
    return found == std::end(countries) ? format("UNK(%u) - Unknown country", code)
                                        : format("%s(%u) - %s", found->alpha, code, found->name);
}

class Bits {
public:
    Bits(std::string_view hex, std::size_t skip, std::size_t size) : bits_(size) {
        for (std::size_t n = 0; n < size; ++n) {
            const auto bit = n + skip;
            if (bit / 4 >= hex.size()) break;
            const char c = hex[bit / 4];
            const int nibble = c >= '0' && c <= '9' ? c - '0' : c >= 'A' && c <= 'F' ? c - 'A' + 10
                             : c >= 'a' && c <= 'f' ? c - 'a' + 10 : 0;
            bits_[n] = std::uint8_t((nibble >> (3 - bit % 4)) & 1);
        }
    }

    std::uint64_t operator()(int first, int last) const {
        std::uint64_t result = 0;
        for (int n = first; n <= last; ++n) result = result << 1 | bits_[std::size_t(n - 1)];
        return result;
    }

    std::uint8_t byte(int index) const { return std::uint8_t((*this)(index * 8 + 1, index * 8 + 8)); }

private:
    std::vector<std::uint8_t> bits_;
};

struct Angle {
    long degrees = 255;
    long minutes = 0;
    long seconds = 0;
    bool orientation = false;

    double value() const {
        const double result = degrees + double(minutes) / 60 + double(seconds) / 3600;
        return orientation ? -result : result;
    }
};

void apply_offset(Angle& angle, bool positive, long minutes, long seconds) {
    if (positive) {
        angle.minutes += minutes;
        angle.seconds += seconds;
        return;
    }
    angle.minutes -= minutes;
    if (angle.minutes < 0) {
        angle.minutes += 60;
        angle.degrees -= 1;
    }
    angle.seconds -= seconds;
    if (angle.seconds < 0) {
        angle.seconds += 60;
        angle.minutes -= 1;
    }
}

enum class Kind { user, standard, national, rls, elt_dt, spare };

struct Protocol {
    Kind kind;
    const char* description;
    const char* title;
    const char* type;
};

Protocol fgb_protocol(bool long_frame, bool user, unsigned code) {
    if (!long_frame || user) {
        constexpr std::array<Protocol, 8> table{{
            {Kind::user, "Orbitography Protocol", "Orbitography 406", "ORB"},
            {Kind::user, "ELT - Aviation", nullptr, "ELT"},
            {Kind::user, "EPIRB - Maritime", nullptr, "EPIRB"},
            {Kind::user, "Serial User Protocol", "Serial 406", "SRIAL"},
            {Kind::user, "National User Protocol", "National 406", "NAT"},
            {Kind::user, "2nd Generation Beacons", nullptr, "2G"},
            {Kind::user, "EPIRB - Radio Call Sign", nullptr, "EPIRB"},
            {Kind::user, "Test User Protocol", "User Test 406", "TEST"},
        }};
        return table[code & 7];
    }
    constexpr std::array<Protocol, 16> table{{
        {Kind::spare, "Spare", "Spare 406", "Unk."},
        {Kind::spare, "Spare", "Spare 406", "Unk."},
        {Kind::standard, "EPIRB - MMSI / Location", nullptr, "EPIRB"},
        {Kind::standard, "ELT-24-bit Address / Location", nullptr, "ELT"},
        {Kind::standard, "ELT Serial Location", nullptr, "ELT"},
        {Kind::standard, "ELT Serial Aircraft Location", nullptr, "ELT"},
        {Kind::standard, "EPIRB Serial Location", nullptr, "EPIRB"},
        {Kind::standard, "PLB Serial Location", nullptr, "PLB"},
        {Kind::national, "ELT National Location", nullptr, "ELT"},
        {Kind::elt_dt, "ELT(DT) Location Protocol", nullptr, "ELT"},
        {Kind::national, "EPIRB National Location", nullptr, "EPIRB"},
        {Kind::national, "PLB National Location", nullptr, "PLB"},
        {Kind::standard, "Ship Security Location", nullptr, "SHIP"},
        {Kind::rls, "RLS Location Protocol", nullptr, "RLS"},
        {Kind::standard, "Test Standard Location", "Test Std. 406", "TEST"},
        {Kind::national, "Test National Location", "Test Nat. 406", "TEST"},
    }};
    return table[code & 15];
}

constexpr std::array<const char*, 8> sgb_beacon_types{"ELT", "EPIRB", "PLB", "ELT(DT)", "Spare", "Spare", "Spare",
                                                       "SYSTM"};

const char* protocol_name(Kind kind, bool long_frame) {
    switch (kind) {
    case Kind::standard: return "Standard Protocol";
    case Kind::national: return "National Protocol";
    case Kind::rls: return "RLS";
    case Kind::elt_dt: return "ELT(DT)";
    case Kind::user: return long_frame ? "User Location Protocol" : "User Protocol";
    default: return "Spare Protocol";
    }
}

std::string serial(std::uint64_t value) {
    return format("%llu (0x%llX)", static_cast<unsigned long long>(value), static_cast<unsigned long long>(value));
}

std::vector<BeaconField> describe_fgb(std::string_view hex, bool self_test) {
    const Bits bits(hex, 0, 144);
    std::vector<BeaconField> fields;
    const auto add = [&](const char* section, const char* name, std::string value) {
        fields.push_back({section, name, std::move(value)});
    };
    const bool long_frame = bits(25, 25);
    const bool user = bits(26, 26);
    const unsigned code = unsigned(user ? bits(37, 39) : bits(37, 40));
    const auto protocol = fgb_protocol(long_frame, user, code);
    const bool orbito = protocol.kind == Kind::user && (code & 7) == 0;
    bool maritime = protocol.kind == Kind::user && ((code & 7) == 2 || (code & 7) == 6);

    add("Identification", "Frame Mode", self_test ? "Self-test" : "Normal");
    add("Identification", "Title", self_test ? "Self-test 406" : protocol.title ? protocol.title : "Distress 406");
    add("Identification", "Frame", long_frame ? "Long (144 bits)" : "Short (112 bits)");
    add("Identification", "Protocol", format("%s (%u)", protocol_name(protocol.kind, long_frame), code));
    add("Identification", "Protocol Description", protocol.description);

    Angle latitude, longitude;
    if (long_frame) {
        const auto b = [&](int index) { return long(bits.byte(index)); };
        if (protocol.kind == Kind::user && !orbito) {
            latitude.orientation = (b(13) & 0x10) >> 4;
            latitude.degrees = ((b(13) & 0x0F) << 3 | (b(14) & 0xE0) >> 5);
            latitude.minutes = ((b(14) & 0x1E) >> 1) * 4;
            longitude.orientation = b(14) & 0x01;
            longitude.degrees = b(15);
            longitude.minutes = ((b(16) & 0xF0) >> 4) * 4;
        } else if (protocol.kind == Kind::national) {
            latitude.orientation = (b(7) & 0x20) >> 5;
            latitude.degrees = ((b(7) & 0x1F) << 2 | (b(8) & 0xC0) >> 6);
            latitude.minutes = ((b(8) & 0x3E) >> 1) * 2;
            apply_offset(latitude, (b(14) & 0x80) >> 7, (b(14) & 0x60) >> 5, ((b(14) & 0x1E) >> 1) * 4);
            longitude.orientation = b(8) & 0x01;
            longitude.degrees = b(9);
            longitude.minutes = ((b(10) & 0xF8) >> 3) * 2;
            apply_offset(longitude, b(14) & 0x01, (b(15) & 0xC0) >> 6, ((b(15) & 0x3C) >> 2) * 4);
        } else if (protocol.kind == Kind::standard) {
            latitude.orientation = (b(8) & 0x80) >> 7;
            latitude.degrees = b(8) & 0x7F;
            latitude.minutes = ((b(9) & 0xC0) >> 6) * 15;
            apply_offset(latitude, (b(14) & 0x80) >> 7, (b(14) & 0x7C) >> 2,
                         ((b(14) & 0x03) << 2 | (b(15) & 0xC0) >> 6) * 4);
            longitude.orientation = (b(9) & 0x20) >> 5;
            longitude.degrees = ((b(9) & 0x1F) << 3 | (b(10) & 0xE0) >> 5);
            longitude.minutes = ((b(10) & 0x18) >> 3) * 15;
            apply_offset(longitude, (b(15) & 0x20) >> 5, b(15) & 0x1F, ((b(16) & 0xF0) >> 4) * 4);
        } else if (protocol.kind == Kind::rls || protocol.kind == Kind::elt_dt) {
            latitude.orientation = (b(8) & 0x20) >> 5;
            latitude.degrees = ((b(8) & 0x1F) << 2) | ((b(9) & 0xC0) >> 6);
            latitude.minutes = ((b(9) & 0x20) >> 5) * 30;
            apply_offset(latitude, (b(14) & 0x20) >> 5, (b(14) & 0x1E) >> 1,
                         ((b(14) & 0x01) << 3 | (b(15) & 0xE0) >> 5) * 4);
            longitude.orientation = (b(9) & 0x10) >> 4;
            longitude.degrees = ((b(9) & 0x0F) << 4 | (b(10) & 0xF0) >> 4);
            longitude.minutes = ((b(10) & 0x08) >> 3) * 30;
            apply_offset(longitude, (b(15) & 0x10) >> 4, b(15) & 0x0F, ((b(16) & 0xF0) >> 4) * 4);
        }
    }

    std::string additional, serial_number, emergency, emergency_mode;
    if (user) {
        if (code == 0b011) {
            const auto type = unsigned(bits(40, 42));
            constexpr std::array<const char*, 8> names{"ELTs/serial identification number", "ELTs/aircraft operator & serial #",
                                                       "Float free EPIRBs/serial #", "ELTs with aircraft 24-bit address",
                                                       "Non float free EPIRBs/serial #", nullptr, "PLBs/serial identification #",
                                                       nullptr};
            if (names[type]) additional = names[type];
            if (type == 0b010) maritime = true;
            serial_number = serial(type == 0b011 ? bits(44, 67) : type == 0b001 ? bits(62, 73) : bits(44, 63));
        }
        if (!long_frame && bits(107, 107)) {
            emergency_mode = bits(108, 108) ? "auto" : "manual";
            if (maritime) {
                constexpr std::array<const char*, 9> names{"Unspecified distress", "Fire/explosion", "Flooding", "Collision",
                                                           "Grounding", "Danger of capsizing", "Sinking",
                                                           "Disabled and adrift", "Abandoning ship"};
                const auto value = unsigned(bits(109, 112));
                emergency = names[value < names.size() ? value : 0];
            } else {
                const bool fire = bits(109, 109), medical = bits(110, 110), disabled = bits(111, 111);
                if (fire) emergency = "Fire";
                if (medical) emergency += std::string(fire ? "+" : "") + "Medical";
                if (disabled) emergency += std::string(fire || medical ? "+" : "") + "Disabled";
            }
        }
    } else if (long_frame) {
        switch (code) {
        case 0b0010: serial_number = serial(bits(61, 64)); break;
        case 0b1100: {
            const auto mmsi = unsigned(bits(41, 60));
            additional = format("MMSI=%X MID=%u", mmsi, mmsi);
            break;
        }
        case 0b0011:
            serial_number = serial(bits(41, 64));
            additional = "24 bits aircraft address";
            break;
        case 0b0100:
        case 0b0110:
        case 0b0111:
            additional = format("C/S TA #=%u", unsigned(bits(41, 50)));
            serial_number = serial(bits(51, 64));
            break;
        case 0b0101:
            additional = std::string("Op Design.=") + baudot[bits(41, 45) + 32] + baudot[bits(46, 50) + 32] +
                         baudot[bits(51, 55) + 32];
            serial_number = serial(bits(56, 64));
            break;
        case 0b1000:
        case 0b1010:
        case 0b1011:
        case 0b1111:
            serial_number = serial(bits(41, 58));
            additional = format("National data=%u", unsigned(bits(127, 132)));
            break;
        }
    }
    if (!additional.empty()) add("Identification", "Additional Data", additional);
    add("Identification", "Country", country(unsigned(bits(27, 36))));

    const auto identifier = bits(26, 85);
    auto high = std::uint32_t(identifier >> 32), low = std::uint32_t(identifier);
    if (protocol.kind == Kind::standard) low = (low & 0xFFE00000u) | 0x000FFBFFu;
    else if (protocol.kind == Kind::national) low = (low & 0xF8000000u) | 0x03F81FE0u;
    else if (protocol.kind == Kind::rls || protocol.kind == Kind::elt_dt) low = (low & 0xFFF80000u) | 0x0003FDFFu;
    add("Identification", "Hex ID", format("%07X%08X", high, low));
    if (!serial_number.empty()) add("Identification", "Serial Number", serial_number);
    if (!emergency_mode.empty()) {
        add("Emergency", "Emergency", emergency);
        add("Emergency", "Emergency Mode", emergency_mode);
    }

    if (latitude.degrees >= 255 || longitude.degrees >= 255) {
        add("Location", "Position", "GPS not synchronized");
    } else {
        add("Location", "Latitude", format("%.6f", latitude.value()));
        add("Location", "Longitude", format("%.6f", longitude.value()));
        add("Location", "Position", format("%ld\xC2\xB0%02ld'%02ld\"%c, %ld\xC2\xB0%02ld'%02ld\"%c", latitude.degrees,
                                           latitude.minutes, latitude.seconds, latitude.orientation ? 'S' : 'N',
                                           longitude.degrees, longitude.minutes, longitude.seconds,
                                           longitude.orientation ? 'W' : 'E'));
    }

    const bool std_or_nat = protocol.kind == Kind::standard || protocol.kind == Kind::national;
    if (std_or_nat) add("Devices", "Main Locating Device", bits(111, 111) ? "Internal" : "External");
    else if (protocol.kind == Kind::user || protocol.kind == Kind::rls)
        add("Devices", "Main Locating Device", bits(107, 107) ? "Internal" : "External");
    if (std_or_nat) add("Devices", "Auxiliary Locating Device", bits(112, 112) ? "121.5 MHz" : "Other or no device");
    else if (protocol.kind == Kind::rls)
        add("Devices", "Auxiliary Locating Device", bits(108, 108) ? "121.5 MHz" : "Other or no device");
    else if (protocol.kind == Kind::user && code != 0b100) {
        constexpr std::array<const char*, 4> names{"No device", "121.5 MHz", "Maritime locating: 9 GHz SART", "Other device"};
        add("Devices", "Auxiliary Locating Device", names[bits(84, 85)]);
    }
    return fields;
}

std::string baudot_text(const Bits& bits, int first, int count, int width) {
    std::string result;
    for (int n = 0; n < count; ++n) {
        const auto value = bits(first + n * width, first + n * width + width - 1);
        result += baudot[width == 5 ? value + 32 : value];
    }
    return result;
}

std::string altitude(std::uint64_t value) {
    return value == 1023 ? "Not available" : format("%d m", -400 + 16 * int(value));
}

std::string dop(std::uint64_t value) {
    constexpr std::array<const char*, 16> names{"DOP \xE2\x89\xA4" "1", "DOP >1 and \xE2\x89\xA4" "2",
                                                "DOP >2 and \xE2\x89\xA4" "3", "DOP >3 and \xE2\x89\xA4" "4",
                                                "DOP >4 and \xE2\x89\xA4" "5", "DOP >5 and \xE2\x89\xA4" "6",
                                                "DOP >6 and \xE2\x89\xA4" "7", "DOP >7 and \xE2\x89\xA4" "8",
                                                "DOP >8 and \xE2\x89\xA4" "10", "DOP >10 and \xE2\x89\xA4" "12",
                                                "DOP >12 and \xE2\x89\xA4" "15", "DOP >15 and \xE2\x89\xA4" "20",
                                                "DOP >20 and \xE2\x89\xA4" "30", "DOP >30 and \xE2\x89\xA4" "50",
                                                "DOP >50", "DOP not available"};
    return names[value & 15];
}

const char* gnss(std::uint64_t value) {
    constexpr std::array<const char*, 4> names{"No fix", "2D location", "3D location", "Reserved"};
    return names[value & 3];
}

std::vector<BeaconField> describe_sgb(std::string_view hex, bool self_test) {
    const Bits bits(hex, 2, 250);
    std::vector<BeaconField> fields;
    const auto add = [&](const char* section, const char* name, std::string value) {
        fields.push_back({section, name, std::move(value)});
    };
    const auto tac = bits(1, 16), number = bits(17, 30), country_code = bits(31, 40);
    const auto vessel_type = unsigned(bits(91, 93));
    const auto beacon_type = unsigned(bits(138, 140));
    auto vessel_id = bits(94, 137);
    if (vessel_type == 0b100) vessel_id &= ~std::uint64_t(0xFFFFF);
    const std::uint64_t hex_high = 1ull << 27 | country_code << 17 | 0b101ull << 14 | tac >> 2;
    const std::uint64_t hex_low = (tac & 3) << 62 | number << 48 | bits(43, 43) << 47 | std::uint64_t(vessel_type) << 44 |
                                  vessel_id;
    add("Identification", "Frame Mode", self_test ? "Self-test" : "Normal");
    add("Identification", "23 Hex ID", format("%07llX%016llX", static_cast<unsigned long long>(hex_high),
                                               static_cast<unsigned long long>(hex_low)));
    add("Identification", "TAC Number", format("%llu (0x%04llX)", static_cast<unsigned long long>(tac),
                                                static_cast<unsigned long long>(tac)));
    add("Identification", "Serial Number", format("%llu (0x%04llX)", static_cast<unsigned long long>(number),
                                                   static_cast<unsigned long long>(number)));
    add("Identification", "Country", country(unsigned(country_code)));
    add("Identification", "Type", sgb_beacon_types[beacon_type]);
    switch (vessel_type) {
    case 0b000: add("Identification", "Vessel ID", "None"); break;
    case 0b001: {
        const auto ais = bits(124, 137);
        add("Identification", "Vessel ID", "MMSI");
        add("Identification", "MMSI", format("%09llu", static_cast<unsigned long long>(bits(94, 123))));
        add("Identification", "EPIRB-AIS", ais == 10922 ? "None" : format("%04llu", static_cast<unsigned long long>(ais)));
        break;
    }
    case 0b010:
        add("Identification", "Vessel ID", "Radio Call Sign");
        add("Identification", "Call Sign", baudot_text(bits, 94, 7, 6));
        break;
    case 0b011:
        add("Identification", "Vessel ID", "Aircraft Registration Marking");
        add("Identification", "Tail Number", baudot_text(bits, 94, 7, 6));
        break;
    case 0b100:
        add("Identification", "Vessel ID", "Aircraft 24-bit Address");
        add("Identification", "Aircraft Address", format("%06llX", static_cast<unsigned long long>(bits(94, 117))));
        if (bits(118, 132)) add("Identification", "Operator", baudot_text(bits, 118, 3, 5));
        break;
    case 0b101:
        add("Identification", "Vessel ID", "Aircraft Operator and Serial Number");
        add("Identification", "Operator", baudot_text(bits, 94, 3, 5));
        add("Identification", "Operator Serial", format("%llu", static_cast<unsigned long long>(bits(109, 120))));
        break;
    case 0b110: add("Identification", "Vessel ID", "Spare"); break;
    default: add("Identification", "Vessel ID", "Reserved Type"); break;
    }

    add("Status", "Homing Device", bits(41, 41) ? "Enabled" : "Not Available/Disabled");
    add("Status", "RLS Capability", bits(42, 42) ? "Enabled" : "Disabled");
    add("Status", "Test Protocol", bits(43, 43) ? "Active (Non-operational)" : "Normal operation");
    const auto spare = bits(141, 154);
    add("Status", "Spare Bits", spare == 0 ? "Cancellation (all 0)" : spare == 0x3FFF ? "Normal (all 1)"
                                                                         : format("0x%04llX", static_cast<unsigned long long>(spare)));

    const auto lat_degrees = bits(45, 51), lon_degrees = bits(68, 75);
    if (lat_degrees > 90 || lon_degrees > 180) {
        add("Encoded GNSS Location", "Position", "Not available");
    } else {
        const double latitude = double(lat_degrees) + double(bits(52, 66)) / 32768;
        const double longitude = double(lon_degrees) + double(bits(76, 90)) / 32768;
        add("Encoded GNSS Location", "Latitude", format("%.6f", bits(44, 44) ? -latitude : latitude));
        add("Encoded GNSS Location", "Longitude", format("%.6f", bits(67, 67) ? -longitude : longitude));
        add("Encoded GNSS Location", "Position", format("%.5f\xC2\xB0%c, %.5f\xC2\xB0%c", latitude,
                                                        bits(44, 44) ? 'S' : 'N', longitude, bits(67, 67) ? 'W' : 'E'));
    }

    const auto rotating = unsigned(bits(155, 158));
    const auto section = "Rotating Field " + std::to_string(rotating);
    const auto rot = [&](const char* name, std::string value) { fields.push_back({section, name, std::move(value)}); };
    switch (rotating) {
    case 0: {
        rot("Type", "G.008 Objective Requirements");
        rot("Elapsed Time", format("%llu hours", static_cast<unsigned long long>(bits(159, 164))));
        const auto last = bits(165, 175);
        rot("Last Position", last == 2047 ? "Not available" : format("%llu minutes ago", static_cast<unsigned long long>(last)));
        rot("Altitude", altitude(bits(176, 185)));
        rot("HDOP", dop(bits(186, 189)));
        rot("VDOP", dop(bits(190, 193)));
        constexpr std::array<const char*, 4> activation{"Manual activation by user", "Automatic activation by beacon",
                                                        "Automatic activation by external means", "Spare"};
        rot("Activation", activation[bits(194, 195)]);
        constexpr std::array<const char*, 8> battery{"<=5% remaining", ">5% and <=10% remaining",
                                                     ">10% and <=25% remaining", ">25% and <=50% remaining",
                                                     ">50% and <=75% remaining", ">75% and <=100% remaining",
                                                     "Reserved", "Battery capacity not available"};
        rot("Battery", battery[bits(196, 198)]);
        rot("GNSS Status", gnss(bits(199, 200)));
        break;
    }
    case 1: {
        rot("Type", "ELT(DT) In-Flight Emergency");
        const auto time = bits(159, 175);
        rot("Time of Last Location", time == 0x1FFFF ? "Not available"
                                     : format("%02llu:%02llu:%02llu UTC", static_cast<unsigned long long>(time / 3600),
                                              static_cast<unsigned long long>(time / 60 % 60),
                                              static_cast<unsigned long long>(time % 60)));
        rot("Altitude", altitude(bits(176, 185)));
        const auto trigger = bits(186, 189);
        rot("Triggering Event", trigger == 0b0001 ? "Manual activation by the crew"
                                : trigger == 0b0100 ? "G-switch/Deformation activation"
                                : trigger == 0b1000 ? "Automatic activation from avionics or triggering system"
                                                    : "Spare");
        rot("GNSS Status", gnss(bits(190, 191)));
        constexpr std::array<const char*, 4> battery{"<=33% remaining", ">33% and <=66% remaining", ">66% remaining",
                                                     "Battery capacity not available"};
        rot("Battery", battery[bits(192, 193)]);
        break;
    }
    case 2: {
        rot("Type", "RLS");
        rot("RLM Type-1 Accepted", bits(161, 161) ? "Yes" : "No");
        rot("RLM Type-2 Accepted", bits(162, 162) ? "Yes" : "No");
        const auto provider = bits(167, 169);
        rot("RLS Provider", provider == 0b001 ? "Galileo" : provider == 0b010 ? "GLONASS" : "Spare");
        rot("RLM Type-1 Received", bits(170, 170) ? "Yes" : "No");
        rot("RLM Type-2 Received", bits(171, 171) ? "Yes" : "No");
        rot("RLM", format("0x%05llX", static_cast<unsigned long long>(bits(172, 191))));
        break;
    }
    case 3:
        rot("Type", "National Use");
        rot("Data", format("0x%011llX", static_cast<unsigned long long>(bits(159, 202))));
        break;
    case 15: {
        rot("Type", "Cancellation Message");
        const auto method = bits(201, 202);
        rot("Deactivation", method == 0b10 ? "Manual de-activation by user"
                            : method == 0b01 ? "Automatic de-activation by external means" : "Spare");
        break;
    }
    default:
        rot("Type", "Spare");
        break;
    }
    return fields;
}

}

std::vector<BeaconField> describe_beacon(std::string_view corrected_hex, unsigned generation, bool self_test) {
    return generation == 2 ? describe_sgb(corrected_hex, self_test) : describe_fgb(corrected_hex, self_test);
}

std::string_view beacon_type(std::string_view corrected_hex, unsigned generation) {
    if (generation == 2) {
        const Bits bits(corrected_hex, 2, 250);
        return sgb_beacon_types[bits(138, 140)];
    }
    const Bits bits(corrected_hex, 0, 144);
    const bool long_frame = bits(25, 25);
    const bool user = bits(26, 26);
    const auto code = unsigned(user ? bits(37, 39) : bits(37, 40));
    if (!long_frame && !user && code > 7) return "Unk.";
    return fgb_protocol(long_frame, user, code).type;
}

}
