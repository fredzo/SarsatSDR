#pragma once

#include <cospas/decoder.hpp>
#include <filesystem>

namespace cospas {
struct WavSignal {
    std::uint32_t sample_rate_hz{};
    std::vector<Sample> samples;
};
WavSignal read_wav(const std::filesystem::path& path);
}
