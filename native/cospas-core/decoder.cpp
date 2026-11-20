#include <cospas/decoder.hpp>
#include "frontend_mixer.hpp"
#include "dsp_tables.hpp"

#include <fftw3.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <numbers>
#include <optional>
#include <stdexcept>

namespace cospas {
namespace {
constexpr double pi = std::numbers::pi;

int bch_order(int degree, int primitive, int correction_limit) {
    if (degree < 2 || degree > 8 || correction_limit < 1 || correction_limit > 6)
        throw std::invalid_argument("Unsupported BCH configuration");
    const int size = 1 << degree;
    if (primitive < size || primitive >= size * 2 || !(primitive & 1))
        throw std::invalid_argument("Invalid BCH primitive polynomial");
    return size - 1;
}

class Fft {
public:
    explicit Fft(int size) : size_(size), input_(fftwf_alloc_complex(size)),
                            output_(fftwf_alloc_complex(size)) {
        if (!input_ || !output_) {
            fftwf_free(input_);
            fftwf_free(output_);
            throw std::bad_alloc();
        }
        forward_ = fftwf_plan_dft_1d(size_, input_, output_, FFTW_FORWARD, FFTW_ESTIMATE);
        inverse_ = fftwf_plan_dft_1d(size_, input_, output_, FFTW_BACKWARD, FFTW_ESTIMATE);
        if (!forward_ || !inverse_) {
            if (forward_) fftwf_destroy_plan(forward_);
            if (inverse_) fftwf_destroy_plan(inverse_);
            fftwf_free(input_);
            fftwf_free(output_);
            throw std::runtime_error("Cannot initialize FFTW plans");
        }
    }
    ~Fft() {
        fftwf_destroy_plan(forward_);
        fftwf_destroy_plan(inverse_);
        fftwf_free(input_);
        fftwf_free(output_);
    }
    Fft(const Fft&) = delete;
    Fft& operator=(const Fft&) = delete;
    void set(int index, Sample value) {
        input_[index][0] = value.real();
        input_[index][1] = value.imag();
    }
    Sample at(int index) const { return {output_[index][0], output_[index][1]}; }
    void execute(bool inverse = false) { fftwf_execute(inverse ? inverse_ : forward_); }
private:
    int size_;
    fftwf_complex* input_;
    fftwf_complex* output_;
    fftwf_plan forward_{};
    fftwf_plan inverse_{};
};

class FirDecimator {
public:
    FirDecimator(std::span<const float> taps, int factor)
        : taps_(taps), delay_(taps.size()), factor_(factor) {}
    void reset() {
        std::fill(delay_.begin(), delay_.end(), Sample{});
        position_ = 0;
        phase_ = 0;
    }
    std::size_t process(std::span<const Sample> input, std::span<Sample> output) {
        std::size_t count = 0;
        for (const auto sample : input) {
            delay_[position_] = sample;
            if (phase_ == 0) {
                Sample sum{};
                auto p = position_;
                for (const auto tap : taps_) {
                    sum += delay_[p] * tap;
                    p = p == 0 ? taps_.size() - 1 : p - 1;
                }
                if (count >= output.size()) throw std::logic_error("FIR output capacity exceeded");
                output[count++] = sum;
            }
            position_ = (position_ + 1) % taps_.size();
            phase_ = (phase_ + 1) % factor_;
        }
        return count;
    }
private:
    std::span<const float> taps_;
    std::vector<Sample> delay_;
    int factor_;
    int phase_{};
    std::size_t position_{};
};

constexpr int resample_radius = 96;
constexpr int resample_phases = 128;
using ResampleKernels = std::array<std::array<float, 2 * resample_radius>, resample_phases>;

ResampleKernels resample_kernels(std::uint32_t rate, std::uint32_t target) {
    constexpr int radius = resample_radius;
    constexpr int phases = resample_phases;
    const double ratio = double(rate) / target;
    const double cutoff = std::min(0.45, 0.45 / ratio);
    ResampleKernels kernels{};
    for (int phase = 0; phase < phases; ++phase) {
        double sum = 0;
        for (int tap = -radius + 1; tap <= radius; ++tap) {
            const double x = tap - double(phase) / phases;
            const double sinc = std::abs(x) < 1e-12 ? 2 * cutoff :
                std::sin(2 * pi * cutoff * x) / (pi * x);
            const double window = 0.42 + 0.5 * std::cos(pi * x / radius) +
                                  0.08 * std::cos(2 * pi * x / radius);
            kernels[phase][tap + radius - 1] = float(sinc * window);
            sum += sinc * window;
        }
        for (auto& value : kernels[phase]) value = float(value / sum);
    }
    return kernels;
}

// WAV adaptation only; all decoder paths below run at their internal rates.
std::vector<Sample> resample(std::span<const Sample> input, std::uint32_t rate,
                             std::uint32_t target) {
    if (rate == target) return {input.begin(), input.end()};
    constexpr int radius = resample_radius;
    constexpr int phases = resample_phases;
    const double ratio = double(rate) / target;
    const auto kernels = resample_kernels(rate, target);
    const auto size = static_cast<std::size_t>(std::ceil(double(input.size()) / ratio));
    std::vector<Sample> result(size);
    for (std::size_t index = 0; index < size; ++index) {
        const double time = double(index) * ratio;
        const auto center = static_cast<std::int64_t>(time);
        const int phase = std::clamp(int((time - double(center)) * phases), 0, phases - 1);
        Sample value{};
        for (int tap = -radius + 1; tap <= radius; ++tap) {
            const auto p = center + tap;
            if (p >= 0 && static_cast<std::uint64_t>(p) < input.size())
                value += input[static_cast<std::size_t>(p)] * kernels[phase][tap + radius - 1];
        }
        result[index] = value;
    }
    return result;
}

std::vector<Sample> rtl_baseband_frontend(std::span<const Sample> input, std::uint32_t rate) {
    auto adapted = resample(input, rate, 921600);
    FirDecimator first(dsp_tables::rtl_frontend_fir_1, 2);
    FirDecimator second(dsp_tables::rtl_frontend_fir_2, 2);
    std::vector<Sample> intermediate((adapted.size() + 1) / 2);
    intermediate.resize(first.process(adapted, intermediate));
    std::vector<Sample> result((intermediate.size() + 1) / 2);
    result.resize(second.process(intermediate, result));
    return result;
}

class FgbChannel {
public:
    FgbChannel(const DecoderSettings& settings, DecodeDiagnostics& diagnostics)
        : settings_(settings), diagnostics_(diagnostics), first_(dsp_tables::fgb_fir_1, 4),
          second_(dsp_tables::fgb_fir_2, 4), third_(dsp_tables::fgb_fir_3, 2) {}
    bool busy() const { return runtime_ms_ > -150; }
    bool active() const { return runtime_ms_ > 0; }
    double frequency() const { return frequency_; }
    float level_dbfs() const { return level_dbfs_; }
    float above_noise_db() const { return above_noise_db_; }
    void reset() {
        runtime_ms_ = -201;
        first_.reset();
        second_.reset();
        third_.reset();
    }
    void start(double frequency, std::uint64_t sample, float level_dbfs, float above_noise_db) {
        frequency_ = frequency;
        level_dbfs_ = level_dbfs;
        above_noise_db_ = above_noise_db;
        start_ = sample;
        runtime_ms_ = float(settings_.fgb_runtime_ms);
        count_ = 0;
        nco_phase_ = 0;
        phase_ = 0;
        frequency_error_ = 0;
        frequency_average_ = 0;
    }
    std::optional<Frame> process(std::span<const Sample> block) {
        // Original channel timer includes a 150 ms frequency reservation after each trial.
        if (runtime_ms_ >= -200) runtime_ms_ = float(runtime_ms_ - 6.94444L);
        if (runtime_ms_ <= 0) return {};
        for (std::size_t n = 0; n < block.size(); ++n) {
            mixed_[n] = block[n] * Sample(float(std::cos(nco_phase_)), float(std::sin(nco_phase_)));
            nco_phase_ = std::remainder(nco_phase_ - 2 * pi * frequency_ / 230400.0, 2 * pi);
        }
        const auto n1 = first_.process(std::span(mixed_).first(block.size()), stage1_);
        const auto n2 = second_.process(std::span(stage1_).first(n1), stage2_);
        const auto n3 = third_.process(std::span(stage2_).first(n2), stage3_);
        for (std::size_t n = 0; n < n3; ++n) {
            if (count_ >= discriminator_.size()) throw std::logic_error("FGB phase buffer full");
            const auto z = stage3_[n] * Sample(float(std::cos(phase_)), float(std::sin(phase_)));
            const float error = -std::atan2(z.imag(), z.real());
            discriminator_[count_] = error;
            phase_ += (count_ < 650 ? settings_.fgb_alpha : settings_.fgb_zeta) * error;
            if (count_ == 650) frequency_average_ /= 350.0f;
            if (count_ < 650) frequency_error_ += settings_.fgb_beta * error;
            else frequency_error_ = frequency_average_;
            if (count_ > 299 && count_ < 650) frequency_average_ += frequency_error_;
            if (frequency_error_ > 2 * pi) frequency_error_ -= float(2 * pi);
            else if (frequency_error_ < -2 * pi) frequency_error_ += float(2 * pi);
            phase_ += frequency_error_;
            ++count_;
        }
        if (count_ < 3900) return {};
        runtime_ms_ = -1;
        return synchronize();
    }
private:
    float sync_score(std::size_t offset) const {
        float score = 0;
        for (int bit = 0; bit < 16; ++bit) {
            for (int half = 0; half < 2; ++half)
                for (int n = 0; n < 9; ++n) {
                    const float value = discriminator_[offset++];
                    score += ((bit < 15) == (half == 0)) ? -value : value;
                }
        }
        return score / 288.0f;
    }
    Bits slice(std::size_t offset) const {
        Bits bits(144);
        for (std::size_t bit = 0; bit < bits.size(); ++bit) {
            float first = 0, second = 0;
            for (int n = 1; n < 8; ++n) first += discriminator_[offset + bit * 18 + std::size_t(n)];
            for (int n = 10; n < 17; ++n) second += discriminator_[offset + bit * 18 + std::size_t(n)];
            bits[bit] = first <= second;
        }
        return bits;
    }
    static int votes(const Bits& bits) {
        return int(std::count(bits.begin(), bits.begin() + 15, std::uint8_t(1))) + (bits[15] == 0);
    }
    static int header_errors(const Bits& bits, bool& self_test) { return fgb_header_errors(bits, self_test); }
    std::optional<Frame> synchronize() const {
        std::size_t best = 800;
        float score = 0;
        for (std::size_t offset = 800; offset < 1200; ++offset) {
            const float value = sync_score(offset);
            if (value > score) { score = value; best = offset; }
        }
        Bits bits = slice(best);
        bool self_test = false;
        int errors = header_errors(bits, self_test);
        if (errors != 0) {
            for (const int delta : {-18, 18}) {
                auto alternative = slice(static_cast<std::size_t>(static_cast<int>(best) + delta));
                bool alternative_test = false;
                const int alternative_errors = header_errors(alternative, alternative_test);
                if (alternative_errors < errors) {
                    bits = std::move(alternative);
                    errors = alternative_errors;
                    self_test = alternative_test;
                }
                if (errors == 0) break;
            }
        }
        const int count = votes(bits);
        diagnostics_.fgb_max_sync_votes = std::max(diagnostics_.fgb_max_sync_votes, count);
        if (diagnostics_.fgb_trial_count < diagnostics_.fgb_trials.size())
            diagnostics_.fgb_trials[diagnostics_.fgb_trial_count++] =
                {double(start_) / 230400, frequency_, count, int(best)};
        if (errors > settings_.fgb_header_errors) return {};
        const auto one = BchDecoder(7, 0x89, 3).decode(std::span(bits).subspan(24, 82));
        if ((!one.valid || one.corrected_errors > settings_.fgb_max_errors) &&
            !settings_.show_bch_failures && !settings_.show_fgb_bch_failures)
            return {};
        const auto& pdf1 = one.valid ? one.bits : std::vector<std::uint8_t>(bits.begin() + 24, bits.begin() + 106);
        const bool long_frame = pdf1[0] != 0;
        // Orbitography user protocol (bit 26 = 1, bits 37-39 = 000) carries no BCH-2.
        const bool orbitography = pdf1[1] != 0 && !pdf1[12] && !pdf1[13] && !pdf1[14];
        const bool has_bch2 = long_frame && !orbitography;
        auto two = has_bch2 ? BchDecoder(6, 0x43, 2).decode(std::span(bits).subspan(106, 38)) : BchResult{};
        if (two.valid && two.corrected_errors > settings_.fgb_bch2_max_errors) two.valid = false;
        Frame frame;
        frame.generation = 1;
        frame.self_test = self_test;
        frame.header_errors = errors;
        frame.bch_count = has_bch2 ? 2 : 1;
        frame.time_seconds = double(start_) / 230400.0;
        frame.frequency_offset_hz = frequency_;
        frame.raw_bits = bits;
        frame.corrected_bits = std::move(bits);
        std::copy(one.bits.begin(), one.bits.end(), frame.corrected_bits.begin() + 24);
        if (two.valid) std::copy(two.bits.begin(), two.bits.end(), frame.corrected_bits.begin() + 106);
        frame.corrected_errors = {one.corrected_errors, two.valid ? two.corrected_errors : 0};
        frame.bch_valid = {one.valid, !has_bch2 || two.valid};
        if (!long_frame) { frame.raw_bits.resize(112); frame.corrected_bits.resize(112); }
        frame.phase_error.assign(discriminator_.begin(), discriminator_.begin() + static_cast<std::ptrdiff_t>(count_));
        return frame;
    }
    const DecoderSettings& settings_;
    DecodeDiagnostics& diagnostics_;
    FirDecimator first_, second_, third_;
    float runtime_ms_{-201};
    float level_dbfs_{}, above_noise_db_{};
    double frequency_{}, nco_phase_{};
    float phase_{}, frequency_error_{}, frequency_average_{};
    std::uint64_t start_{};
    std::size_t count_{};
    std::array<Sample, 1600> mixed_{};
    std::array<Sample, 400> stage1_{};
    std::array<Sample, 100> stage2_{};
    std::array<Sample, 50> stage3_{};
    std::array<float, 4400> discriminator_{};
};

class FgbDecoder {
public:
    FgbDecoder(const DecoderSettings& configuration, DecodeDiagnostics& counters)
        : settings(configuration), diagnostics(counters), fft(2048),
          channels{FgbChannel(settings, diagnostics), FgbChannel(settings, diagnostics),
                   FgbChannel(settings, diagnostics), FgbChannel(settings, diagnostics)} {
        // FFT window: twice a 1024-point Blackman, then 1024 zeros.
        for (std::size_t n = 0; n < window.size() / 2; ++n)
            window[n] = float(2 * (0.42 - 0.5 * std::cos(2 * pi * double(n) / 1024) +
                                        0.08 * std::cos(4 * pi * double(n) / 1024)));
    }
    void reset() {
        average.fill(0);
        available = 0;
        base = 0;
        recent.clear();
        for (auto& channel : channels) channel.reset();
    }
    void process(std::span<const Sample> block, std::vector<Frame>& frames) {
        if (block.size() != 1600) throw std::logic_error("Invalid FGB processing block");
        for (std::size_t n = 0; n < 800; ++n) spectrum_buffer[available + n] = block[n * 2];
        available += 800;
        if (available >= 2048) {
            for (int n = 0; n < 2048; ++n)
                fft.set(n, spectrum_buffer[std::size_t(n)] * window[std::size_t(n)]);
            fft.execute();
            for (int n = 0; n < 2048; ++n) {
                const int bin = (n + 1024) % 2048;
                const float squared = std::norm(fft.at(bin));
                power[std::size_t(n)] = squared > 0 ? 10 * std::log10(squared) - 58.0f : -200.0f;
                average[std::size_t(n)] = settings.fgb_average * power[std::size_t(n)] +
                    (1 - settings.fgb_average) * average[std::size_t(n)];
                difference[std::size_t(n)] = power[std::size_t(n)] - average[std::size_t(n)];
            }
            for (auto& channel : channels) {
                if (channel.busy()) continue;
                int best = 406;
                float peak = -100;
                for (int n = 406; n <= 1650; ++n) {
                    const double frequency = (n - 1023) * 56.25;
                    const bool occupied = std::any_of(channels.begin(), channels.end(), [&](const auto& other) {
                        return other.busy() && std::abs(other.frequency() - frequency) < 50 * 56.25;
                    });
                    if (!occupied && difference[std::size_t(n)] >= peak &&
                        difference[std::size_t(n - 40)] < difference[std::size_t(n)] &&
                        difference[std::size_t(n + 40)] < difference[std::size_t(n)]) {
                        peak = difference[std::size_t(n)];
                        best = n;
                    }
                }
                diagnostics.fgb_max_peak_db = std::max(diagnostics.fgb_max_peak_db, peak);
                if (peak >= settings.fgb_over_peak_db) {
                    ++diagnostics.fgb_candidates;
                    channel.start((best - 1023) * 56.25, base,
                                  power[std::size_t(best)] + 58 - float(20 * std::log10(2048 * .42)), peak);
                }
            }
            std::move(spectrum_buffer.begin() + 2048, spectrum_buffer.begin() + static_cast<std::ptrdiff_t>(available),
                      spectrum_buffer.begin());
            available -= 2048;
        }
        for (auto& channel : channels) {
            auto frame = channel.process(block);
            if (!frame) continue;
            // Several channels can lock on the same burst (spurs); keep only the first decode.
            const bool duplicate = std::any_of(recent.begin(), recent.end(), [&](const auto& previous) {
                return previous.second == frame->corrected_bits &&
                    std::abs(previous.first - frame->time_seconds) < 0.5;
            });
            if (duplicate) continue;
            std::erase_if(recent, [&](const auto& previous) { return frame->time_seconds - previous.first >= 0.5; });
            recent.emplace_back(frame->time_seconds, frame->corrected_bits);
            frames.push_back(std::move(*frame));
        }
        for (std::size_t n = 0; n < channels.size(); ++n)
            diagnostics.fgb_channels[n] = {channels[n].active(), channels[n].frequency(),
                channels[n].level_dbfs(), channels[n].above_noise_db()};
        base += 1600;
    }
private:
    const DecoderSettings& settings;
    DecodeDiagnostics& diagnostics;
    Fft fft;
    std::array<float, 2048> average{};
    std::array<float, 2048> power{};
    std::array<float, 2048> difference{};
    std::array<float, 2048> window{};
    std::array<FgbChannel, 4> channels;
    std::vector<std::pair<double, Bits>> recent;
    std::array<Sample, 2848> spectrum_buffer{};
    std::size_t available{};
    std::uint64_t base{};
};

std::vector<Frame> decode_fgb(std::span<const Sample> input, const DecoderSettings& settings,
                              DecodeDiagnostics& diagnostics) {
    FgbDecoder decoder(settings, diagnostics);
    std::vector<Frame> frames;
    for (std::size_t base = 0; base + 1600 <= input.size(); base += 1600)
        decoder.process(input.subspan(base, 1600), frames);
    return frames;
}

float prn_value(bool test, int component, std::size_t chip, bool interpolate) {
    const auto& packed = test ? dsp_tables::test_prn : dsp_tables::normal_prn;
    const auto level = [&](std::size_t index) {
        const auto bit = std::size_t(component) * 38400 + index;
        return (packed[bit / 8] >> (bit % 8)) & 1 ? 1.0f : -1.0f;
    };
    const float current = level(chip);
    return interpolate ? 0.75f * current + 0.25f * level(chip ? chip - 1 : 0) : current;
}

std::optional<Frame> despread(std::span<const Sample> input, std::size_t start,
                              bool test, int frequency_bin, float score,
                              const DecoderSettings& settings, DecodeDiagnostics& diagnostics) {
    if (start + 76800 > input.size()) return {};
    Frame frame;
    frame.generation = 2;
    frame.self_test = test;
    frame.time_seconds = double(start) / 76800;
    frame.detection_level = score;
    frame.raw_bits.resize(250);
    frame.phase_error.reserve(600);
    frame.recovered_i.reserve(150);
    frame.recovered_q.reserve(150);
    float frequency = float(-frequency_bin * 150 + 90);
    float oscillator_phase = 0, filtered_error = 0;
    float previous_q = 1, polarity = 0, quality_numerator = 0, quality_denominator = 0;
    std::size_t chip = 0, sample = start;
    for (int bit = 0; bit < 150; ++bit) {
        float recovered_i = 0, recovered_q = 0;
        float error = 0;
        for (int quarter = 0; quarter < 4; ++quarter) {
            float quarter_i = 0, quarter_q = 0;
            float cross_i = 0, cross_q = 0;
            for (int n = 0; n < 128; ++n) {
                const auto mixed = input[sample++] *
                    Sample(float(std::cos(oscillator_phase)), float(std::sin(oscillator_phase)));
                oscillator_phase = float(std::remainder(oscillator_phase + 2 * pi * frequency / 76800.0, 2 * pi));
                const float prn_i = prn_value(test, 0, chip, settings.prn_alignment != 2);
                if (n & 1) previous_q = prn_value(test, 1, chip, settings.prn_alignment != 2);
                quarter_i += -mixed.imag() * prn_i;
                quarter_q += mixed.real() * previous_q;
                cross_i += mixed.real() * prn_i;
                cross_q += mixed.imag() * previous_q;
                if (n & 1) ++chip;
            }
            recovered_i += quarter_i;
            recovered_q += quarter_q;
            if (recovered_i > 0) cross_i = -cross_i;
            if (recovered_q > 0) cross_q = -cross_q;
            const float amplitude = std::abs(recovered_i) + std::abs(recovered_q);
            error = amplitude == 0 ? 0 : (cross_i + cross_q) * settings.sgb_feedback / amplitude;
            error = std::clamp(error, -1.5f, 1.5f);
            filtered_error = (1 - settings.sgb_filter) * error + settings.sgb_filter * filtered_error;
            frequency += filtered_error * settings.sgb_frequency_gain;
            oscillator_phase = float(std::remainder(oscillator_phase + filtered_error * settings.sgb_phase_gain, 2 * pi));
            frame.phase_error.push_back(error);
        }
        recovered_i /= 512;
        recovered_q /= 512;
        frame.recovered_i.push_back(recovered_i);
        frame.recovered_q.push_back(recovered_q);
        if (bit > 19 && bit < 25) {
            polarity += recovered_i + recovered_q;
            quality_numerator += recovered_i * recovered_q;
            quality_denominator += std::abs(recovered_i) * std::abs(recovered_q);
        }
        if (bit == 24 && settings.quality_check &&
            (quality_denominator == 0 || quality_numerator / quality_denominator < 0.85f)) {
            ++diagnostics.sgb_quality_rejections;
            return {};
        }
        if (bit >= 25) {
            frame.raw_bits[std::size_t((bit - 25) * 2)] = (recovered_i <= 0) == (polarity >= 0);
            frame.raw_bits[std::size_t((bit - 25) * 2 + 1)] = (recovered_q <= 0) == (polarity >= 0);
        }
    }
    const auto result = BchDecoder(8, 0x11d, 6).decode(frame.raw_bits);
    if ((!result.valid || result.corrected_errors > settings.sgb_max_errors) && !settings.show_bch_failures) {
        ++diagnostics.sgb_bch_rejections;
        return {};
    }
    frame.corrected_bits = result.bits;
    frame.corrected_errors = {result.corrected_errors, 0};
    frame.bch_valid = {result.valid, true};
    frame.frequency_offset_hz = -frequency;
    return frame;
}

class SgbDecoder {
public:
    SgbDecoder(const DecoderSettings& configuration, DecodeDiagnostics& counters)
        : settings(configuration), diagnostics(counters), fft(512), inverse(512) {}
    void reset() { last_start = {}; }
    void process(std::span<const Sample> signal, std::size_t block, std::uint64_t origin,
                 std::vector<Frame>& frames) {
        for (int n = 0; n < 512; ++n) fft.set(n, signal[block + std::size_t(n)]);
        fft.execute();
        for (int n = 0; n < 512; ++n) spectrum[std::size_t(n)] = fft.at(n);
        for (int mode = 0; mode < 2; ++mode) {
            if ((mode == 0 && !settings.normal_prn) || (mode == 1 && !settings.test_prn)) continue;
            const auto& replica = mode == 0 ? dsp_tables::normal_spectrum : dsp_tables::test_spectrum;
            float best_score = 0;
            int best_lag = 0, best_frequency = 0;
            for (int frequency = -settings.search_depth; frequency <= settings.search_depth; ++frequency) {
                for (int n = 0; n < 512; ++n) {
                    const auto p = std::size_t(n + 9 - frequency) * 2;
                    inverse.set(n, spectrum[std::size_t(n)] * Sample(replica[p], replica[p + 1]));
                }
                inverse.execute(true);
                float peak = -1, sum = 0;
                int lag = 0;
                for (int n = -100; n <= 100; ++n) {
                    const float magnitude = std::norm(inverse.at((n + 512) % 512));
                    sum += magnitude;
                    if (magnitude >= peak) { peak = magnitude; lag = n; }
                }
                const float score = sum > 0 ? peak / (sum / 512) : 0;
                if (score > best_score) { best_score = score; best_lag = lag; best_frequency = frequency; }
            }
            diagnostics.sgb_max_detection_level = std::max(diagnostics.sgb_max_detection_level, best_score);
            if (best_score <= settings.sgb_detection_threshold) continue;
            ++diagnostics.sgb_candidates;
            const auto candidate = static_cast<std::int64_t>(block) + best_lag;
            if (candidate < 0) continue;
            const auto start = static_cast<std::size_t>(candidate);
            const auto absolute_start = origin + start;
            const auto previous = last_start[std::size_t(mode)];
            if (previous &&
                std::abs(double(absolute_start) - double(*previous)) < 76800 * 0.8) continue;
            if (auto frame = despread(signal, start, mode == 1, best_frequency, best_score, settings, diagnostics)) {
                frame->time_seconds = double(absolute_start) / 76800;
                if (frame->bch_valid[0]) last_start[std::size_t(mode)] = absolute_start;
                frames.push_back(std::move(*frame));
            }
        }
    }
private:
    const DecoderSettings& settings;
    DecodeDiagnostics& diagnostics;
    Fft fft, inverse;
    std::array<Sample, 512> spectrum{};
    std::array<std::optional<std::uint64_t>, 2> last_start{};
};

std::vector<Frame> decode_sgb(std::span<const Sample> input, const DecoderSettings& settings,
                              DecodeDiagnostics& diagnostics) {
    std::vector<Sample> signal((input.size() + 2) / 3);
    for (std::size_t n = 0; n < signal.size(); ++n) signal[n] = input[n * 3];
    SgbDecoder decoder(settings, diagnostics);
    std::vector<Frame> frames;
    for (std::size_t block = 0; block + 76800 <= signal.size(); block += 100)
        decoder.process(signal, block, 0, frames);
    return frames;
}

void validate_settings(std::uint32_t rate, const DecoderSettings& settings) {
    if (rate < 76800 || rate > 10000000) throw std::invalid_argument("Unsupported I/Q sample rate");
    if (settings.search_depth < 3 || settings.search_depth > 9 ||
        settings.prn_alignment < 0 || settings.prn_alignment > 2)
        throw std::invalid_argument("Invalid search settings");
    const std::array coefficients{settings.fgb_alpha, settings.fgb_beta, settings.fgb_zeta,
        settings.fgb_over_peak_db, settings.fgb_average, settings.sgb_detection_threshold,
        settings.sgb_filter, settings.sgb_phase_gain, settings.sgb_frequency_gain, settings.sgb_feedback};
    if (std::any_of(coefficients.begin(), coefficients.end(),
                    [](float value) { return !std::isfinite(value) || value < 0; }) ||
        settings.fgb_average > 1 || settings.sgb_filter > 1 ||
        settings.sgb_detection_threshold > 512 || settings.fgb_runtime_ms <= 0 || settings.fgb_max_errors < 0 ||
        settings.fgb_max_errors > 3 || settings.fgb_bch2_max_errors < 0 || settings.fgb_bch2_max_errors > 2 || settings.sgb_max_errors < 0 || settings.sgb_max_errors > 6 ||
        settings.fgb_header_errors < 0 || settings.fgb_header_errors > 3 ||
        !(settings.fgb || settings.sgb))
        throw std::invalid_argument("Invalid decoder settings");
}

class StreamingResampler {
public:
    explicit StreamingResampler(std::uint32_t rate)
        : passthrough_(rate == 921600), ratio_(double(rate) / 921600),
          kernels_(passthrough_ ? ResampleKernels{} : resample_kernels(rate, 921600)) {}
    void reset() { received_ = produced_ = 0; }
    template<class Sink>
    void push(Sample value, Sink emit) {
        if (passthrough_) { emit(value); return; }
        history_[received_ % history_.size()] = value;
        ++received_;
        while (std::uint64_t(double(produced_) * ratio_) + resample_radius < received_)
            emit(next());
    }
    template<class Sink>
    void finish(Sink emit) {
        if (passthrough_) return;
        const auto count = std::uint64_t(std::ceil(double(received_) / ratio_));
        while (produced_ < count) emit(next());
    }
private:
    Sample next() {
        const double time = double(produced_++) * ratio_;
        const auto center = static_cast<std::int64_t>(time);
        const int phase = std::clamp(int((time - double(center)) * resample_phases), 0, resample_phases - 1);
        Sample value{};
        for (int tap = -resample_radius + 1; tap <= resample_radius; ++tap) {
            const auto p = center + tap;
            if (p >= 0 && std::uint64_t(p) < received_)
                value += history_[std::uint64_t(p) % history_.size()] *
                    kernels_[phase][tap + resample_radius - 1];
        }
        return value;
    }
    bool passthrough_;
    double ratio_;
    ResampleKernels kernels_;
    std::array<Sample, 256> history_{};
    std::uint64_t received_{}, produced_{};
};
}

struct StreamDecoder::Impl {
    Impl(std::uint32_t rate, const DecoderSettings& configuration, float mixer_hz)
        : sample_rate(rate), settings(configuration), resampler(rate), mixer(mixer_hz),
          first(dsp_tables::rtl_frontend_fir_1, 2),
          second(dsp_tables::rtl_frontend_fir_2, 2),
          fgb(settings, counters), sgb(settings, counters), sgb_ring(2 * sgb_capacity) {}

