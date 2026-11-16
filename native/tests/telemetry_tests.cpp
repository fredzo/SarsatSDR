#include "../cospas-cli/telemetry.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <numbers>
#include <stdexcept>
#include <vector>

int main() {
    try {
        std::size_t lines = 0;
        cospas::cli::Spectrum spectrum(921600, 406120000, [&](const auto& line, double time) {
            ++lines;
            if (std::abs(time - double(lines) / 10) > 1e-10)
                throw std::runtime_error("Spectrum cadence is not 10 Hz");
            const auto peak = std::max_element(line.begin(), line.end());
            const auto frequency = 406000000 + (double(peak - line.begin()) + .5) * 100000 / 1024;
            // Coherent full-scale tone: frontend FIRs attenuate this bin by 0.726167 dB.
            if (std::abs(frequency - 406050081.25) > 50 || std::abs(*peak + .726167f) > .03f)
                throw std::runtime_error("Spectrum peak pooling or dBFS normalization is incorrect: " + std::to_string(*peak));
        });
        std::vector<std::complex<float>> input(921600 / 2);
        for (std::size_t n = 0; n < input.size(); ++n) {
            const double phase = -69918.75 * 2 * std::numbers::pi * double(n) / 921600;
            input[n] = {static_cast<float>(std::cos(phase)), static_cast<float>(std::sin(phase))};
        }
        for (std::size_t position = 0; position < input.size();) {
            const auto count = std::min<std::size_t>(4093, input.size() - position);
            spectrum.push(std::span(input).subspan(position, count));
            position += count;
        }
        if (lines != 5) throw std::runtime_error("Spectrum publication depends on caller chunk boundaries");
        const auto offset = 20 * std::log10(128 * 2048 * .42) - 190.8;
        if (std::abs(cospas::cli::spectrum_display_offset_db(0) - offset) > .0001 ||
            std::abs(cospas::cli::spectrum_display_offset_db(8) - offset - 78) > .0001 ||
            std::abs(cospas::cli::spectrum_display_offset_db(11) - offset - 115) > .0001)
            throw std::runtime_error("CU8/FFT/gain conversion differs from expected levels");
        bool rejected = false;
        try { cospas::cli::spectrum_display_offset_db(12); }
        catch (const std::invalid_argument&) { rejected = true; }
        if (!rejected) throw std::runtime_error("Invalid gain index accepted");
        std::cout << "Native UI spectrum: 10 Hz, 1024 bins, RF mapping and dBFS verified\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
