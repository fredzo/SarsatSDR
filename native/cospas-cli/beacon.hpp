#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace cospas::cli {

struct BeaconField {
    std::string section;
    std::string name;
    std::string value;
};

std::vector<BeaconField> describe_beacon(std::string_view corrected_hex, unsigned generation, bool self_test);
std::string_view beacon_type(std::string_view corrected_hex, unsigned generation);

}
