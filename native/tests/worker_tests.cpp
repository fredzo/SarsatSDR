#include <cospas/c_api.h>
#include "wav.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <memory>
#include <new>
#include <numbers>
#include <stdexcept>
#include <thread>

namespace {
thread_local bool forbid_allocations = false;
struct NoAllocations {
    NoAllocations() { forbid_allocations = true; }
    ~NoAllocations() { forbid_allocations = false; }
};
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
void check(cs_status code, const cs_error& error) {
    if (code != CS_OK) throw std::runtime_error(error.message);
}
using Worker = std::unique_ptr<cs_worker, decltype(&cs_worker_destroy)>;
using Result = std::unique_ptr<cs_result, decltype(&cs_result_destroy)>;
Worker create(std::size_t capacity, std::size_t input = 1, std::size_t output = 1, bool sgb = false,
              std::uint32_t rate = 230400) {
    cs_config config{};
    cs_error error{};
    check(cs_config_init(&config, sizeof(config), &error), error);
    config.fgb = sgb ? 0u : 1u;
    config.sgb = sgb ? 1u : 0u;
    cs_worker* worker = nullptr;
    check(cs_worker_create(&config, rate, capacity, input, output, &worker, &error), error);
    return Worker(worker, cs_worker_destroy);
}
template<class Predicate>
void wait_until(Predicate predicate) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    while (!predicate()) {
        require(std::chrono::steady_clock::now() < deadline, "Worker timed out");
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
}
cs_worker_stats stats(cs_worker* worker) {
    cs_worker_stats result{};
    cs_error error{};
    check(cs_worker_get_stats(worker, &result, sizeof(result), &error), error);
    return result;
}
cs_worker_event next_event(cs_worker* worker) {
    cs_worker_event event{};
    cs_error error{};
    wait_until([&] {
        const auto code = cs_worker_poll(worker, &event, sizeof(event), &error);
        if (code == CS_AGAIN) return false;
        check(code, error);
        return true;
    });
    return event;
}
void backpressure_and_stop() {
    auto worker = create(1);
    cs_error error{};
    const uint8_t sample[] = {128, 128};
    {
        NoAllocations guard;
        check(cs_worker_submit(worker.get(), 1, CS_IQ_CU8, sample, sizeof(sample), &error), error);
    }
    wait_until([&] { return stats(worker.get()).processed_blocks == 1; });
    check(cs_worker_submit(worker.get(), 3, CS_IQ_CU8, sample, sizeof(sample), &error), error);
    wait_until([&] { return stats(worker.get()).discontinuities == 2; });
    {
        NoAllocations guard;
        require(cs_worker_submit(worker.get(), 5, CS_IQ_CU8, sample, sizeof(sample), &error) == CS_QUEUE_FULL,
                "Output backpressure did not saturate input");
        require(cs_worker_submit(worker.get(), 5, 99, sample, sizeof(sample), &error) == CS_INVALID_ARGUMENT,
                "Unknown format accepted");
        require(cs_worker_submit(worker.get(), 2, CS_IQ_CU8, sample, sizeof(sample), &error) == CS_INVALID_ARGUMENT,
                "Overlapping packet accepted");
    }
    const auto snapshot = stats(worker.get());
    require(snapshot.accepted_blocks == 2 && snapshot.processed_blocks == 1 &&
            snapshot.queue_full_count == 1 && snapshot.missing_samples == 2,
            "Overflow/gap counters are inconsistent");
    check(cs_worker_stop(worker.get(), &error), error);
    check(cs_worker_stop(worker.get(), &error), error);
    require(stats(worker.get()).state == CS_WORKER_STOPPED, "Cancellation did not stop worker");
    const auto event = next_event(worker.get());
    require(event.kind == CS_EVENT_DISCONTINUITY && event.expected_sample_index == 0 &&
            event.actual_sample_index == 1 && !event.result, "Gap event lost its sample indices");
}
void finish_and_error() {
    cs_error error{};
    {
        auto worker = create(1);
        check(cs_worker_finish(worker.get(), &error), error);
        check(cs_worker_finish(worker.get(), &error), error);
        auto event = next_event(worker.get());
        Result result(event.result, cs_result_destroy);
        require(event.kind == CS_EVENT_FINISHED && result, "Empty drain lost final event");
        const uint8_t sample[] = {128, 128};
        require(cs_worker_submit(worker.get(), 0, CS_IQ_CU8, sample, sizeof(sample), &error) == CS_INVALID_STATE,
                "Finalized worker accepted input");
    }
    {
        auto worker = create(1);
        const float invalid[] = {0, std::numeric_limits<float>::quiet_NaN()};
        check(cs_worker_submit(worker.get(), 0, CS_IQ_CF32, invalid, sizeof(invalid), &error), error);
        const auto event = next_event(worker.get());
        require(event.kind == CS_EVENT_ERROR && event.error.code == CS_INVALID_ARGUMENT &&
                std::strstr(event.error.message, "Non-finite") && !event.result,
                "Asynchronous DSP failure was not surfaced");
        require(stats(worker.get()).state == CS_WORKER_FAILED, "Failed worker state was hidden");
    }
}
void diagnostics_without_frames(const char* path) {
    auto signal = cospas::read_wav(path);
    signal.samples.resize(std::size_t(signal.sample_rate_hz) * 102 / 100);
    auto worker = create(signal.samples.size(), 1, 1, true, signal.sample_rate_hz);
    cs_error error{};
    check(cs_worker_submit(worker.get(), 0, CS_IQ_CF32, signal.samples.data(),
                           signal.samples.size() * sizeof(cospas::Sample), &error), error);
    wait_until([&] { return stats(worker.get()).processed_blocks == 1; });
    cs_diagnostics diagnostics{};
    check(cs_worker_get_diagnostics(worker.get(), &diagnostics, sizeof(diagnostics), &error), error);
    require(diagnostics.sgb_max_detection_level > 0 && diagnostics.frame_count == 0,
            "Live diagnostics were hidden until a frame arrived");
    cs_worker_event event{};
    require(cs_worker_poll(worker.get(), &event, sizeof(event), &error) == CS_AGAIN,
            "Diagnostic snapshot unexpectedly created a frame event");
}

void fgb_acquisition_without_frames(const char* path) {
    auto signal = cospas::read_wav(path);
    const auto warmup = std::size_t(signal.sample_rate_hz) * 2;
    std::vector<cospas::Sample> input(warmup + signal.samples.size());
    for (std::size_t n = 0; n < warmup; ++n)
        input[n] = signal.samples[n % (signal.sample_rate_hz / 5)];
    std::copy(signal.samples.begin(), signal.samples.end(), input.begin() + static_cast<std::ptrdiff_t>(warmup));
    const auto capacity = signal.sample_rate_hz / 20;
    auto worker = create(capacity, 1, 1, false, signal.sample_rate_hz);
    cs_error error{};
    std::array<bool, 4> acquired{};
    bool before_frame = false, ended = false;
    std::size_t blocks = 0, frames = 0;
    for (std::size_t position = 0; position < input.size();) {
        const auto count = std::min<std::size_t>(capacity, input.size() - position);
        check(cs_worker_submit(worker.get(), position, CS_IQ_CF32, input.data() + position,
                               count * sizeof(cospas::Sample), &error), error);
        position += count;
        ++blocks;
        wait_until([&] { return stats(worker.get()).processed_blocks == blocks; });
        cs_acquisition snapshot{};
        {
            NoAllocations guard;
            check(cs_worker_get_acquisition(worker.get(), &snapshot, sizeof(snapshot), &error), error);
        }
        for (std::size_t n = 0; n < acquired.size(); ++n) {
            const auto& channel = snapshot.fgb_channels[n];
            if (channel.active) {
                before_frame |= frames == 0;
                acquired[n] = true;
                require(std::isfinite(channel.level_dbfs) && std::abs(channel.frequency_offset_hz) < 75000,
                        "Active FGB channel lost its acquisition level/frequency");
            } else if (acquired[n]) ended = true;
        }
        cs_worker_event event{};
        auto code = cs_worker_poll(worker.get(), &event, sizeof(event), &error);
        while (code != CS_AGAIN) {
            check(code, error);
            Result result(event.result, cs_result_destroy);
            require(event.kind == CS_EVENT_FRAMES, "FGB acquisition produced an unexpected worker event");
            cs_diagnostics diagnostics{};
            check(cs_result_get_diagnostics(result.get(), &diagnostics, sizeof(diagnostics), &error), error);
            frames += diagnostics.frame_count;
            code = cs_worker_poll(worker.get(), &event, sizeof(event), &error);
        }
    }
    require(before_frame && ended && frames > 0,
            "Worker hid active FGB trials until BCH, retained finished markers, or lost its frame");
}

void real_capture(const char* path, float mixer_hz = 0) {
    auto signal = cospas::read_wav(path);
    cospas::DecoderSettings settings;
    settings.fgb = false;
    const auto expected = cospas::decode(signal.samples, signal.sample_rate_hz, settings);
    require(!expected.empty(), "Worker test requires actual SGB frames");
    if (mixer_hz != 0)
        for (std::size_t n = 0; n < signal.samples.size(); ++n) {
            const double angle = 2 * std::numbers::pi * mixer_hz * double(n) / signal.sample_rate_hz;
            signal.samples[n] *= cospas::Sample{static_cast<float>(std::cos(angle)),
                                                static_cast<float>(std::sin(angle))};
        }
    cs_config config{};
    cs_error error{};
    check(cs_config_init(&config, sizeof(config), &error), error);
    config.fgb = 0;
    cs_worker* created = nullptr;
    check(cs_worker_create_with_mixer(&config, signal.sample_rate_hz, 4093, 3, 1, mixer_hz,
                                       &created, &error), error);
    Worker worker(created, cs_worker_destroy);
    std::vector<Result> results;
    bool finished = false;
    bool gap_reported = false;
    const auto origin = 2 * uint64_t(signal.sample_rate_hz);
    const auto poll = [&] {
        cs_worker_event event{};
        const auto code = cs_worker_poll(worker.get(), &event, sizeof(event), &error);
        if (code == CS_AGAIN) return false;
        check(code, error);
        Result result(event.result, cs_result_destroy);
        if (event.kind == CS_EVENT_DISCONTINUITY) {
            require(!gap_reported && event.expected_sample_index == 0 &&
                    event.actual_sample_index == origin && !result, "Gap event has incorrect sample positions");
            gap_reported = true;
            return true;
        }
        require(event.kind == CS_EVENT_FRAMES || event.kind == CS_EVENT_FINISHED,
                "Continuous capture produced a gap or DSP error");
        require(bool(result), "Frame/final event has no result");
        finished = event.kind == CS_EVENT_FINISHED;
        results.push_back(std::move(result));
        return true;
    };
    std::size_t accepted = 0;
    for (std::size_t position = 0; position < signal.samples.size();) {
        const auto count = std::min<std::size_t>(4093, signal.samples.size() - position);
        cs_status code;
        {
            NoAllocations guard;
            code = cs_worker_submit(worker.get(), origin + position, CS_IQ_CF32, signal.samples.data() + position,
                                    count * sizeof(cospas::Sample), &error);
        }
        if (code == CS_QUEUE_FULL) {
            if (!poll()) check(cs_worker_wait_ready(worker.get(), &error), error);
            continue;
        }
        check(code, error);
        std::fill_n(signal.samples.begin() + static_cast<std::ptrdiff_t>(position), count, cospas::Sample{});
        position += count;
        ++accepted;
        while (poll()) {}
    }
    check(cs_worker_finish(worker.get(), &error), error);
    wait_until([&] { poll(); return finished; });
    check(cs_worker_stop(worker.get(), &error), error);
    const auto snapshot = stats(worker.get());
    cs_diagnostics live_diagnostics{};
    check(cs_worker_get_diagnostics(worker.get(), &live_diagnostics, sizeof(live_diagnostics), &error), error);
    require(live_diagnostics.sgb_candidates >= expected.size() && live_diagnostics.sgb_max_detection_level > 0,
            "Worker diagnostics snapshot did not include completed DSP blocks");
    require(snapshot.accepted_blocks == accepted && snapshot.processed_blocks == accepted &&
            snapshot.discontinuities == 1 && snapshot.missing_samples == origin && gap_reported,
            "Drain did not process every accepted block or report the gap");
    worker.reset();
    std::size_t index = 0;
    for (const auto& result : results) {
        cs_diagnostics diagnostics{};
        check(cs_result_get_diagnostics(result.get(), &diagnostics, sizeof(diagnostics), &error), error);
        for (std::size_t n = 0; n < diagnostics.frame_count; ++n) {
            require(index < expected.size(), "Worker duplicated a frame");
            cs_frame frame{};
            check(cs_result_get_frame(result.get(), n, &frame, sizeof(frame), &error), error);
            require(frame.raw_hex == cospas::hex(expected[index].raw_bits) &&
                    frame.corrected_hex == cospas::hex(expected[index].corrected_bits),
                    "Worker changed received bits/BCH or retained a producer buffer");
            require(frame.time_seconds == expected[index].time_seconds + 2,
                    "Worker reset lost absolute sample time");
            require(std::abs(frame.frequency_offset_hz - expected[index].frequency_offset_hz) < 2,
                    "Worker NCO did not restore expected RF frequency");
            const float* trace = nullptr;
            size_t count = 0;
            check(cs_result_get_trace(result.get(), n, CS_TRACE_RECOVERED_I, &trace, &count, &error), error);
            require(count == expected[index].recovered_i.size() &&
                    (mixer_hz != 0 || std::equal(trace, trace + count, expected[index].recovered_i.begin())),
                    "Polled result trace did not survive worker destruction");
            ++index;
        }
    }
    require(index == expected.size(), "Worker lost frames");
}
}

void* operator new(std::size_t size) {
    if (forbid_allocations) throw std::bad_alloc();
    if (auto* memory = std::malloc(size ? size : 1)) return memory;
    throw std::bad_alloc();
}
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete[](void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete[](void* memory, std::size_t) noexcept { std::free(memory); }

int main(int argc, char** argv) {
    try {
        if (argc != 3) throw std::invalid_argument("Expected SGB and FGB capture paths");
        backpressure_and_stop();
        finish_and_error();
        diagnostics_without_frames(argv[1]);
        fgb_acquisition_without_frames(argv[2]);
        real_capture(argv[1]);
        real_capture(argv[1], 10000);
        std::cout << "Bounded worker: allocation-free submit, backpressure, gaps, cancellation, drain and actual frames verified\n";
        return 0;
    } catch (const std::exception& error) {
        forbid_allocations = false;
        std::cerr << error.what() << '\n';
        return 1;
    }
}
