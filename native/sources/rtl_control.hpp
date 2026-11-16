#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>

namespace cospas {

inline constexpr std::size_t rtl_block_samples = 6400;

class RtlRegisterIo {
public:
    virtual ~RtlRegisterIo() = default;
    // Return zero on success, a negative transport error otherwise. Successful writes update the cache.
    virtual int set_i2c_repeater(bool enabled) noexcept = 0;
    virtual int read_cached_tuner_register(std::uint8_t address, std::uint8_t& value) noexcept = 0;
    virtual int write_tuner_register(std::uint8_t address, std::uint8_t value) noexcept = 0;
};

struct RtlAgcSettings {
    int delay_blocks{20};
    int clipping_samples{150};
};

struct RtlAgcObservation {
    std::uint32_t clipped_samples{};
    std::uint8_t positive_level{};
    bool clipped{};
    bool gain_changed{};
};

class RtlFrontendControl {
public:
    RtlFrontendControl(RtlRegisterIo& io, int initial_gain_index, RtlAgcSettings settings = {});
    RtlFrontendControl(const RtlFrontendControl&) = delete;
    RtlFrontendControl& operator=(const RtlFrontendControl&) = delete;
    void set_gain(int index);
    std::optional<int> gain_index() const noexcept;
    void set_automatic_gain(bool enabled) noexcept;
    RtlAgcObservation process_cu8(std::span<const std::uint8_t> iq);
private:
    RtlRegisterIo& io_;
    RtlAgcSettings settings_;
    std::optional<int> gain_index_;
    int delay_counter_{};
    bool automatic_gain_{true};
};

}
