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
