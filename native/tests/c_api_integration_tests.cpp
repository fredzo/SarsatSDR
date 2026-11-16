#include <cospas/c_api.h>
#include <cospas/decoder.hpp>
#include "wav.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <iostream>
#include <memory>
#include <stdexcept>

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
void check(cs_status code, const cs_error& error) {
    if (code != CS_OK) throw std::runtime_error(error.message);
}

void compare(const cospas::WavSignal& source, cs_iq_format format, const void* input,
             std::size_t byte_count, const std::vector<cospas::Sample>& converted,
             float feedback = cospas::DecoderSettings{}.sgb_feedback) {
    cospas::DecoderSettings settings;
    settings.fgb = false;
    settings.sgb_feedback = feedback;
    cospas::DecodeDiagnostics expected_diagnostics;
    const auto expected = cospas::decode(converted, source.sample_rate_hz, settings, &expected_diagnostics);
    require(!expected.empty(), "Integration capture must produce a real frame in every I/Q format");
    cs_config config{};
    cs_error error{};
    check(cs_config_init(&config, sizeof(config), &error), error);
    config.fgb = 0;
    config.sgb_feedback = feedback;
    std::vector<unsigned char> caller_storage(byte_count + 1);
    std::memcpy(caller_storage.data() + 1, input, byte_count);
    cs_result* decoded = nullptr;
    check(cs_decode_iq(&config, format, source.sample_rate_hz, caller_storage.data() + 1,
                      byte_count, &decoded, &error), error);
    const std::unique_ptr<cs_result, decltype(&cs_result_destroy)> result(decoded, cs_result_destroy);
    std::fill(caller_storage.begin(), caller_storage.end(), 0);
    cs_diagnostics diagnostics{};
    check(cs_result_get_diagnostics(result.get(), &diagnostics, sizeof(diagnostics), &error), error);
    require(diagnostics.frame_count == expected.size(), "C and C++ frame counts differ");
    require(diagnostics.sgb_candidates == expected_diagnostics.sgb_candidates &&
            diagnostics.sgb_bch_rejections == expected_diagnostics.sgb_bch_rejections &&
            diagnostics.sgb_quality_rejections == expected_diagnostics.sgb_quality_rejections,
            "C acquisition diagnostics differ");
    require(diagnostics.tables_sha256 == cospas::tables_sha256(), "DSP table fingerprint lost across C ABI");
    for (std::size_t n = 0; n < expected.size(); ++n) {
        cs_frame actual{};
        check(cs_result_get_frame(result.get(), n, &actual, sizeof(actual), &error), error);
        const auto& frame = expected[n];
        require(actual.generation == unsigned(frame.generation) && actual.self_test == unsigned(frame.self_test) &&
                actual.bit_count == frame.raw_bits.size(), "C frame classification differs");
        require(actual.raw_hex == cospas::hex(frame.raw_bits, frame.self_test) &&
                actual.corrected_hex == cospas::hex(frame.corrected_bits, frame.self_test), "C ABI changed frame bits");
        require(actual.bch_count == 1 && actual.bch[0].valid == unsigned(frame.bch_valid[0]) &&
                actual.bch[0].corrected_errors == frame.corrected_errors[0], "C ABI changed BCH status");
        require(actual.time_seconds == frame.time_seconds &&
                std::abs(actual.frequency_offset_hz - frame.frequency_offset_hz) < .01, "C ABI changed timing or frequency");
        for (const auto kind : {CS_TRACE_PHASE_ERROR, CS_TRACE_RECOVERED_I, CS_TRACE_RECOVERED_Q}) {
            const float* trace = nullptr;
            std::size_t count = 0;
            check(cs_result_get_trace(result.get(), n, cs_trace_kind(kind), &trace, &count, &error), error);
            const auto& values = kind == CS_TRACE_PHASE_ERROR ? frame.phase_error :
                kind == CS_TRACE_RECOVERED_I ? frame.recovered_i : frame.recovered_q;
            require(count == values.size() && trace, "C engineering trace missing");
            for (std::size_t sample = 0; sample < count; ++sample)
                require(std::abs(trace[sample] - values[sample]) < 1e-4f, "C engineering trace changed");
        }
        const float* trace = nullptr;
        std::size_t count = 0;
        require(cs_result_get_trace(result.get(), n, 99, &trace, &count, &error) == CS_INVALID_ARGUMENT,
                "Unknown trace kind accepted");
    }
}
}

int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::invalid_argument("Expected SGB integration capture path");
        const auto signal = cospas::read_wav(argv[1]);
        compare(signal, CS_IQ_CF32, signal.samples.data(),
                signal.samples.size() * sizeof(cospas::Sample), signal.samples);
        compare(signal, CS_IQ_CF32, signal.samples.data(),
                signal.samples.size() * sizeof(cospas::Sample), signal.samples, 3);
        std::vector<uint8_t> u8;
        std::vector<int16_t> s16;
        std::vector<cospas::Sample> converted_u8, converted_s16;
        for (const auto sample : signal.samples) {
            for (const float value : {sample.real(), sample.imag()}) {
                u8.push_back(uint8_t(std::clamp(std::round(value * 128 + 128), 0.0f, 255.0f)));
                s16.push_back(int16_t(std::clamp(std::round(value * 32768), -32768.0f, 32767.0f)));
            }
            const auto n = u8.size() - 2;
            converted_u8.emplace_back((float(u8[n]) - 128) / 128, (float(u8[n + 1]) - 128) / 128);
            converted_s16.emplace_back(float(s16[n]) / 32768, float(s16[n + 1]) / 32768);
        }
        compare(signal, CS_IQ_CU8, u8.data(), u8.size(), converted_u8);
        compare(signal, CS_IQ_CS16, s16.data(), s16.size() * sizeof(int16_t), converted_s16);
        std::cout << "C ABI agrees with C++ for real SGB frames, BCH and traces in all three I/Q formats\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
