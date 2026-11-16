#pragma once

#include <cmath>
#include <complex>
#include <cstddef>
#include <stdexcept>

namespace cospas {

class FrontendMixer {
public:
    explicit FrontendMixer(float frequency_hz) : conjugate_(frequency_hz >= 0) {
        if (!std::isfinite(frequency_hz) || std::abs(frequency_hz) >= 230400)
            throw std::invalid_argument("Frontend mixer frequency must be finite and inside +/-230400 Hz");
        const auto angular = static_cast<float>(frequency_hz * 2.0L * pi / 460800.0L);
        const auto normalized = static_cast<float>(std::abs(static_cast<long double>(angular) / (2 * pi)));
        step_ = double(normalized) * 2 * double(pi);
    }
    void reset() noexcept { phase_ = 0; position_ = 0; }
    std::complex<float> process(std::complex<float> value) noexcept {
        if (step_ == 0) return value;
        const double angle = double(phase_) + double(position_) * step_;
        const float real = static_cast<float>(std::cos(angle));
        const float imag = static_cast<float>(std::sin(angle)) * (conjugate_ ? -1.0f : 1.0f);
        if (++position_ == 3200) {
            // Carry float phase between fixed internal blocks, not caller chunks.
            phase_ = static_cast<float>(std::fmod(double(phase_) + 3200 * step_, 2 * double(pi)));
            position_ = 0;
        }
        return value * std::complex<float>{real, imag};
    }
private:
    static constexpr long double pi = 3.141592653589793238462643383279502884L;
    double step_{};
    float phase_{};
    std::size_t position_{};
    bool conjugate_;
};

}
