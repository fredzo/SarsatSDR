#pragma once

#include <complex>
#include <cstdio>
#include <cstdint>
#include <mutex>
#include <span>
#include <string>
#include <vector>

namespace cospas {

class IqRecorder {
public:
    ~IqRecorder();
    void configure(std::uint32_t rate, double mixer_hz, std::uint32_t center_hz);
    // Takes ownership of the stream, including when starting fails.
    void start(std::FILE* file);
    void push(std::span<const std::uint8_t> iq);
    void stop();
    void finish_session();
private:
    void stop_locked();
    std::mutex mutex_;
    std::FILE* file_{};
    bool available_{};
    std::uint32_t rate_{}, center_hz_{}, data_bytes_{};
    std::complex<double> oscillator_{1, 0}, step_{1, 0};
    std::uint64_t samples_{};
    std::vector<std::uint8_t> header_;
    std::string failure_;
};

IqRecorder& iq_recorder();

}
