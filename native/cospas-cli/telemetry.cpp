#include "telemetry.hpp"
#include "dsp_tables.hpp"

#include <fftw3.h>
#include <algorithm>
#include <atomic>
#include <bit>
#include <cmath>
#include <numbers>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <poll.h>
#include <unistd.h>
#endif

namespace cospas::cli {
struct Spectrum::Impl {
    Impl(std::uint32_t sample_rate, double frequency, Callback sink, double dsp_center)
        : rate(sample_rate), center(frequency), display_start(dsp_center - 50000), callback(std::move(sink)),
          size(std::bit_ceil(static_cast<unsigned>(std::ceil(double(rate) / 56.25)))),
          ring(size), input(size), output(size), window(size), response_db(size), bandwidth_response(size) {
        for (std::size_t n = 0; n < size / 2; ++n) {
            const double phase = 4 * std::numbers::pi * double(n) / double(size);
            window[n] = static_cast<float>(2 * (.42 - .5 * std::cos(phase) + .08 * std::cos(2 * phase)));
            window_sum += window[n];
        }
        const auto response = [](const auto& taps, double frequency_hz, double sample_rate_hz) {
            std::complex<double> sum{};
            for (std::size_t n = 0; n < taps.size(); ++n)
                sum += double(taps[n]) * std::polar(1.0, -2 * std::numbers::pi * frequency_hz * double(n) / sample_rate_hz);
            return std::abs(sum);
        };
        for (std::size_t n = 0; n < size; ++n) {
            const double offset = (n < size / 2 ? double(n) : double(n) - double(size)) * rate / double(size);
            const double gain = response(dsp_tables::rtl_frontend_fir_1, offset, 921600) *
                response(dsp_tables::rtl_frontend_fir_2, center + offset - dsp_center, 460800);
            response_db[n] = float(20 * std::log10(std::max(1e-12, gain)));
            if (std::abs(center + offset - dsp_center) < 57600)
                bandwidth_response[n] = float(gain * gain);
        }
        plan = fftwf_plan_dft_1d(static_cast<int>(size),
            reinterpret_cast<fftwf_complex*>(input.data()), reinterpret_cast<fftwf_complex*>(output.data()),
            FFTW_FORWARD, FFTW_ESTIMATE);
        if (!plan) throw std::runtime_error("Cannot create UI spectrum FFT plan");
    }
    ~Impl() { fftwf_destroy_plan(plan); }
    std::uint32_t rate;
    double center;
    double display_start;
    Callback callback;
    std::size_t size;
    std::vector<std::complex<float>> ring, input, output;
    std::vector<float> window, response_db, bandwidth_response;
    float window_sum{};
    fftwf_plan plan{};
    std::uint64_t received{};
};

Spectrum::Spectrum(std::uint32_t rate, double center, Callback callback, double dsp_center) {
    if (rate < 76800 || rate > 10000000 || !std::isfinite(center) || !std::isfinite(dsp_center) || !callback)
        throw std::invalid_argument("Invalid UI spectrum configuration");
    impl_ = std::make_unique<Impl>(rate, center, std::move(callback), dsp_center);
}
Spectrum::~Spectrum() = default;
void Spectrum::push(std::span<const std::complex<float>> input) {
    for (const auto value : input) sample(value);
}
void Spectrum::push_cu8(std::span<const std::uint8_t> input) {
    if (input.size() % 2) throw std::invalid_argument("Incomplete spectrum I/Q pair");
    for (std::size_t n = 0; n < input.size(); n += 2)
        sample({(float(input[n]) - 128) / 128, (float(input[n + 1]) - 128) / 128});
}
void Spectrum::sample(std::complex<float> value) {
    auto& s = *impl_;
    s.ring[std::size_t(s.received++ % s.size)] = value;
    if (s.received < s.size || s.received % (s.rate / 10) != 0) return;
    for (std::size_t n = 0; n < s.size; ++n)
        s.input[n] = s.ring[std::size_t((s.received + n) % s.size)] * s.window[n];
    fftwf_execute(s.plan);
    double bandwidth_power = 0;
    for (std::size_t n = 0; n < s.size; ++n)
        bandwidth_power += double(std::norm(s.output[n])) * s.bandwidth_response[n];
    // Integrated FFT energy, with the fixed 2048-bin bandwidth/window correction.
    const float bandwidth_level = bandwidth_power > 0
        ? float(10 * std::log10(bandwidth_power / (double(s.window_sum) * s.window_sum * 2048)) + 27)
        : std::numeric_limits<float>::quiet_NaN();
    Line line{};
    for (std::size_t n = 0; n < line.size(); ++n) {
        const double offset = s.display_start + (double(n) + .5) * 100000 / double(line.size()) - s.center;
        if (std::abs(offset) >= double(s.rate) / 2) {
            line[n] = std::numeric_limits<float>::quiet_NaN();
            continue;
        }
        const double half_bin = 50000 / double(line.size());
        const auto first = static_cast<std::int64_t>(std::ceil((offset - half_bin) * double(s.size) / s.rate));
        const auto last = static_cast<std::int64_t>(std::floor((offset + half_bin) * double(s.size) / s.rate));
        line[n] = -240;
        for (auto bin = first; bin <= last; ++bin) {
            if (std::abs(double(bin) * s.rate / double(s.size)) >= double(s.rate) / 2) continue;
            const auto index = std::size_t((bin + static_cast<std::int64_t>(s.size)) % static_cast<std::int64_t>(s.size));
            const float level = 20 * std::log10(std::max(1e-12f, std::abs(s.output[index]) / s.window_sum)) +
                s.response_db[index];
            line[n] = std::max(line[n], level);
        }
    }
    s.callback(line, double(s.received) / s.rate, bandwidth_level);
}

float spectrum_display_offset_db(std::size_t gain_index) {
    if (gain_index >= dsp_tables::rtl_spectrum_gain_db.size())
        throw std::invalid_argument("Invalid spectrum gain index");
    // Use unnormalized CU8 and a 2048-point, half-Blackman FFT.
    return float(20 * std::log10(128 * 2048 * .42) - 190.8) + dsp_tables::rtl_spectrum_gain_db[gain_index];
}

#ifdef COSPAS_CLI_EMBEDDED
namespace { std::atomic<bool> embedded_stop{false}; }
void set_stop_requested(bool value) { embedded_stop = value; }
bool stop_requested() { return embedded_stop; }
#else
bool stop_requested() {
    std::array<char, 64> buffer{};
    std::size_t count = 0;
#ifdef _WIN32
    const auto handle = GetStdHandle(STD_INPUT_HANDLE);
    if (GetFileType(handle) != FILE_TYPE_PIPE) return false;
    DWORD available = 0, read = 0;
    if (!PeekNamedPipe(handle, nullptr, 0, nullptr, &available, nullptr)) {
        if (GetLastError() == ERROR_BROKEN_PIPE) return true;
        throw std::runtime_error("Cannot poll UI control pipe");
    }
    if (!available) return false;
    if (!ReadFile(handle, buffer.data(), std::min<DWORD>(available, DWORD(buffer.size())), &read, nullptr))
        throw std::runtime_error("Cannot read UI control pipe");
    count = read;
#else
    pollfd input{STDIN_FILENO, POLLIN, 0};
    if (::poll(&input, 1, 0) < 0) throw std::runtime_error("Cannot poll UI control pipe");
    if (!(input.revents & (POLLIN | POLLHUP))) return false;
    const auto read = ::read(STDIN_FILENO, buffer.data(), buffer.size());
    if (read < 0) throw std::runtime_error("Cannot read UI control pipe");
    count = static_cast<std::size_t>(read);
#endif
    if (!count) return true;
    static std::string command;
    command.append(buffer.data(), count);
    if (command.size() > 64) throw std::invalid_argument("UI control command is too long");
    const auto end = command.find('\n');
    if (end == std::string::npos) return false;
    if (command != "stop\n" && command != "stop\r\n")
        throw std::invalid_argument("Unknown UI control command");
    command.clear();
    return true;
}
#endif
}
