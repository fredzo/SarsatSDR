#include "iq_recording.hpp"
#include "wav.hpp"

#include <cmath>
#include <filesystem>
#include <iostream>
#include <numbers>
#include <stdexcept>

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
template<class Action>
void require_error(Action action) {
    try { action(); }
    catch (const std::exception&) { return; }
    throw std::runtime_error("Invalid recording operation was accepted");
}
}

int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::runtime_error("Expected recording output path");
        const std::filesystem::path path(argv[1]);
        const auto open = [&] {
            auto* file = std::fopen(path.string().c_str(), "w+b");
            if (!file) throw std::runtime_error("Could not open recording test output");
            return file;
        };
        cospas::IqRecorder recorder;
        require_error([&] { recorder.start(open()); });
        constexpr std::uint32_t rate = 921600, center = 145825123;
        constexpr std::size_t count = 32000;
        recorder.configure(rate, -70000, center);
        std::vector<std::uint8_t> input(count * 2);
        for (std::size_t n = 0; n < count; ++n) {
            const auto tone = std::polar(.4, 2 * std::numbers::pi * (-70000 + 125) * double(n) / rate);
            input[n * 2] = std::uint8_t(std::lround(128 + 128 * tone.real()));
            input[n * 2 + 1] = std::uint8_t(std::lround(128 + 128 * tone.imag()));
        }
        recorder.start(open());
        recorder.push(std::span(input).first(4006));
        recorder.push(std::span(input).subspan(4006, 19724));
        recorder.push(std::span(input).subspan(23730));
        recorder.stop();
        recorder.stop();
        const auto wav = cospas::read_wav(path);
        require(wav.sample_rate_hz == rate && wav.center_hz == center, "WAV rate or center metadata was lost");
        require(wav.samples.size() == count, "WAV sample count changed across input blocks");
        for (std::size_t n = 0; n < count; ++n) {
            const auto expected = std::polar(.4, 2 * std::numbers::pi * 125 * double(n) / rate);
            require(std::abs(std::complex<double>(wav.samples[n]) - expected) < .006,
                    "Recording changed I/Q order, amplitude, tuner correction or phase continuity");
        }
        recorder.start(open());
        recorder.push(std::span(input).first(200));
        recorder.finish_session();
        require(cospas::read_wav(path).samples.size() == 100, "Session exit did not finalize the WAV");
        require_error([&] { recorder.start(open()); });
        recorder.configure(rate, 0, center);
        recorder.start(open());
        const std::array<std::uint8_t, 4> extrema{0, 255, 128, 128};
        recorder.push(extrema);
        recorder.stop();
        const auto exact = cospas::read_wav(path);
        require(exact.samples.size() == 2 && exact.samples[0] == cospas::Sample(-1, 127.0f / 128) &&
                exact.samples[1] == cospas::Sample(0, 0), "PCM16 conversion changed raw I/Q values");
        recorder.start(open());
        require_error([&] { recorder.push(std::span(extrema).first(1)); });
        require_error([&] { recorder.stop(); });
        require_error([&] { recorder.finish_session(); });
        recorder.configure(rate, 0, center);
        recorder.start(open());
        recorder.stop();
        require(cospas::read_wav(path).samples.empty(), "Empty recording is not a valid WAV");
        recorder.finish_session();
        std::filesystem::remove(path);
        std::cout << "I/Q WAV recording, tuner correction, restart and finalization passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
