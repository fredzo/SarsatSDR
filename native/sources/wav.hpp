#pragma once

#include <cospas/decoder.hpp>
#include <filesystem>
#include <optional>

namespace cospas {
struct WavSignal {
    std::uint32_t sample_rate_hz{};
    std::vector<Sample> samples;
    std::optional<std::uint32_t> center_hz;
};
WavSignal read_wav(const std::filesystem::path& path);
}