    void common(Sample value, std::vector<Frame>& output) {
        Sample intermediate, baseband;
        if (!first.process(std::span(&value, 1), std::span(&intermediate, 1))) return;
        intermediate = mixer.process(intermediate);
        if (!second.process(std::span(&intermediate, 1), std::span(&baseband, 1))) return;
        if (settings.fgb) {
            fgb_block[fgb_available++] = baseband;
            if (fgb_available == fgb_block.size()) {
                fgb.process(fgb_block, output);
                fgb_available = 0;
            }
        }
        if (settings.sgb && common_phase == 0) {
            const auto position = sgb_received % sgb_capacity;
            sgb_ring[position] = sgb_ring[position + sgb_capacity] = baseband;
            ++sgb_received;
            if (sgb_received >= sgb_block + 76900) acquire(output);
        }
        common_phase = (common_phase + 1) % 3;
    }
    void acquire(std::vector<Frame>& output) {
        // Keep 100 past samples for negative correlation lags and 100 future samples.
        const auto begin = sgb_block > 100 ? sgb_block - 100 : 0;
        if (sgb_received - begin > sgb_capacity)
            throw std::logic_error("SGB history exceeds fixed ring capacity");
        const auto signal = std::span<const Sample>(sgb_ring).subspan(
            std::size_t(begin % sgb_capacity), std::size_t(sgb_received - begin));
        sgb.process(signal, std::size_t(sgb_block - begin), begin, output);
        sgb_block += 100;
    }
    void adjust(std::vector<Frame>& output, std::size_t begin) {
        for (auto n = begin; n < output.size(); ++n)
            output[n].time_seconds += double(origin) / sample_rate;
        while (adjusted_trials < counters.fgb_trial_count)
            counters.fgb_trials[adjusted_trials++].time_seconds += double(origin) / sample_rate;
    }
    std::uint32_t sample_rate;
    DecoderSettings settings;
    DecodeDiagnostics counters;
    StreamingResampler resampler;
    FrontendMixer mixer;
    FirDecimator first, second;
    FgbDecoder fgb;
    SgbDecoder sgb;
    static constexpr std::size_t sgb_capacity = 77000;
    std::vector<Sample> sgb_ring;
    std::array<Sample, 1600> fgb_block{};
    std::size_t fgb_available{};
    std::size_t adjusted_trials{};
    int common_phase{};
    std::uint64_t sgb_received{}, sgb_block{}, consumed{}, origin{};
    bool finished{}, failed{};
};

StreamDecoder::StreamDecoder(std::uint32_t rate, const DecoderSettings& settings, float mixer_hz) {
    validate_settings(rate, settings);
    impl_ = std::make_unique<Impl>(rate, settings, mixer_hz);
}
StreamDecoder::~StreamDecoder() = default;

void StreamDecoder::push(std::span<const Sample> iq, std::vector<Frame>& output) {
    auto& state = *impl_;
    if (state.finished || state.failed) throw std::invalid_argument("Stream requires reset before more input");
    if (iq.size() > std::numeric_limits<std::uint64_t>::max() - next_sample_index())
        throw std::invalid_argument("Stream sample index overflow");
    if (std::any_of(iq.begin(), iq.end(), [](Sample value) {
            return !std::isfinite(value.real()) || !std::isfinite(value.imag());
        })) throw std::invalid_argument("Non-finite I/Q sample");
    const auto begin = output.size();
    try {
        for (const auto sample : iq)
            state.resampler.push(sample, [&](Sample value) { state.common(value, output); });
        state.consumed += iq.size();
        state.adjust(output, begin);
    } catch (...) {
        state.failed = true;
        throw;
    }
}

void StreamDecoder::finish(std::vector<Frame>& output) {
    auto& state = *impl_;
    if (state.finished || state.failed) throw std::invalid_argument("Stream requires reset before finalization");
    const auto begin = output.size();
    try {
        state.resampler.finish([&](Sample value) { state.common(value, output); });
        if (state.settings.sgb)
            while (state.sgb_block + 76800 <= state.sgb_received) state.acquire(output);
        state.finished = true;
        state.adjust(output, begin);
    } catch (...) {
        state.failed = true;
        throw;
    }
}

void StreamDecoder::reset(std::uint64_t next_sample_index) {
    auto& state = *impl_;
    state.resampler.reset();
    state.first.reset();
    state.mixer.reset();
    state.second.reset();
    state.fgb.reset();
    state.sgb.reset();
    state.counters = {};
    state.fgb_available = 0;
    state.adjusted_trials = 0;
    state.common_phase = 0;
    state.sgb_received = state.sgb_block = state.consumed = 0;
    state.origin = next_sample_index;
    state.finished = state.failed = false;
}

std::uint64_t StreamDecoder::next_sample_index() const { return impl_->origin + impl_->consumed; }
const DecodeDiagnostics& StreamDecoder::diagnostics() const { return impl_->counters; }

BchDecoder::BchDecoder(int degree, int primitive, int correction_limit)
    : order_(bch_order(degree, primitive, correction_limit)), limit_(correction_limit),
      exponent_(std::size_t(order_)), logarithm_(std::size_t(order_ + 1), -1) {
    int x = 1;
    for (int i = 0; i < order_; ++i) {
        if (x < 1 || x > order_ || logarithm_[std::size_t(x)] != -1)
            throw std::invalid_argument("BCH polynomial does not generate the field");
        exponent_[std::size_t(i)] = x;
        logarithm_[std::size_t(x)] = i;
        x <<= 1;
        if (x & (order_ + 1)) x ^= primitive;
    }
}
int BchDecoder::power(int exponent) const {
    exponent %= order_;
    if (exponent < 0) exponent += order_;
    return exponent_[std::size_t(exponent)];
}
int BchDecoder::multiply(int a, int b) const {
    return !a || !b ? 0 : power(logarithm_[std::size_t(a)] + logarithm_[std::size_t(b)]);
}
int BchDecoder::divide(int a, int b) const {
    if (!b) throw std::logic_error("BCH division by zero");
    return a ? power(logarithm_[std::size_t(a)] - logarithm_[std::size_t(b)]) : 0;
}
std::vector<int> BchDecoder::syndromes(std::span<const std::uint8_t> bits) const {
    std::vector<int> result(std::size_t(2 * limit_ + 1));
    for (int j = 1; j <= 2 * limit_; ++j)
        for (std::size_t n = 0; n < bits.size(); ++n)
            if (bits[n]) result[std::size_t(j)] ^= power(j * int(bits.size() - 1 - n));
    return result;
}
BchResult BchDecoder::decode(std::span<const std::uint8_t> input) const {
    if (input.empty() || input.size() > std::size_t(order_) ||
        std::any_of(input.begin(), input.end(), [](auto bit) { return bit > 1; }))
        throw std::invalid_argument("Invalid BCH codeword");
    BchResult result{{input.begin(), input.end()}, 0, true};
    const auto syndrome = syndromes(input);
    if (std::all_of(syndrome.begin(), syndrome.end(), [](int value) { return value == 0; })) return result;
    std::vector<int> locator(std::size_t(2 * limit_ + 1)), previous(locator.size());
    locator[0] = previous[0] = 1;
    int degree = 0, distance = 1, last_discrepancy = 1;
    for (int n = 0; n < 2 * limit_; ++n) {
        int discrepancy = syndrome[std::size_t(n + 1)];
        for (int i = 1; i <= degree; ++i)
            discrepancy ^= multiply(locator[std::size_t(i)], syndrome[std::size_t(n + 1 - i)]);
        if (!discrepancy) { ++distance; continue; }
        auto saved = locator;
        const int scale = divide(discrepancy, last_discrepancy);
        for (std::size_t i = std::size_t(distance); i < locator.size(); ++i)
            locator[i] ^= multiply(scale, previous[i - std::size_t(distance)]);
        if (2 * degree <= n) {
            degree = n + 1 - degree;
            previous = std::move(saved);
            last_discrepancy = discrepancy;
            distance = 1;
        } else ++distance;
    }
    std::vector<std::size_t> positions;
    if (degree <= limit_) {
        for (std::size_t i = 0; i < input.size(); ++i) {
            int value = 0;
            for (int j = 0; j <= degree; ++j)
                value ^= multiply(locator[std::size_t(j)], power(-int(input.size() - 1 - i) * j));
            if (!value) positions.push_back(i);
        }
    }
    if (degree > limit_ || positions.size() != std::size_t(degree)) {
        result.corrected_errors = limit_ + 1;
        result.valid = false;
        return result;
    }
    for (const auto position : positions) result.bits[position] ^= 1;
    const auto checked = syndromes(result.bits);
    result.valid = std::all_of(checked.begin(), checked.end(), [](int value) { return value == 0; });
    result.corrected_errors = result.valid ? degree : limit_ + 1;
    if (!result.valid) result.bits.assign(input.begin(), input.end());
    return result;
}

int fgb_header_errors(std::span<const std::uint8_t> bits, bool& self_test) {
    if (bits.size() < 24) throw std::invalid_argument("FGB header requires 24 bits");
    constexpr std::array<std::uint8_t, 9> normal{0, 0, 0, 1, 0, 1, 1, 1, 1}, test{0, 1, 1, 0, 1, 0, 0, 0, 0};
    int normal_errors = 0, test_errors = 0;
    for (std::size_t n = 0; n < normal.size(); ++n) {
        normal_errors += bits[15 + n] != normal[n];
        test_errors += bits[15 + n] != test[n];
    }
    self_test = test_errors < normal_errors;
    return int(std::count(bits.begin(), bits.begin() + 15, std::uint8_t(0))) + std::min(normal_errors, test_errors);
}

std::string hex(std::span<const std::uint8_t> bits, bool self_test_marker) {
    const auto padding = (4 - bits.size() % 4) % 4;
    std::string result((bits.size() + padding) / 4, '0');
    for (std::size_t nibble = 0; nibble < result.size(); ++nibble) {
        unsigned value = 0;
        for (std::size_t bit = 0; bit < 4; ++bit) {
            const auto p = nibble * 4 + bit;
            value = (value << 1) | (p >= padding ? bits[p - padding] : 0);
        }
        if (nibble == 0 && self_test_marker) value |= 8;
        result[nibble] = "0123456789ABCDEF"[value];
    }
    return result;
}
std::string tables_sha256() { return dsp_tables::sha256; }

std::vector<Frame> decode(std::span<const Sample> iq, std::uint32_t rate,
                          const DecoderSettings& settings, DecodeDiagnostics* diagnostics) {
    validate_settings(rate, settings);
    auto input = rtl_baseband_frontend(iq, rate);
    DecodeDiagnostics local;
    auto& counters = diagnostics ? *diagnostics : local;
    std::vector<Frame> frames;
    if (settings.fgb) frames = decode_fgb(input, settings, counters);
    if (settings.sgb) {
        auto sgb = decode_sgb(input, settings, counters);
        frames.insert(frames.end(), std::make_move_iterator(sgb.begin()), std::make_move_iterator(sgb.end()));
    }
    std::stable_sort(frames.begin(), frames.end(), [](const auto& a, const auto& b) {
        return a.time_seconds < b.time_seconds;
    });
    return frames;
}
}
