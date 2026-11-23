#include "../cospas-cli/telemetry.hpp"
#include "../cospas-cli/fgb_fm.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <numbers>
#include <sstream>
#include <stdexcept>
#include <vector>

int main() {
    try {
        std::size_t lines = 0;
        cospas::cli::Spectrum spectrum(921600, 406120000, [&](const auto& line, double time, float bandwidth) {
            ++lines;
            if (std::abs(time - double(lines) / 10) > 1e-10)
                throw std::runtime_error("Spectrum cadence is not 10 Hz");
            const auto peak = std::max_element(line.begin(), line.end());
            const auto frequency = 406000000 + (double(peak - line.begin()) + .5) * 100000 / 1024;
            // Coherent full-scale tone: frontend FIRs attenuate this bin by 0.726167 dB.
            if (std::abs(frequency - 406050081.25) > 50 || std::abs(*peak + .726167f) > .03f)
                throw std::runtime_error("Spectrum peak pooling or dBFS normalization is incorrect: " + std::to_string(*peak));
            const auto expected = 10 * std::log10(.6092 / (.42 * .42)) + 27 - 10 * std::log10(2048) - .726167;
            if (std::abs(bandwidth - expected) > .03)
                throw std::runtime_error("Full-band FFT energy/window normalization is incorrect: " + std::to_string(bandwidth));
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
        for (const double center : {100000000., 145825123., 999000000.}) {
            std::size_t shifted_lines = 0;
            cospas::cli::Spectrum shifted(921600, center + 70000, [&](const auto& line, double, float) {
                ++shifted_lines;
                const auto peak = std::max_element(line.begin(), line.end());
                const auto frequency = center - 50000 + (double(peak - line.begin()) + .5) * 100000 / 1024;
                if (std::abs(frequency - center - 81.25) > 50 || std::abs(*peak + .726167f) > .03f)
                    throw std::runtime_error("Spectrum did not follow the retuned center frequency");
            }, center);
            shifted.push(input);
            if (shifted_lines != 5) throw std::runtime_error("Missing retuned spectra");
        }
        const auto offset = 20 * std::log10(128 * 2048 * .42) - 190.8;
        if (std::abs(cospas::cli::spectrum_display_offset_db(0) - offset) > .0001 ||
            std::abs(cospas::cli::spectrum_display_offset_db(8) - offset - 78) > .0001 ||
            std::abs(cospas::cli::spectrum_display_offset_db(11) - offset - 115) > .0001)
            throw std::runtime_error("CU8/FFT/gain conversion differs from expected levels");
        bool rejected = false;
        try { cospas::cli::spectrum_display_offset_db(12); }
        catch (const std::invalid_argument&) { rejected = true; }
        if (!rejected) throw std::runtime_error("Invalid gain index accepted");
        std::size_t blank_lines = 0;
        cospas::cli::Spectrum blank(115200, 406050000, [&](const auto&, double, float bandwidth) {
            ++blank_lines;
            if (std::isfinite(bandwidth))
                throw std::runtime_error("Zero-energy input must not invent an RF power reading");
        });
        blank.push(std::vector<std::complex<float>>(11520));
        if (blank_lines != 1) throw std::runtime_error("Missing blank spectrum");
        std::size_t outside_lines = 0;
        cospas::cli::Spectrum outside(921600, 406120000, [&](const auto&, double, float bandwidth) {
            ++outside_lines;
            if (bandwidth > -90)
                throw std::runtime_error("Full-band power includes a tone outside the 115.2 kHz receive bandwidth");
        });
        for (std::size_t n = 0; n < input.size(); ++n) {
            const double phase = -5343.75 * 2 * std::numbers::pi * double(n) / 921600;
            input[n] = {static_cast<float>(std::cos(phase)), static_cast<float>(std::sin(phase))};
        }
        outside.push(input);
        if (outside_lines != 5) throw std::runtime_error("Missing out-of-band spectra");
        std::ostringstream audio;
        cospas::cli::FgbFm fm(921600, -70000, 2, audio);
        cs_acquisition candidates{};
        candidates.fgb_channels[0] = {1, 1000, -40};
        candidates.fgb_channels[1] = {1, 2000, -20};
        candidates.fgb_above_noise_db[0] = 8;
        candidates.fgb_above_noise_db[1] = 14;
        const auto make_burst = [](double frequency, bool modulated) {
            std::vector<std::complex<float>> samples(921600 / 10);
            for (std::size_t n = 0; n < samples.size(); ++n) {
                const double modulation = modulated ? ((n / 1152) % 2 ? 1.1 : -1.1) : 0;
                samples[n] = std::polar(1.f, float(2 * std::numbers::pi * frequency * double(n) / 921600 + modulation));
            }
            return samples;
        };
        const auto strongest = make_burst(-68000 + 480, false);
        const auto next = make_burst(-69000, false);
        const auto modulated = make_burst(-68000 + 480, true);
        fm.select(candidates, 1.999);
        fm.push(strongest);
        fm.flush();
        if (!audio.str().empty()) throw std::runtime_error("FM squelch opened before the RTL startup delay");
        fm.select(candidates, 2);
        fm.push(modulated);
        fm.flush();
        if (!audio.str().empty()) throw std::runtime_error("FM squelch opened on phase modulation without a preamble");
        fm.select({}, 2.1);
        fm.select(candidates, 2);
        fm.push(std::span(strongest).first(921600 / 20));
        fm.flush();
        if (!audio.str().empty()) throw std::runtime_error("FM squelch opened on a short carrier");
        candidates.fgb_channels[0].level_dbfs = -10;
        fm.select(candidates, 2.05);
        fm.push(std::span(strongest).subspan(921600 / 20));
        fm.flush();
        if (audio.str().find("\"channel\":1") == std::string::npos ||
            audio.str().find("\"channel\":0") != std::string::npos)
            throw std::runtime_error("FM squelch did not confirm the original candidate's carrier");
        audio.str("");
        fm.push(modulated);
        fm.flush();
        if (audio.str().find("\"channel\":1") == std::string::npos)
            throw std::runtime_error("FM squelch closed when the data modulation started");
        audio.str("");
        candidates.fgb_channels[1].active = 0;
        fm.select(candidates, 2.2);
        fm.push(next);
        fm.flush();
        candidates.fgb_channels[0].active = 0;
        fm.select(candidates, 2.3);
        fm.push(next);
        fm.flush();
        std::istringstream chunks(audio.str());
        std::string line;
        if (!std::getline(chunks, line)) throw std::runtime_error("FM squelch did not reopen for the next candidate");
        do {
            if (line.find("\"channel\":0") == std::string::npos)
                throw std::runtime_error("FM squelch did not stay on the remaining candidate");
        } while (std::getline(chunks, line));
        audio.str("");
        candidates.fgb_channels[9] = {1, 2000, -20};
        fm.select(candidates, 2.4);
        fm.push(strongest);
        fm.flush();
        if (audio.str().find("\"channel\":9") == std::string::npos)
            throw std::runtime_error("FM squelch did not select the tenth FGB candidate");
        std::cout << "Native UI spectrum: 10 Hz, 1024 bins, RF mapping and dBFS verified\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
