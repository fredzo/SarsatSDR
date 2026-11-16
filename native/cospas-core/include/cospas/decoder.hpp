#pragma once

#include <array>
#include <complex>
#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <vector>

namespace cospas {

using Sample = std::complex<float>;
using Bits = std::vector<std::uint8_t>;

struct BchResult {
    Bits bits;
    int corrected_errors{};
    bool valid{};
};

class BchDecoder {
public:
    BchDecoder(int degree, int primitive, int correction_limit);
    BchResult decode(std::span<const std::uint8_t> bits) const;
private:
    int multiply(int a, int b) const;
    int divide(int a, int b) const;
    int power(int exponent) const;
    std::vector<int> syndromes(std::span<const std::uint8_t> bits) const;
    int order_;
    int limit_;
    std::vector<int> exponent_;
    std::vector<int> logarithm_;
};

struct DecoderSettings {
    bool fgb{true};
    bool sgb{true};
    bool normal_prn{true};
    bool test_prn{true};
    float fgb_alpha{0.1f};
    float fgb_beta{0.01f};
    float fgb_zeta{0.01f};
    float fgb_over_peak_db{15.0f};
    float fgb_average{0.045f};
    int fgb_runtime_ms{550};
    int fgb_max_errors{3};
    bool show_bch_failures{false};
    float sgb_detection_threshold{35.0f};
    bool quality_check{true};
    int search_depth{9};
    int prn_alignment{2};
    float sgb_filter{0.5f};
    float sgb_phase_gain{0.83f};
    float sgb_frequency_gain{3.81f};
    int sgb_max_errors{5};
    float sgb_feedback{4.0f};
    int fgb_header_errors{2};
    int fgb_bch2_max_errors{2};
};

struct Frame {
    int generation{};
    bool self_test{};
    double time_seconds{};
    double frequency_offset_hz{};
    float detection_level{};
    Bits raw_bits;
    Bits corrected_bits;
    std::array<int, 2> corrected_errors{};
    std::array<bool, 2> bch_valid{};
    int header_errors{};
    int bch_count{1};
    std::vector<float> phase_error;
    std::vector<float> recovered_i;
    std::vector<float> recovered_q;
};

struct DecodeDiagnostics {
    struct FgbChannel { bool active{}; double frequency_hz{}; float level_dbfs{}; };
    std::array<FgbChannel, 4> fgb_channels{};
    struct FgbTrial { double time_seconds{}, frequency_hz{}; int votes{}, offset{}; };
    float fgb_max_peak_db{};
    std::uint64_t fgb_candidates{};
    int fgb_max_sync_votes{};
    float sgb_max_detection_level{};
    std::uint64_t sgb_candidates{};
    std::uint64_t sgb_quality_rejections{};
    std::uint64_t sgb_bch_rejections{};
    std::array<FgbTrial, 128> fgb_trials{};
    std::size_t fgb_trial_count{};
};

std::string hex(std::span<const std::uint8_t> bits, bool self_test_marker = false);
int fgb_header_errors(std::span<const std::uint8_t> bits, bool& self_test);
std::vector<Frame> decode(std::span<const Sample> iq, std::uint32_t sample_rate_hz,
                          const DecoderSettings& settings = {}, DecodeDiagnostics* diagnostics = nullptr);
std::string tables_sha256();

class StreamDecoder {
public:
    StreamDecoder(std::uint32_t sample_rate_hz, const DecoderSettings& settings = {}, float mixer_hz = 0);
    ~StreamDecoder();
    StreamDecoder(const StreamDecoder&) = delete;
    StreamDecoder& operator=(const StreamDecoder&) = delete;
    void push(std::span<const Sample> iq, std::vector<Frame>& output);
    void finish(std::vector<Frame>& output);
    void reset(std::uint64_t next_sample_index = 0);
    std::uint64_t next_sample_index() const;
    const DecodeDiagnostics& diagnostics() const;
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}
