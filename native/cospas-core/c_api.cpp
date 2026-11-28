/*
 * SarsatSDR
 * Copyright (C) 2026 Frederic BORRY - F4JRX
 * Authors: Frederic BORRY - F4JRX and Copilot (AI-assisted development).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

#include <cospas/c_api.h>
#include <cospas/decoder.hpp>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <thread>

static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559);

struct cs_result {
    std::vector<cospas::Frame> frames;
    std::vector<cs_frame> metadata;
    cs_diagnostics diagnostics{};
    cs_acquisition acquisition{};
};

struct cs_stream {
    cs_stream(std::uint32_t rate, const cospas::DecoderSettings& settings, std::size_t capacity, float mixer_hz)
        : decoder(rate, settings, mixer_hz), scratch(capacity) {}
    cospas::StreamDecoder decoder;
    std::vector<cospas::Sample> scratch;
    bool failed{};
};

namespace {
cs_status status(cs_error* error, cs_status code, const char* message) noexcept {
    if (error) {
        error->code = code;
        const auto count = std::min(std::strlen(message), sizeof(error->message) - 1);
        std::memcpy(error->message, message, count);
        error->message[count] = '\0';
    }
    return code;
}

template<class Action>
cs_status guarded(cs_error* error, Action action) noexcept {
    try {
        action();
        return status(error, CS_OK, "");
    } catch (const std::invalid_argument& failure) {
        return status(error, CS_INVALID_ARGUMENT, failure.what());
    } catch (const std::bad_alloc& failure) {
        return status(error, CS_OUT_OF_MEMORY, failure.what());
    } catch (const std::exception& failure) {
        return status(error, CS_INTERNAL_ERROR, failure.what());
    } catch (...) {
        return status(error, CS_INTERNAL_ERROR, "Unknown native decoder exception");
    }
}

template<std::size_t Size>
void text(char (&output)[Size], const std::string& value) {
    if (value.size() >= Size) throw std::logic_error("Native result exceeds ABI text capacity");
    std::memcpy(output, value.c_str(), value.size() + 1);
}

bool flag(uint32_t value) {
    if (value > 1) throw std::invalid_argument("Configuration flags must be 0 or 1");
    return value != 0;
}

cospas::DecoderSettings settings(const cs_config& config) {
    if ((config.struct_size != sizeof(cs_config) && config.struct_size != offsetof(cs_config, fgb_excluded_band_count) &&
         config.struct_size != offsetof(cs_config, fgb_max_candidates) &&
         config.struct_size != offsetof(cs_config, fgb_normal) &&
         config.struct_size != offsetof(cs_config, show_fgb_bch_failures) &&
         config.struct_size != offsetof(cs_config, fgb_bch2_max_errors) &&
         config.struct_size != offsetof(cs_config, fgb_header_errors) &&
         config.struct_size != offsetof(cs_config, sgb_feedback)) ||
        config.abi_version != CS_ABI_VERSION)
        throw std::invalid_argument("Incompatible decoder configuration ABI or size");
    cospas::DecoderSettings result;
    result.fgb = flag(config.fgb);
    result.sgb = flag(config.sgb);
    result.normal_prn = flag(config.normal_prn);
    result.test_prn = flag(config.test_prn);
    result.fgb_alpha = config.fgb_alpha;
    result.fgb_beta = config.fgb_beta;
    result.fgb_zeta = config.fgb_zeta;
    result.fgb_over_peak_db = config.fgb_over_peak_db;
    result.fgb_average = config.fgb_average;
    result.fgb_runtime_ms = config.fgb_runtime_ms;
    result.fgb_max_errors = config.fgb_max_errors;
    result.show_bch_failures = flag(config.show_bch_failures);
    result.sgb_detection_threshold = config.sgb_detection_threshold;
    result.quality_check = flag(config.quality_check);
    result.search_depth = config.search_depth;
    result.prn_alignment = config.prn_alignment;
    result.sgb_filter = config.sgb_filter;
    result.sgb_phase_gain = config.sgb_phase_gain;
    result.sgb_frequency_gain = config.sgb_frequency_gain;
    result.sgb_max_errors = config.sgb_max_errors;
    if (config.struct_size > offsetof(cs_config, sgb_feedback)) result.sgb_feedback = config.sgb_feedback;
    if (config.struct_size > offsetof(cs_config, fgb_header_errors)) result.fgb_header_errors = config.fgb_header_errors;
    if (config.struct_size > offsetof(cs_config, fgb_bch2_max_errors)) result.fgb_bch2_max_errors = config.fgb_bch2_max_errors;
    if (config.struct_size > offsetof(cs_config, show_fgb_bch_failures)) result.show_fgb_bch_failures = flag(config.show_fgb_bch_failures);
    if (config.struct_size > offsetof(cs_config, fgb_normal)) {
        result.fgb_normal = flag(config.fgb_normal);
        result.fgb_self_test = flag(config.fgb_self_test);
    }
    if (config.struct_size > offsetof(cs_config, fgb_max_candidates))
        result.fgb_max_candidates = config.fgb_max_candidates;
    if (config.struct_size > offsetof(cs_config, fgb_excluded_band_count)) {
        if (config.fgb_excluded_band_count > 6)
            throw std::invalid_argument("At most six FGB frequency bands can be excluded");
        for (size_t n = 0; n < config.fgb_excluded_band_count; ++n) {
            const auto& band = config.fgb_excluded_bands[n];
            result.fgb_excluded_bands.push_back({band.offset_hz, band.deviation_hz});
        }
    }
    return result;
}

cs_status input_size(cs_iq_format format, const void* input, size_t byte_count,
                     size_t& count, cs_error* error) noexcept {
    size_t width;
    switch (format) {
    case CS_IQ_CU8: width = 1; break;
    case CS_IQ_CS16: width = 2; break;
    case CS_IQ_CF32: width = 4; break;
    default: return status(error, CS_INVALID_ARGUMENT, "Unsupported I/Q format");
    }
    if ((!input && byte_count) || byte_count % (2 * width))
        return status(error, CS_INVALID_ARGUMENT, "Invalid I/Q buffer or incomplete complex sample");
    count = byte_count / (2 * width);
    return CS_OK;
}

size_t sample_count(cs_iq_format format, const void* input, size_t byte_count) {
    size_t count{};
    cs_error error{};
    if (input_size(format, input, byte_count, count, &error) != CS_OK)
        throw std::invalid_argument(error.message);
    return count;
}

void convert(cs_iq_format format, const void* input, std::span<cospas::Sample> output) {
    const size_t width = format == CS_IQ_CU8 ? 1u : format == CS_IQ_CS16 ? 2u : 4u;
    const auto* bytes = static_cast<const unsigned char*>(input);
    const auto scalar = [&](size_t offset) {
        if (format == CS_IQ_CU8) return (float(bytes[offset]) - 128.0f) / 128.0f;
        if (format == CS_IQ_CS16) {
            int16_t value;
            std::memcpy(&value, bytes + offset, sizeof(value));
            return float(value) / 32768.0f;
        }
        float value;
        std::memcpy(&value, bytes + offset, sizeof(value));
        if (!std::isfinite(value)) throw std::invalid_argument("Non-finite I/Q sample");
        return value;
    };
    for (size_t n = 0; n < output.size(); ++n)
        output[n] = {scalar(n * 2 * width), scalar((n * 2 + 1) * width)};
}

void describe(cs_result* result, const cospas::DecodeDiagnostics& diagnostics) {
    static_assert(CS_FGB_CHANNEL_COUNT == cospas::fgb_channel_count);
    for (size_t n = 0; n < diagnostics.fgb_channels.size(); ++n) {
        const auto& channel = diagnostics.fgb_channels[n];
        result->acquisition.fgb_channels[n] = {channel.active, channel.frequency_hz, channel.level_dbfs};
        result->acquisition.fgb_above_noise_db[n] = channel.above_noise_db;
    }
    std::stable_sort(result->frames.begin(), result->frames.end(), [](const auto& a, const auto& b) {
        return a.time_seconds < b.time_seconds;
    });
    result->metadata.reserve(result->frames.size());
    for (const auto& frame : result->frames) {
        cs_frame metadata{};
        metadata.generation = uint32_t(frame.generation);
        metadata.self_test = frame.self_test;
        metadata.bit_count = uint32_t(frame.raw_bits.size());
        metadata.bch_count = uint32_t(frame.bch_count);
        metadata.time_seconds = frame.time_seconds;
        metadata.frequency_offset_hz = frame.frequency_offset_hz;
        metadata.detection_level = frame.detection_level;
        metadata.header_errors = frame.header_errors;
        metadata.fgb_bit_start_sample = frame.fgb_bit_start_sample;
        text(metadata.raw_hex, cospas::hex(frame.raw_bits, frame.generation == 2 && frame.self_test));
        text(metadata.corrected_hex, cospas::hex(frame.corrected_bits, frame.generation == 2 && frame.self_test));
        for (size_t field = 0; field < metadata.bch_count; ++field) {
            metadata.bch[field].valid = frame.bch_valid[field];
            metadata.bch[field].corrected_errors = frame.bch_valid[field] ? frame.corrected_errors[field] : -1;
        }
        result->metadata.push_back(metadata);
    }
    auto& summary = result->diagnostics;
    summary.frame_count = result->frames.size();
    text(summary.tables_sha256, cospas::tables_sha256());
    summary.fgb_max_peak_db = diagnostics.fgb_max_peak_db;
    summary.fgb_candidates = diagnostics.fgb_candidates;
    summary.fgb_max_sync_votes = diagnostics.fgb_max_sync_votes;
    summary.sgb_max_detection_level = diagnostics.sgb_max_detection_level;
    summary.sgb_candidates = diagnostics.sgb_candidates;
    summary.sgb_quality_rejections = diagnostics.sgb_quality_rejections;
    summary.sgb_bch_rejections = diagnostics.sgb_bch_rejections;
    summary.fgb_trial_count = uint32_t(diagnostics.fgb_trial_count);
    for (size_t n = 0; n < diagnostics.fgb_trial_count; ++n) {
        const auto& trial = diagnostics.fgb_trials[n];
        summary.fgb_trials[n] = {trial.time_seconds, trial.frequency_hz, trial.votes, trial.offset};
    }
}
}

namespace {
class SpscIndices {
public:
    explicit SpscIndices(size_t capacity) : capacity_(capacity) {}
    bool writable() const noexcept {
        return written_.load(std::memory_order_acquire) - read_.load(std::memory_order_acquire) < capacity_;
    }
    bool readable() const noexcept {
        return read_.load(std::memory_order_acquire) != written_.load(std::memory_order_acquire);
    }
    std::optional<size_t> write_index() const noexcept {
        const auto written = written_.load(std::memory_order_relaxed);
        if (written - read_.load(std::memory_order_acquire) == capacity_) return {};
        return write_slot_;
    }
    void publish() noexcept {
        write_slot_ = (write_slot_ + 1) % capacity_;
        written_.store(written_.load(std::memory_order_relaxed) + 1, std::memory_order_release);
    }
    std::optional<size_t> read_index() const noexcept {
        const auto read = read_.load(std::memory_order_relaxed);
        if (read == written_.load(std::memory_order_acquire)) return {};
        return read_slot_;
    }
    void consume() noexcept {
        read_slot_ = (read_slot_ + 1) % capacity_;
        read_.store(read_.load(std::memory_order_relaxed) + 1, std::memory_order_release);
    }
private:
    size_t capacity_;
    size_t write_slot_{}, read_slot_{};
    std::atomic<uint64_t> written_{}, read_{};
};
static_assert(std::atomic<uint64_t>::is_always_lock_free, "Worker requires lock-free 64-bit atomics");
}

struct cs_worker {
    struct Input {
        uint64_t first_sample_index{};
        cs_iq_format format{};
        size_t byte_count{};
        std::vector<unsigned char> bytes;
    };
    cs_worker(uint32_t rate, const cospas::DecoderSettings& settings, size_t max_samples,
              size_t input_capacity, size_t output_capacity, float mixer_hz)
        : stream(rate, settings, max_samples, mixer_hz), inputs(input_capacity), outputs(output_capacity),
          input_indices(input_capacity), output_indices(output_capacity) {
        for (auto& input : inputs) input.bytes.resize(max_samples * 2 * sizeof(float));
        cs_result initial;
        describe(&initial, stream.decoder.diagnostics());
        latest_diagnostics = initial.diagnostics;
        latest_acquisition = initial.acquisition;
        thread = std::thread([this] { run(); });
    }
    ~cs_worker() {
        stop();
        while (const auto index = output_indices.read_index()) {
            cs_result_destroy(outputs[*index].result);
            output_indices.consume();
        }
    }
    void stop() {
        cancelled.store(true, std::memory_order_release);
        wake(input_epoch);
        wake(output_epoch);
        wake(progress_epoch);
        if (thread.joinable()) thread.join();
    }
    static void wake(std::atomic<uint64_t>& epoch) noexcept {
        epoch.fetch_add(1, std::memory_order_release);
        epoch.notify_one();
    }
    bool publish(cs_worker_event event) noexcept {
        while (!cancelled.load(std::memory_order_acquire)) {
            const auto epoch = output_epoch.load(std::memory_order_acquire);
            if (const auto index = output_indices.write_index()) {
                outputs[*index] = event;
                output_indices.publish();
                wake(progress_epoch);
                return true;
            }
            output_epoch.wait(epoch, std::memory_order_acquire);
        }
        cs_result_destroy(event.result);
        return false;
    }
    void fail(const cs_error& error) noexcept {
        state.store(CS_WORKER_FAILED, std::memory_order_release);
        wake(progress_epoch);
        cs_worker_event event{};
        event.kind = CS_EVENT_ERROR;
        event.error = error;
        publish(event);
    }
    void record_diagnostics(const cs_result& result) {
        std::lock_guard lock(diagnostics_mutex);
        latest_diagnostics = result.diagnostics;
        latest_acquisition = result.acquisition;
    }
    void run() noexcept {
        while (!cancelled.load(std::memory_order_acquire)) {
            const auto epoch = input_epoch.load(std::memory_order_acquire);
            const auto current_state = state.load(std::memory_order_acquire);
            cs_error error{};
            if (const auto index = input_indices.read_index()) {
                auto& input = inputs[*index];
                const auto expected = stream.decoder.next_sample_index();
                if (input.first_sample_index != expected) {
                    discontinuities.fetch_add(1, std::memory_order_relaxed);
                    missing_samples.fetch_add(input.first_sample_index - expected, std::memory_order_relaxed);
                    cs_worker_event event{};
                    event.kind = CS_EVENT_DISCONTINUITY;
                    event.expected_sample_index = expected;
                    event.actual_sample_index = input.first_sample_index;
                    if (!publish(event)) break;
                    if (cs_stream_reset(&stream, input.first_sample_index, &error) != CS_OK) {
                        fail(error);
                        return;
                    }
                }
                cs_result* result = nullptr;
                if (cs_stream_push(&stream, input.first_sample_index, input.format, input.bytes.data(),
                                   input.byte_count, &result, &error) != CS_OK) {
                    fail(error);
                    return;
                }
                record_diagnostics(*result);
                processed_blocks.fetch_add(1, std::memory_order_relaxed);
                input_indices.consume();
                wake(progress_epoch);
                if (!result->frames.empty()) {
                    cs_worker_event event{};
                    event.kind = CS_EVENT_FRAMES;
                    event.result = result;
                    if (!publish(event)) break;
                } else {
                    cs_result_destroy(result);
                }
            } else if (current_state == CS_WORKER_DRAINING) {
                cs_worker_event event{};
                event.kind = CS_EVENT_FINISHED;
                if (cs_stream_finish(&stream, &event.result, &error) != CS_OK) {
                    fail(error);
                    return;
                }
                record_diagnostics(*event.result);
                if (!publish(event)) break;
                state.store(CS_WORKER_FINISHED, std::memory_order_release);
                wake(progress_epoch);
                return;
            } else {
                input_epoch.wait(epoch, std::memory_order_acquire);
            }
        }
        state.store(CS_WORKER_STOPPED, std::memory_order_release);
        wake(progress_epoch);
    }
    cs_stream stream;
    std::vector<Input> inputs;
    std::vector<cs_worker_event> outputs;
    SpscIndices input_indices, output_indices;
    std::atomic<uint64_t> input_epoch{}, output_epoch{}, progress_epoch{};
    std::atomic<uint32_t> state{CS_WORKER_RUNNING};
    std::atomic<bool> cancelled{};
    std::atomic<uint64_t> accepted_blocks{}, processed_blocks{}, queue_full_count{};
    std::atomic<uint64_t> discontinuities{}, missing_samples{};
    uint64_t producer_end{};
    std::mutex diagnostics_mutex;
    cs_diagnostics latest_diagnostics{};
    cs_acquisition latest_acquisition{};
    std::thread thread;
};

extern "C" {
uint32_t CS_CALL cs_abi_version(void) { return CS_ABI_VERSION; }

cs_status CS_CALL cs_config_init(cs_config* config, size_t config_size, cs_error* error) {
    if (!config || (config_size < sizeof(cs_config) && config_size != offsetof(cs_config, fgb_excluded_band_count) &&
                    config_size != offsetof(cs_config, fgb_max_candidates) &&
                    config_size != offsetof(cs_config, fgb_normal) &&
                    config_size != offsetof(cs_config, show_fgb_bch_failures) &&
                    config_size != offsetof(cs_config, fgb_bch2_max_errors) &&
                    config_size != offsetof(cs_config, fgb_header_errors) &&
                    config_size != offsetof(cs_config, sgb_feedback)))
        return status(error, CS_INVALID_ARGUMENT, "Configuration output buffer is too small or NULL");
    const cospas::DecoderSettings defaults;
    const cs_config initialized = {
        static_cast<uint32_t>(std::min(config_size, sizeof(cs_config))), CS_ABI_VERSION, defaults.fgb, defaults.sgb,
        defaults.normal_prn, defaults.test_prn, defaults.fgb_alpha, defaults.fgb_beta,
        defaults.fgb_zeta, defaults.fgb_over_peak_db, defaults.fgb_average,
        defaults.fgb_runtime_ms, defaults.fgb_max_errors, defaults.show_bch_failures,
        defaults.sgb_detection_threshold, defaults.quality_check, defaults.search_depth,
        defaults.prn_alignment, defaults.sgb_filter, defaults.sgb_phase_gain,
        defaults.sgb_frequency_gain, defaults.sgb_max_errors,         defaults.sgb_feedback, defaults.fgb_header_errors,
                defaults.fgb_bch2_max_errors, defaults.show_fgb_bch_failures,
                defaults.fgb_normal, defaults.fgb_self_test, defaults.fgb_max_candidates, 0, {}
    };
    std::memcpy(config, &initialized, initialized.struct_size);
    return status(error, CS_OK, "");
}

cs_status CS_CALL cs_decode_iq(const cs_config* config, cs_iq_format format, uint32_t sample_rate_hz,
                              const void* iq_interleaved, size_t byte_count,
                              cs_result** output, cs_error* error) {
    if (!output) return status(error, CS_INVALID_ARGUMENT, "Result output pointer is NULL");
    *output = nullptr;
    return guarded(error, [&] {
        if (!config) throw std::invalid_argument("Decoder configuration is NULL");
        const auto native_settings = settings(*config);
        const auto count = sample_count(format, iq_interleaved, byte_count);
        std::vector<cospas::Sample> input;
        if (count > input.max_size()) throw std::invalid_argument("I/Q sample count exceeds capacity");
        input.resize(count);
        convert(format, iq_interleaved, input);
        auto result = std::make_unique<cs_result>();
        cospas::DecodeDiagnostics diagnostics;
        result->frames = cospas::decode(input, sample_rate_hz, native_settings, &diagnostics);
        describe(result.get(), diagnostics);
        *output = result.release();
    });
}

cs_status CS_CALL cs_result_get_diagnostics(const cs_result* result, cs_diagnostics* output,
                                           size_t output_size, cs_error* error) {
    if (!result || !output || output_size < sizeof(cs_diagnostics))
        return status(error, CS_INVALID_ARGUMENT, "Invalid diagnostics result or output buffer");
    *output = result->diagnostics;
    return status(error, CS_OK, "");
}

cs_status CS_CALL cs_result_get_acquisition(const cs_result* result, cs_acquisition* output,
                                            size_t output_size, cs_error* error) {
    if (!result || !output || (output_size < sizeof(cs_acquisition) &&
                              output_size != offsetof(cs_acquisition, fgb_above_noise_db)))
        return status(error, CS_INVALID_ARGUMENT, "Invalid acquisition result or output buffer");
    std::memcpy(output, &result->acquisition, std::min(output_size, sizeof(cs_acquisition)));
    return status(error, CS_OK, "");
}

cs_status CS_CALL cs_result_get_frame(const cs_result* result, size_t index, cs_frame* output,
                                     size_t output_size, cs_error* error) {
    if (!result || !output || (output_size < sizeof(cs_frame) &&
        output_size != offsetof(cs_frame, header_errors) && output_size != offsetof(cs_frame, fgb_bit_start_sample)))
        return status(error, CS_INVALID_ARGUMENT, "Invalid frame result or output buffer");
    if (index >= result->metadata.size())
        return status(error, CS_OUT_OF_RANGE, "Frame index is out of range");
    std::memcpy(output, &result->metadata[index], std::min(output_size, sizeof(cs_frame)));
    return status(error, CS_OK, "");
}

cs_status CS_CALL cs_result_get_trace(const cs_result* result, size_t index, cs_trace_kind kind,
                                     const float** samples, size_t* count, cs_error* error) {
    if (samples) *samples = nullptr;
    if (count) *count = 0;
    if (!result || !samples || !count)
        return status(error, CS_INVALID_ARGUMENT, "Invalid trace result or output pointers");
    if (index >= result->frames.size())
        return status(error, CS_OUT_OF_RANGE, "Frame index is out of range");
    const auto& frame = result->frames[index];
    const std::vector<float>* trace;
    switch (kind) {
    case CS_TRACE_PHASE_ERROR: trace = &frame.phase_error; break;
    case CS_TRACE_RECOVERED_I: trace = &frame.recovered_i; break;
    case CS_TRACE_RECOVERED_Q: trace = &frame.recovered_q; break;
    default: return status(error, CS_INVALID_ARGUMENT, "Unsupported engineering trace");
    }
    *samples = trace->empty() ? nullptr : trace->data();
    *count = trace->size();
    return status(error, CS_OK, "");
}

void CS_CALL cs_result_destroy(cs_result* result) { delete result; }

cs_status CS_CALL cs_stream_create(const cs_config* config, uint32_t sample_rate_hz,
                                   size_t max_block_samples, cs_stream** output, cs_error* error) {
    return cs_stream_create_with_mixer(config, sample_rate_hz, max_block_samples, 0, output, error);
}

cs_status CS_CALL cs_stream_create_with_mixer(const cs_config* config, uint32_t sample_rate_hz,
                                              size_t max_block_samples, float mixer_hz,
                                              cs_stream** output, cs_error* error) {
    if (!output) return status(error, CS_INVALID_ARGUMENT, "Stream output pointer is NULL");
    *output = nullptr;
    return guarded(error, [&] {
        if (!config) throw std::invalid_argument("Decoder configuration is NULL");
        const auto native_settings = settings(*config);
        if (!max_block_samples || max_block_samples > std::vector<cospas::Sample>().max_size())
            throw std::invalid_argument("Invalid maximum stream block size");
        *output = new cs_stream(sample_rate_hz, native_settings, max_block_samples, mixer_hz);
    });
}

cs_status CS_CALL cs_stream_push(cs_stream* stream, uint64_t first_sample_index, cs_iq_format format,
                                 const void* iq_interleaved, size_t byte_count,
                                 cs_result** output, cs_error* error) {
    if (!output) return status(error, CS_INVALID_ARGUMENT, "Result output pointer is NULL");
    *output = nullptr;
    return guarded(error, [&] {
        if (!stream || stream->failed) throw std::invalid_argument("Invalid stream or reset required");
        if (first_sample_index != stream->decoder.next_sample_index())
            throw std::invalid_argument("Input discontinuity: reset stream explicitly before continuing");
        const auto count = sample_count(format, iq_interleaved, byte_count);
        if (count > stream->scratch.size()) throw std::invalid_argument("Stream block exceeds reserved capacity");
        const auto input = std::span(stream->scratch).first(count);
        convert(format, iq_interleaved, input);
        auto result = std::make_unique<cs_result>();
        stream->failed = true;
        stream->decoder.push(input, result->frames);
        describe(result.get(), stream->decoder.diagnostics());
        stream->failed = false;
        *output = result.release();
    });
}

cs_status CS_CALL cs_stream_finish(cs_stream* stream, cs_result** output, cs_error* error) {
    if (!output) return status(error, CS_INVALID_ARGUMENT, "Result output pointer is NULL");
    *output = nullptr;
    return guarded(error, [&] {
        if (!stream || stream->failed) throw std::invalid_argument("Invalid stream or reset required");
        auto result = std::make_unique<cs_result>();
        stream->failed = true;
        stream->decoder.finish(result->frames);
        describe(result.get(), stream->decoder.diagnostics());
        stream->failed = false;
        *output = result.release();
    });
}

cs_status CS_CALL cs_stream_reset(cs_stream* stream, uint64_t next_sample_index, cs_error* error) {
    if (!stream) return status(error, CS_INVALID_ARGUMENT, "Stream is NULL");
    stream->decoder.reset(next_sample_index);
    stream->failed = false;
    return status(error, CS_OK, "");
}

void CS_CALL cs_stream_destroy(cs_stream* stream) { delete stream; }

cs_status CS_CALL cs_worker_create(const cs_config* config, uint32_t sample_rate_hz, size_t max_block_samples,
                                   size_t input_queue_blocks, size_t output_queue_events,
                                   cs_worker** output, cs_error* error) {
    return cs_worker_create_with_mixer(config, sample_rate_hz, max_block_samples, input_queue_blocks,
                                       output_queue_events, 0, output, error);
}

cs_status CS_CALL cs_worker_create_with_mixer(const cs_config* config, uint32_t sample_rate_hz,
                                              size_t max_block_samples, size_t input_queue_blocks,
                                              size_t output_queue_events, float mixer_hz,
                                              cs_worker** output, cs_error* error) {
    if (!output) return status(error, CS_INVALID_ARGUMENT, "Worker output pointer is NULL");
    *output = nullptr;
    return guarded(error, [&] {
        if (!config) throw std::invalid_argument("Decoder configuration is NULL");
        const auto native_settings = settings(*config);
        if (!max_block_samples || max_block_samples > std::vector<cospas::Sample>().max_size() ||
            !input_queue_blocks || !output_queue_events ||
            max_block_samples > std::vector<unsigned char>().max_size() / (2 * sizeof(float)) ||
            input_queue_blocks > std::vector<cs_worker::Input>().max_size() ||
            output_queue_events > std::vector<cs_worker_event>().max_size() ||
            input_queue_blocks > std::numeric_limits<size_t>::max() / (max_block_samples * 2 * sizeof(float)))
            throw std::invalid_argument("Invalid worker queue capacity");
        *output = new cs_worker(sample_rate_hz, native_settings, max_block_samples,
                                input_queue_blocks, output_queue_events, mixer_hz);
    });
}

cs_status CS_CALL cs_worker_submit(cs_worker* worker, uint64_t first_sample_index, cs_iq_format format,
                                   const void* iq_interleaved, size_t byte_count, cs_error* error) {
    if (!worker) return status(error, CS_INVALID_ARGUMENT, "Worker is NULL");
    if (worker->state.load(std::memory_order_acquire) != CS_WORKER_RUNNING ||
        worker->cancelled.load(std::memory_order_acquire))
        return status(error, CS_INVALID_STATE, "Worker no longer accepts input");
    size_t count{};
    const auto code = input_size(format, iq_interleaved, byte_count, count, error);
    if (code != CS_OK) return code;
    if (!count || count > worker->stream.scratch.size() ||
        count > std::numeric_limits<uint64_t>::max() - first_sample_index ||
        first_sample_index < worker->producer_end)
        return status(error, CS_INVALID_ARGUMENT, "Invalid worker block size or non-monotonic sample index");
    const auto index = worker->input_indices.write_index();
    if (!index) {
        worker->queue_full_count.fetch_add(1, std::memory_order_relaxed);
        return status(error, CS_QUEUE_FULL, "Worker input queue is full; block was not accepted");
    }

    auto& input = worker->inputs[*index];
    std::memcpy(input.bytes.data(), iq_interleaved, byte_count);
    input.first_sample_index = first_sample_index;
    input.format = format;
    input.byte_count = byte_count;
    worker->producer_end = first_sample_index + count;
    worker->accepted_blocks.fetch_add(1, std::memory_order_relaxed);
    worker->input_indices.publish();
    cs_worker::wake(worker->input_epoch);
    cs_worker::wake(worker->progress_epoch);
    return status(error, CS_OK, "");
}

cs_status CS_CALL cs_worker_get_diagnostics(cs_worker* worker, cs_diagnostics* output,
                                           size_t output_size, cs_error* error) {
    if (!worker || !output || output_size < sizeof(cs_diagnostics))
        return status(error, CS_INVALID_ARGUMENT, "Worker diagnostics buffer is too small or NULL");
    const std::unique_lock lock(worker->diagnostics_mutex, std::try_to_lock);
    if (!lock.owns_lock()) return status(error, CS_AGAIN, "DSP diagnostics snapshot is being updated");
    *output = worker->latest_diagnostics;
    return status(error, CS_OK, "");
}

cs_status CS_CALL cs_worker_get_acquisition(cs_worker* worker, cs_acquisition* output,
                                            size_t output_size, cs_error* error) {
    if (!worker || !output || (output_size < sizeof(cs_acquisition) &&
                              output_size != offsetof(cs_acquisition, fgb_above_noise_db)))
        return status(error, CS_INVALID_ARGUMENT, "Worker acquisition buffer is too small or NULL");
    const std::unique_lock lock(worker->diagnostics_mutex, std::try_to_lock);
    if (!lock.owns_lock()) return status(error, CS_AGAIN, "DSP acquisition snapshot is being updated");
    std::memcpy(output, &worker->latest_acquisition, std::min(output_size, sizeof(cs_acquisition)));
    return status(error, CS_OK, "");
}

cs_status CS_CALL cs_worker_finish(cs_worker* worker, cs_error* error) {
    if (!worker) return status(error, CS_INVALID_ARGUMENT, "Worker is NULL");
    auto expected = uint32_t(CS_WORKER_RUNNING);
    if (!worker->cancelled.load(std::memory_order_acquire) &&
        worker->state.compare_exchange_strong(expected, CS_WORKER_DRAINING, std::memory_order_acq_rel)) {
        cs_worker::wake(worker->input_epoch);
        return status(error, CS_OK, "");
    }
    if (expected == CS_WORKER_DRAINING || expected == CS_WORKER_FINISHED)
        return status(error, CS_OK, "");
    return status(error, CS_INVALID_STATE, "Worker cannot be finalized");
}

cs_status CS_CALL cs_worker_poll(cs_worker* worker, cs_worker_event* output,
                                 size_t output_size, cs_error* error) {
    if (!worker || !output || output_size < sizeof(cs_worker_event))
        return status(error, CS_INVALID_ARGUMENT, "Invalid worker event output");
    *output = {};
    const auto index = worker->output_indices.read_index();
    if (!index) return status(error, CS_AGAIN, "No worker event available");
    *output = worker->outputs[*index];
    worker->output_indices.consume();
    cs_worker::wake(worker->output_epoch);
    return status(error, CS_OK, "");
}

cs_status CS_CALL cs_worker_wait_ready(cs_worker* worker, cs_error* error) {
    if (!worker) return status(error, CS_INVALID_ARGUMENT, "Worker is NULL");
    for (;;) {
        const auto epoch = worker->progress_epoch.load(std::memory_order_acquire);
        const auto state = worker->state.load(std::memory_order_acquire);
        if (worker->cancelled.load(std::memory_order_acquire))
            return status(error, CS_INVALID_STATE, "Worker has been stopped");
        if (worker->output_indices.readable() ||
            (state == CS_WORKER_RUNNING && worker->input_indices.writable()) ||
            state == CS_WORKER_FINISHED || state == CS_WORKER_FAILED || state == CS_WORKER_STOPPED)
            return status(error, CS_OK, "");
        worker->progress_epoch.wait(epoch, std::memory_order_acquire);
    }
}

cs_status CS_CALL cs_worker_get_stats(const cs_worker* worker, cs_worker_stats* output,
                                      size_t output_size, cs_error* error) {
    if (!worker || !output || output_size < sizeof(cs_worker_stats))
        return status(error, CS_INVALID_ARGUMENT, "Invalid worker statistics output");
    *output = {
        worker->state.load(std::memory_order_acquire),
        worker->accepted_blocks.load(std::memory_order_relaxed),
        worker->processed_blocks.load(std::memory_order_relaxed),
        worker->queue_full_count.load(std::memory_order_relaxed),
        worker->discontinuities.load(std::memory_order_relaxed),
        worker->missing_samples.load(std::memory_order_relaxed)
    };
    return status(error, CS_OK, "");
}

cs_status CS_CALL cs_worker_stop(cs_worker* worker, cs_error* error) {
    if (!worker) return status(error, CS_INVALID_ARGUMENT, "Worker is NULL");
    return guarded(error, [&] { worker->stop(); });
}

void CS_CALL cs_worker_destroy(cs_worker* worker) { delete worker; }
}
