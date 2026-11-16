#pragma once

#include <array>
#include <complex>
#include <cstdint>
#include <functional>
#include <memory>
#include <span>

namespace cospas::cli {

class Spectrum {
public:
    using Line = std::array<float, 1024>;
    using Callback = std::function<void(const Line&, double)>;
    Spectrum(std::uint32_t rate, double source_center_hz, Callback callback, double dsp_center_hz = 406050000);
    ~Spectrum();
    void push(std::span<const std::complex<float>> input);
    void push_cu8(std::span<const std::uint8_t> input);
private:
    void sample(std::complex<float> value);
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

float spectrum_display_offset_db(std::size_t gain_index);
bool stop_requested();
#ifdef COSPAS_CLI_EMBEDDED
void set_stop_requested(bool value);
#endif

}
