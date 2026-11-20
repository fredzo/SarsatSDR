#include <cospas/c_api.h>
#include "beacon.hpp"
#include "wav.hpp"
#include "rtl_usb.hpp"
#include "rtl2832.hpp"
#include "rtl_iq_capture.hpp"
#include "telemetry.hpp"
#include "fgb_fm.hpp"

#include <libusb.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <charconv>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string_view>
#include <thread>

namespace {
void check(cs_status code, const cs_error& error) {
    if (code != CS_OK) throw std::runtime_error(error.message);
}

void collect_result(cs_result* decoded, cs_diagnostics& diagnostics, std::vector<cs_frame>& frames,
                    double time_offset = 0) {
    const std::unique_ptr<cs_result, decltype(&cs_result_destroy)> result(decoded, cs_result_destroy);
    cs_error error{};
    check(cs_result_get_diagnostics(result.get(), &diagnostics, sizeof(diagnostics), &error), error);
    frames.reserve(frames.size() + diagnostics.frame_count);
    for (std::size_t n = 0; n < diagnostics.frame_count; ++n) {
        cs_frame frame{};
        check(cs_result_get_frame(result.get(), n, &frame, sizeof(frame), &error), error);
        frame.time_seconds -= time_offset;
        if (frame.time_seconds >= 0) frames.push_back(frame);
    }
}

void write_json_string(std::string_view text) {
    std::cout << '"';
    for (const char c : text) {
        if (c == '"' || c == '\\') std::cout << '\\' << c;
        else if (static_cast<unsigned char>(c) < 0x20) std::cout << ' ';
        else std::cout << c;
    }
    std::cout << '"';
}

void write_frame(const cs_frame& frame, const cs_result* result = nullptr, std::size_t index = 0) {
    std::cout << "{\"generation\":" << frame.generation
              << ",\"mode\":\"" << (frame.self_test ? "self_test" : "normal") << '"'
              << ",\"headerErrors\":" << frame.header_errors
              << ",\"timeSeconds\":" << frame.time_seconds
              << ",\"frequencyOffsetHz\":" << frame.frequency_offset_hz << ",\"beaconType\":";
    write_json_string(cospas::cli::beacon_type(frame.corrected_hex, frame.generation));
    std::cout << ",\"rawHex\":\"" << frame.raw_hex
              << "\",\"correctedHex\":\"" << frame.corrected_hex
              << "\",\"bch\":[";
    for (std::size_t field = 0; field < frame.bch_count; ++field) {
        if (field) std::cout << ',';
        std::cout << "{\"valid\":" << (frame.bch[field].valid ? "true" : "false")
                  << ",\"correctedErrors\":";
        if (frame.bch[field].valid) std::cout << frame.bch[field].corrected_errors;
        else std::cout << "null";
        std::cout << '}';
    }
    std::cout << "],\"fields\":[";
    bool first_field = true;
    for (const auto& field : cospas::cli::describe_beacon(frame.corrected_hex, frame.generation, frame.self_test)) {
        if (!first_field) std::cout << ',';
        first_field = false;
        std::cout << "{\"section\":";
        write_json_string(field.section);
        std::cout << ",\"name\":";
        write_json_string(field.name);
        std::cout << ",\"value\":";
        write_json_string(field.value);
        std::cout << '}';
    }
    std::cout << ']';
    if (result) {
        std::cout << ",\"traces\":{";
        cs_error error{};
        for (const auto kind : {CS_TRACE_PHASE_ERROR, CS_TRACE_RECOVERED_I, CS_TRACE_RECOVERED_Q}) {
            if (kind != CS_TRACE_PHASE_ERROR) std::cout << ',';
            const float* values = nullptr;
            std::size_t count = 0;
            check(cs_result_get_trace(result, index, static_cast<cs_trace_kind>(kind), &values, &count, &error), error);
            const auto stride = std::max<std::size_t>(1, (count + 1023) / 1024);
            std::cout << '"' << (kind == CS_TRACE_PHASE_ERROR ? "phase" : kind == CS_TRACE_RECOVERED_I ? "i" : "q")
                      << "\":{\"count\":" << count << ",\"stride\":" << stride << ",\"values\":[";
            for (std::size_t n = 0; n < count; n += stride) {
                if (n) std::cout << ',';
                std::cout << values[n];
            }
            std::cout << "]}";
        }
        std::cout << '}';
    }
    std::cout << '}';
}

void emit_frames(const cs_result* result, double time_offset = 0) {
    cs_error error{};
    cs_diagnostics diagnostics{};
    check(cs_result_get_diagnostics(result, &diagnostics, sizeof(diagnostics), &error), error);
    for (std::size_t n = 0; n < diagnostics.frame_count; ++n) {
        cs_frame frame{};
        check(cs_result_get_frame(result, n, &frame, sizeof(frame), &error), error);
        frame.time_seconds -= time_offset;
        if (frame.time_seconds < 0) continue;
        std::cout << "{\"type\":\"frame\",\"frame\":";
        write_frame(frame, result, n);
        std::cout << "}\n" << std::flush;
    }
}

void emit_acquisition(const cs_acquisition& acquisition) {
    std::cout << "{\"type\":\"acquisition\",\"channels\":[";
    bool first = true;
    for (std::size_t n = 0; n < std::size(acquisition.fgb_channels); ++n) {
        const auto& channel = acquisition.fgb_channels[n];
        if (!channel.active) continue;
        if (!first) std::cout << ',';
        first = false;
        std::cout << "{\"channel\":" << n << ",\"frequencyOffsetHz\":" << channel.frequency_offset_hz
                  << ",\"levelDbfs\":" << channel.level_dbfs << '}';
    }
    std::cout << "]}\n" << std::flush;
}

void emit_acquisition(const cs_result* result) {
    cs_acquisition acquisition{};
    cs_error error{};
    check(cs_result_get_acquisition(result, &acquisition, sizeof(acquisition), &error), error);
    emit_acquisition(acquisition);
}

void emit_spectrum(const cospas::cli::Spectrum::Line& line, double time, std::size_t gain_index = 0,
                   float bandwidth_level = std::numeric_limits<float>::quiet_NaN()) {
    if (time <= 0) return;
    std::cout << std::setprecision(8) << "{\"type\":\"spectrum\",\"timeSeconds\":" << time
              << ",\"startHz\":406000000,\"binWidthHz\":97.65625,\"displayOffsetDb\":"
              << cospas::cli::spectrum_display_offset_db(gain_index) << ",\"fullBandwidthDbm\":";
    if (std::isfinite(bandwidth_level))
        std::cout << bandwidth_level + cospas::cli::spectrum_display_offset_db(gain_index);
    else std::cout << "null";
    std::cout << ",\"dbfs\":[";
    for (std::size_t n = 0; n < line.size(); ++n) {
        if (n) std::cout << ',';
        if (std::isfinite(line[n])) std::cout << line[n];
        else std::cout << "null";
    }
    std::cout << "]}\n" << std::flush;
}

template<class T>
T number(const char* text, std::string_view option) {
    const std::string_view token(text);
    T value{};
#ifdef _LIBCPP_VERSION
    // NDK libc++ lacks floating-point from_chars.
    if constexpr (std::is_floating_point_v<T>) {
        char* end = nullptr;
        const double parsed = token.empty() || token[0] == '+' || std::isspace(static_cast<unsigned char>(token[0]))
            ? std::numeric_limits<double>::quiet_NaN() : std::strtod(text, &end);
        if (end != token.data() + token.size() || !std::isfinite(parsed))
            throw std::invalid_argument("Invalid number for " + std::string(option) + ": " + std::string(token));
        return T(parsed);
    } else
#endif
    {
    const auto [end, error] = std::from_chars(token.data(), token.data() + token.size(), value);
    if (error != std::errc{} || end != token.data() + token.size() || !std::isfinite(value))
        throw std::invalid_argument("Invalid number for " + std::string(option) + ": " + std::string(token));
    return value;
    }
}

bool setting_option(std::string_view arg, int& n, int argc, char** argv, cs_config& s) {
    if (arg == "--fgb-only") s.sgb = 0;
    else if (arg == "--sgb-only") s.fgb = 0;
    else if (arg == "--normal-prn-only") s.test_prn = 0;
    else if (arg == "--test-prn-only") s.normal_prn = 0;
    else if (arg == "--show-bch-failures") s.show_bch_failures = 1;
    else if (arg == "--show-fgb-bch-failures") s.show_fgb_bch_failures = 1;
    else if (arg == "--no-quality-check") s.quality_check = 0;
    else {
        if (n + 1 >= argc) return false;
        if (arg == "--sgb-threshold") s.sgb_detection_threshold = number<float>(argv[++n], arg);
        else if (arg == "--sgb-phase-gain") s.sgb_phase_gain = number<float>(argv[++n], arg);
        else if (arg == "--sgb-frequency-gain") s.sgb_frequency_gain = number<float>(argv[++n], arg);
        else if (arg == "--sgb-filter") s.sgb_filter = number<float>(argv[++n], arg);
        else if (arg == "--sgb-feedback") s.sgb_feedback = number<float>(argv[++n], arg);
        else if (arg == "--sgb-max-errors") s.sgb_max_errors = number<int>(argv[++n], arg);
        else if (arg == "--search-depth") s.search_depth = number<int>(argv[++n], arg);
        else if (arg == "--prn-alignment") s.prn_alignment = number<int>(argv[++n], arg);
        else if (arg == "--fgb-over-peak") s.fgb_over_peak_db = number<float>(argv[++n], arg);
        else if (arg == "--fgb-alpha") s.fgb_alpha = number<float>(argv[++n], arg);
        else if (arg == "--fgb-beta") s.fgb_beta = number<float>(argv[++n], arg);
        else if (arg == "--fgb-zeta") s.fgb_zeta = number<float>(argv[++n], arg);
        else if (arg == "--fgb-average") s.fgb_average = number<float>(argv[++n], arg);
        else if (arg == "--fgb-runtime-ms") s.fgb_runtime_ms = number<std::int32_t>(argv[++n], arg);
        else if (arg == "--fgb-max-errors") s.fgb_max_errors = number<int>(argv[++n], arg);
        else if (arg == "--fgb-header-errors") s.fgb_header_errors = number<int>(argv[++n], arg);
        else if (arg == "--fgb-bch2-max-errors") s.fgb_bch2_max_errors = number<int>(argv[++n], arg);
        else return false;
    }
    return true;
}

void write_diagnostics(const cs_diagnostics& diagnostics) {
    std::cout << "{\"fgbMaxPeakDb\":" << diagnostics.fgb_max_peak_db
              << ",\"fgbCandidates\":" << diagnostics.fgb_candidates
              << ",\"fgbMaxSyncVotes\":" << diagnostics.fgb_max_sync_votes
              << ",\"sgbMaxDetectionLevel\":" << diagnostics.sgb_max_detection_level
              << ",\"sgbCandidates\":" << diagnostics.sgb_candidates
              << ",\"sgbQualityRejections\":" << diagnostics.sgb_quality_rejections
              << ",\"sgbBchRejections\":" << diagnostics.sgb_bch_rejections << '}';
}

constexpr std::string_view usage =
    "Usage: cospas-cli devices [--json]\n"
    "Usage: cospas-cli settings [--json]\n"
    "Usage: cospas-cli rtl-probe --frequency-hz N --gain-index N [--seconds N] [--agc] [--json]\n"
    "Usage: cospas-cli receive --frequency-hz N --gain-index N [--seconds N] [--agc] [--fgb-only|--sgb-only] [--json]\n"
    "Usage: cospas-cli decode --input capture.wav [--fgb-only|--sgb-only] [--json]\n"
    "  --sgb-threshold N       detection threshold (default 35)\n"
    "  --sgb-phase-gain N      PLL Alpha (default 0.83)\n"
    "  --sgb-frequency-gain N  PLL Beta (default 3.81)\n"
    "  --sgb-filter N          PLL filter, 0..1 (default 0.5)\n"
    "  --sgb-feedback N        PLL FB (default 4)\n"
    "  --sgb-max-errors N      SGB BCH correction limit, 0..6 (default 5: reject >=6)\n"
    "  --search-depth N        SGB search depth, 3..9 (default 9, display +/-1.2 kHz)\n"
    "  --remove-dc            Subtract WAV I/Q means before decoding (default off)\n"
    "  --fgb-over-peak N       OverPeak dB (default 15)\n"
    "  --fgb-alpha N           PLL Alpha (default 0.1)\n"
    "  --fgb-beta N            PLL Beta (default 0.01)\n"
    "  --fgb-zeta N            PLL Zeta (default 0.01)\n"
    "  --fgb-average N         detection average, 0..1 (default 0.045)\n"
    "  --fgb-runtime-ms N      channel RunTime, positive ms (default 550)\n"
    "  --fgb-max-errors N      FGB BCH-1 correction limit, 0..3 (default 3)\n"
    "  --fgb-bch2-max-errors N FGB BCH-2 correction limit, 0..2 (default 2)\n"
    "  --fgb-header-errors N   FGB 24-bit header bit errors allowed, 0..3 (default 2)\n"
    "  --prn-alignment N       0=Early, 1=Norm, 2=Late (default 2)\n"
    "  --noise-preroll-ms N    Explicit noise warmup, 0..10000 ms (default 0)\n"
    "  --block-samples N       Use incremental decoder with positive input block size\n"
    "  --worker-queue N        Decode on DSP thread with N input/output slots; requires --block-samples\n"
    "  --show-bch-failures     Include invalid words, with explicit BCH status\n"
    "  --show-fgb-bch-failures Include invalid or over-limit FGB words only\n"
    "  --no-quality-check     Disable SGB quality gate\n"
    "  --verbose              Write acquisition trials to stderr\n"
    "  --events               JSONL UI events: spectrum, frames, ENG, metrics, final result\n"
    "  --fgb-fm               Include FGB FM PCM events; requires --events\n"
    "  --realtime             Pace WAV playback; requires --events\n"
    "  --control-stdin        Stop gracefully on stop<LF> or pipe EOF; requires --events\n"
    "  --continuous           Receive until control stop; requires --events --control-stdin\n";

int probe_rtl(int argc, char** argv, bool decoding = false) {
    const std::string name = decoding ? "receive" : "rtl-probe";
    const std::string label = decoding ? "RTL receive" : "RTL probe";
    const std::string help = "Usage: cospas-cli " + name +
        " --frequency-hz N --gain-index N [--seconds N] [--agc] [--json]\n" +
        (decoding ? "  Live FGB/SGB decoding, F_DSP offset and PLL correction. Bias-T forced off.\n"
                  : "  Diagnostic I/Q acquisition only. Bias-T forced off.\n") +
        "  --frequency-hz N       Required, 406000000..406100000 Hz\n"
        "  --gain-index N         Required initial preset, 0..11\n"
        "  --seconds N            Acquisition duration, >0..30 s (default 2)\n"
        "  --agc                  Enable FE_AGC (default manual gain)\n"
        "  --bus N --address N     Select USB location when multiple devices exist\n"
        "  --usb-fd N             Use an already opened USB descriptor (Android)\n" +
        (decoding ? "  --fgb-only|--sgb-only   Decode one generation (default both)\n"
                    "  --events               Stream JSONL UI events with 10 Hz native spectra\n"
                    "  --fgb-fm               Include FGB FM PCM events; requires --events\n"
                    "  --control-stdin        Stop on stop<LF> or control pipe EOF\n"
                    "  --continuous           Receive until stopped; requires --events --control-stdin\n" : "");
    if (argc == 3 && std::string_view(argv[2]) == "--help") {
        std::cout << help;
        return 0;
    }
    std::uint32_t frequency = 0;
    std::optional<int> gain, bus, address, usb_fd;
    double seconds = 2;
    bool automatic = false, events = false, continuous = false, control_stdin = false, fgb_fm = false;
    cs_config settings{};
    cs_error error{};
    check(cs_config_init(&settings, sizeof(settings), &error), error);
    for (int n = 2; n < argc; ++n) {
        const std::string_view arg(argv[n]);
        if (arg == "--frequency-hz" && n + 1 < argc) frequency = number<std::uint32_t>(argv[++n], arg);
        else if (arg == "--gain-index" && n + 1 < argc) gain = number<int>(argv[++n], arg);
        else if (arg == "--seconds" && n + 1 < argc) seconds = number<double>(argv[++n], arg);
        else if (arg == "--bus" && n + 1 < argc) bus = number<int>(argv[++n], arg);
        else if (arg == "--address" && n + 1 < argc) address = number<int>(argv[++n], arg);
        else if (arg == "--usb-fd" && n + 1 < argc) usb_fd = number<int>(argv[++n], arg);
        else if (arg == "--agc") automatic = true;
        else if (decoding && arg == "--events") events = true;
        else if (decoding && arg == "--fgb-fm") fgb_fm = true;
        else if (decoding && arg == "--continuous") continuous = true;
        else if (decoding && arg == "--control-stdin") control_stdin = true;
        else if (decoding && setting_option(arg, n, argc, argv, settings)) {}
        else if (arg == "--json") {}
        else throw std::invalid_argument("Unknown or incomplete " + label + " option: " + std::string(arg));
    }
    if (frequency < 406000000 || frequency > 406100000)
        throw std::invalid_argument(label + " requires --frequency-hz within 406000000..406100000");
    if (!gain || *gain < 0 || *gain > 11)
        throw std::invalid_argument(label + " requires --gain-index within 0..11");
    if (!(seconds > 0) || seconds > 30)
        throw std::invalid_argument(label + " duration must be >0..30 seconds");
    if (bus.has_value() != address.has_value() ||
        (bus && (*bus < 0 || *bus > 255 || *address < 0 || *address > 255)))
        throw std::invalid_argument(label + " requires both --bus and --address within 0..255");
    if (!settings.fgb && !settings.sgb)
        throw std::invalid_argument("Select only one generation filter: --fgb-only or --sgb-only");
    if (continuous && !events) throw std::invalid_argument("--continuous requires --events");
    if (continuous && !control_stdin) throw std::invalid_argument("--continuous requires --control-stdin");
    if (control_stdin && !events) throw std::invalid_argument("--control-stdin requires --events");
    if (fgb_fm && !events) throw std::invalid_argument("--fgb-fm requires --events");
    if (usb_fd && (*usb_fd < 0 || bus)) throw std::invalid_argument("--usb-fd requires a valid descriptor without --bus");
    auto devices = usb_fd ? std::vector<cospas::RtlUsbDeviceInfo>{{.fd = *usb_fd}} : cospas::enumerate_rtl_usb_devices();
    if (bus) {
        std::erase_if(devices, [&](const auto& device) { return device.bus != *bus || device.address != *address; });
    }
    if (devices.size() != 1)
        throw std::runtime_error(label + " requires exactly one selected supported device; use --bus and --address");
    cospas::RtlUsbDevice device(devices.front());
    const bool blog_v4 = device.is_blog_v4();
    cospas::RtlUsbRegisters registers(device);
    cospas::Rtl2832 receiver(registers, blog_v4);
    const auto offset_hz = decoding ? cospas::Rtl2832::dsp_offset_hz() : 0;
    const auto tuner_frequency = static_cast<std::uint32_t>(std::int64_t(frequency) - offset_hz);
    receiver.initialize(tuner_frequency);
    const auto status = receiver.status();
    const auto mixer_hz = static_cast<float>(double(offset_hz) + tuner_frequency - *status.actual_frequency_hz);
    cospas::cli::FgbFm fm(cospas::rtl_sample_rate_hz, mixer_hz, 2);
    std::size_t spectrum_gain = *gain;
    std::unique_ptr<cospas::cli::Spectrum> spectrum;
    if (events) spectrum = std::make_unique<cospas::cli::Spectrum>(
        cospas::rtl_sample_rate_hz, *status.actual_frequency_hz,
        [&](const auto& line, double time, float bandwidth_level) {
            emit_spectrum(line, time, spectrum_gain, bandwidth_level);
        }, frequency);
    std::unique_ptr<cs_worker, decltype(&cs_worker_destroy)> worker(nullptr, cs_worker_destroy);
    cs_diagnostics diagnostics{};
    cs_worker_stats snapshot{};
    std::vector<cs_frame> frames;
    bool finished = false;
    std::uint64_t submitted_samples = 0;
    std::uint64_t frame_count = 0;
    if (decoding) {
        cs_worker* created = nullptr;
        check(cs_worker_create_with_mixer(&settings, cospas::rtl_sample_rate_hz, cospas::rtl_block_samples,
                                           16, 16, mixer_hz, &created, &error), error);
        worker.reset(created);
    }
    const auto poll = [&] {
        if (!worker) return false;
        cs_worker_event event{};
        const auto code = cs_worker_poll(worker.get(), &event, sizeof(event), &error);
        if (code == CS_AGAIN) return false;
        check(code, error);
        std::unique_ptr<cs_result, decltype(&cs_result_destroy)> result(event.result, cs_result_destroy);
        if (event.kind == CS_EVENT_ERROR) throw std::runtime_error(event.error.message);
        if (event.kind == CS_EVENT_DISCONTINUITY)
            throw std::runtime_error("Sample discontinuity in RTL receive input");
        if (event.kind != CS_EVENT_FRAMES && event.kind != CS_EVENT_FINISHED)
            throw std::runtime_error("Unknown DSP worker event");
        if (events) {
            emit_frames(result.get());
            check(cs_result_get_diagnostics(result.get(), &diagnostics, sizeof(diagnostics), &error), error);
            frame_count += diagnostics.frame_count;
        } else collect_result(result.release(), diagnostics, frames);
        finished = event.kind == CS_EVENT_FINISHED;
        return true;
    };
    const auto submit = [&](std::span<const std::uint8_t> input) {
        if (!worker) return;
        while (poll()) {}
        for (;;) {
            const auto code = cs_worker_submit(worker.get(), submitted_samples, CS_IQ_CU8,
                                               input.data(), input.size(), &error);
            if (code != CS_QUEUE_FULL) {
                check(code, error);
                break;
            }
            if (!poll()) check(cs_worker_wait_ready(worker.get(), &error), error);
        }
        submitted_samples += input.size() / 2;
        while (poll()) {}
    };
    cospas::RtlFrontendControl frontend(registers, *gain);
    frontend.set_automatic_gain(automatic);
    receiver.reset_buffer();
    cospas::RtlIqBlock incoming;
    std::array<std::uint8_t, cospas::rtl_block_samples * 2> block{};
    std::size_t filled = 0;
    std::uint64_t bytes = 0, blocks = 0, timeouts = 0, gain_changes = 0, clipped_samples = 0;
    std::array<std::uint64_t, 2> sums{}, squares{}, counts{};
    std::uint8_t minimum = 255, maximum = 0;
    const auto started = std::chrono::steady_clock::now();
    cospas::RtlIqCapture capture(device);
    if (events)
        std::cout << "{\"type\":\"session\",\"source\":\"rtl\",\"sampleRateHz\":" << cospas::rtl_sample_rate_hz
                  << ",\"centerHz\":" << frequency << ",\"durationSeconds\":null}\n" << std::flush;
    bool stopped = false;
    while (capture.read(incoming)) {
        const double elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
        if (!stopped && ((!continuous && elapsed >= seconds) || (control_stdin && cospas::cli::stop_requested()))) {
            capture.stop();
            stopped = true;
        }
        const auto transferred = incoming.transferred;
        if (incoming.timed_out) ++timeouts;
        for (std::size_t n = 0; n < transferred; ++n) {
            const auto value = incoming.bytes[n];
            const auto channel = std::size_t((bytes + n) & 1);
            sums[channel] += value;
            squares[channel] += std::uint64_t(value) * value;
            ++counts[channel];
            minimum = std::min(minimum, value);
            maximum = std::max(maximum, value);
        }
        bytes += transferred;
        for (std::size_t offset = 0; offset < transferred;) {
            const auto count = std::min(block.size() - filled, transferred - offset);
            std::copy_n(incoming.bytes.begin() + static_cast<std::ptrdiff_t>(offset), count,
                        block.begin() + static_cast<std::ptrdiff_t>(filled));
            filled += count;
            offset += count;
            if (filled == block.size()) {
                const auto observation = frontend.process_cu8(block);
                clipped_samples += observation.clipped_samples;
                if (observation.gain_changed) ++gain_changes;
                submit(block);
                ++blocks;
                if (fgb_fm && settings.fgb) {
                    if (blocks % 4 == 0) {
                        cs_acquisition acquisition{};
                        const auto code = cs_worker_get_acquisition(worker.get(), &acquisition, sizeof(acquisition), &error);
                        if (code == CS_OK) fm.select(acquisition, std::min(elapsed,
                            double(blocks - 1) * cospas::rtl_block_samples / cospas::rtl_sample_rate_hz));
                        else if (code != CS_AGAIN) check(code, error);
                    }
                    fm.push(block);
                }
                if (spectrum) {
                    spectrum_gain = *frontend.gain_index();
                    spectrum->push_cu8(block);
                    if (blocks % 14 == 0) {
                        const auto code = cs_worker_get_diagnostics(worker.get(), &diagnostics, sizeof(diagnostics), &error);
                        if (code != CS_AGAIN) check(code, error);
                        cs_acquisition acquisition{};
                        const auto acquisition_code = cs_worker_get_acquisition(
                            worker.get(), &acquisition, sizeof(acquisition), &error);
                        if (acquisition_code == CS_OK) emit_acquisition(acquisition);
                        else if (acquisition_code != CS_AGAIN) check(acquisition_code, error);
                        cs_worker_stats progress{};
                        check(cs_worker_get_stats(worker.get(), &progress, sizeof(progress), &error), error);
                        std::cout << "{\"type\":\"metrics\",\"samples\":" << progress.processed_blocks * cospas::rtl_block_samples
                                  << ",\"gainIndex\":" << *frontend.gain_index()
                                  << ",\"clippedSamples\":" << clipped_samples << ",\"diagnostics\":";
                        write_diagnostics(diagnostics);
                        std::cout << "}\n" << std::flush;
                    }
                }
                filled = 0;
            }
        }
    }
    capture.stop();
    fm.flush();
    if (!stopped) throw std::runtime_error(label + " acquisition ended before the requested duration");
    const double elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    if (blocks == 0) throw std::runtime_error(label + " received no complete 6400-sample I/Q block");
    if (bytes & 1) throw std::runtime_error(label + " ended with an incomplete I/Q pair");
    if (worker) {
        if (filled) submit(std::span(block).first(filled));
        check(cs_worker_finish(worker.get(), &error), error);
        while (!finished)
            if (!poll()) check(cs_worker_wait_ready(worker.get(), &error), error);
        check(cs_worker_get_stats(worker.get(), &snapshot, sizeof(snapshot), &error), error);
        if (submitted_samples != bytes / 2 || snapshot.accepted_blocks != blocks + (filled ? 1u : 0u) ||
            snapshot.processed_blocks != snapshot.accepted_blocks || snapshot.discontinuities ||
            snapshot.missing_samples)
            throw std::runtime_error("RTL receive DSP sample accounting mismatch");
        std::stable_sort(frames.begin(), frames.end(), [](const auto& a, const auto& b) {
            return a.time_seconds < b.time_seconds;
        });
    }
    const double drain_seconds = std::chrono::duration<double>(
        std::chrono::steady_clock::now() - started).count() - elapsed;
    const auto final_gain = frontend.gain_index();
    const int closed = device.close();
    if (closed != 0)
        throw std::runtime_error(std::string("Closing RTL-SDR USB interface: ") + libusb_error_name(closed) +
                                 " (code " + std::to_string(closed) + ")");
    const double i_mean = double(sums[0]) / double(counts[0]);
    const double q_mean = double(sums[1]) / double(counts[1]);
    const double variance = double(squares[0]) / double(counts[0]) - i_mean * i_mean +
                            double(squares[1]) / double(counts[1]) - q_mean * q_mean;
    if (events) std::cout << "{\"type\":\"complete\",\"result\":";
    std::cout << std::setprecision(15)
              << "{\"bus\":" << unsigned(devices.front().bus) << ",\"address\":" << unsigned(devices.front().address)
              << ",\"requestedFrequencyHz\":" << frequency << ",\"actualFrequencyHz\":" << *status.actual_frequency_hz
              << ",\"sampleRateHz\":" << cospas::rtl_sample_rate_hz
              << ",\"intermediateFrequencyHz\":" << status.intermediate_frequency_hz
              << ",\"filterCode\":" << unsigned(status.filter_code) << ",\"biasTee\":false"
              << ",\"tunerAddress\":" << unsigned(status.i2c_address)
              << ",\"rtlSdrBlogV4\":" << (blog_v4 ? "true" : "false")
              << ",\"firSignedFix\":true,\"automaticGain\":" << (automatic ? "true" : "false")
              << ",\"initialGainIndex\":" << *gain << ",\"finalGainIndex\":" << *final_gain
              << ",\"gainChanges\":" << gain_changes << ",\"clippedISamplesInCompleteBlocks\":" << clipped_samples
              << ",\"bytes\":" << bytes << ",\"samples\":" << bytes / 2 << ",\"blocks\":" << blocks
              << ",\"pendingBytes\":" << filled << ",\"timeouts\":" << timeouts << ",\"elapsedSeconds\":" << elapsed
              << ",\"minimum\":" << unsigned(minimum) << ",\"maximum\":" << unsigned(maximum)
              << ",\"iMean\":" << i_mean << ",\"qMean\":" << q_mean
              << ",\"acRmsCounts\":" << std::sqrt(std::max(0.0, variance));
    if (worker) {
        std::cout << ",\"tablesSha256\":\"" << diagnostics.tables_sha256
                  << "\",\"tunerRequestedFrequencyHz\":" << tuner_frequency
                  << ",\"dspOffsetHz\":" << offset_hz << ",\"mixerHz\":" << mixer_hz
                  << ",\"dspCenterFrequencyHz\":" << *status.actual_frequency_hz + mixer_hz
                  << ",\"dspSamples\":" << submitted_samples
                  << ",\"frameCount\":" << (events ? frame_count : frames.size())
                  << ",\"dspDrainSeconds\":" << drain_seconds
                  << ",\"worker\":{\"acceptedBlocks\":" << snapshot.accepted_blocks
                  << ",\"processedBlocks\":" << snapshot.processed_blocks
                  << ",\"queueFullCount\":" << snapshot.queue_full_count
                  << ",\"discontinuities\":" << snapshot.discontinuities
                  << ",\"missingSamples\":" << snapshot.missing_samples << "},\"frames\":[";
        for (std::size_t n = 0; n < frames.size(); ++n) {
            if (n) std::cout << ',';
            write_frame(frames[n]);
        }
        std::cout << "],\"diagnostics\":";
        write_diagnostics(diagnostics);
    }
    std::cout << (events ? "}}\n" : "}\n") << std::flush;
    return decoding && (events ? frame_count == 0 : frames.empty()) ? 2 : 0;
}
}

int cospas_cli_run(int argc, char** argv) {
    try {
        if (argc == 2 && std::string_view(argv[1]) == "--help") {
            std::cout << usage;
            return 0;
        }
        if (argc >= 2 && std::string_view(argv[1]) == "settings") {
            if (argc > 3 || (argc == 3 && std::string_view(argv[2]) != "--json"))
                throw std::invalid_argument("Usage: cospas-cli settings [--json]");
            cs_config s{};
            cs_error error{};
            check(cs_config_init(&s, sizeof(s), &error), error);
            std::cout << "{\"fgb\":" << (s.fgb ? "true" : "false") << ",\"sgb\":" << (s.sgb ? "true" : "false")
                      << ",\"normalPrn\":" << (s.normal_prn ? "true" : "false")
                      << ",\"testPrn\":" << (s.test_prn ? "true" : "false")
                      << ",\"qualityCheck\":" << (s.quality_check ? "true" : "false")
                      << ",\"showBchFailures\":" << (s.show_bch_failures ? "true" : "false")
                      << ",\"fgbAlpha\":" << s.fgb_alpha << ",\"fgbBeta\":" << s.fgb_beta
                      << ",\"fgbZeta\":" << s.fgb_zeta << ",\"fgbAverage\":" << s.fgb_average
                      << ",\"fgbRuntimeMs\":" << s.fgb_runtime_ms
                      << ",\"fgbMaxErrors\":" << s.fgb_max_errors
                      << ",\"fgbHeaderErrors\":" << s.fgb_header_errors
                      << ",\"fgbBch2MaxErrors\":" << s.fgb_bch2_max_errors
                      << ",\"fgbOverPeakDb\":" << s.fgb_over_peak_db
                      << ",\"sgbThreshold\":" << s.sgb_detection_threshold
                      << ",\"sgbPhaseGain\":" << s.sgb_phase_gain
                      << ",\"sgbFrequencyGain\":" << s.sgb_frequency_gain
                      << ",\"sgbFeedback\":" << s.sgb_feedback
                      << ",\"sgbFilter\":" << s.sgb_filter << ",\"sgbMaxErrors\":" << s.sgb_max_errors
                      << ",\"searchDepth\":" << s.search_depth
                      << ",\"prnAlignment\":" << s.prn_alignment << "}\n";
            return 0;
        }
        if (argc >= 2 && std::string_view(argv[1]) == "rtl-probe") return probe_rtl(argc, argv);
        if (argc >= 2 && std::string_view(argv[1]) == "receive") return probe_rtl(argc, argv, true);
        if (argc >= 2 && std::string_view(argv[1]) == "devices") {
            if (argc == 3 && std::string_view(argv[2]) == "--help") {
                std::cout << "Usage: cospas-cli devices [--json]\n";
                return 0;
            }
            if (argc > 3 || (argc == 3 && std::string_view(argv[2]) != "--json"))
                throw std::invalid_argument("Usage: cospas-cli devices [--json]");
            const auto devices = cospas::enumerate_rtl_usb_devices();
            std::cout << "{\"devices\":[";
            bool first = true;
            for (const auto& device : devices) {
                if (!first) std::cout << ',';
                first = false;
                std::cout << "{\"vendorId\":" << device.vendor_id << ",\"productId\":" << device.product_id
                          << ",\"bus\":" << unsigned(device.bus) << ",\"address\":" << unsigned(device.address) << '}';
            }
            std::cout << "]}\n";
            return 0;
        }
        std::filesystem::path input;
        cs_config settings{};
        cs_error error{};
        check(cs_config_init(&settings, sizeof(settings), &error), error);
        bool verbose = false;
        bool remove_dc = false;
        bool events = false, realtime = false, control_stdin = false, fgb_fm = false;
        int noise_preroll_ms = 0;
        std::size_t block_samples = 0;
        std::size_t worker_queue = 0;
        if (argc < 2 || std::string_view(argv[1]) != "decode")
            throw std::invalid_argument(std::string(usage));
        for (int n = 2; n < argc; ++n) {
            const std::string_view arg(argv[n]);
            if (setting_option(arg, n, argc, argv, settings)) {}
            else if (arg == "--input" && n + 1 < argc) input = argv[++n];
            else if (arg == "--events") events = true;
            else if (arg == "--fgb-fm") fgb_fm = true;
            else if (arg == "--realtime") realtime = true;
            else if (arg == "--control-stdin") control_stdin = true;
            else if (arg == "--verbose") verbose = true;
            else if (arg == "--remove-dc") remove_dc = true;
            else if (arg == "--noise-preroll-ms" && n + 1 < argc) noise_preroll_ms = number<int>(argv[++n], arg);
            else if (arg == "--block-samples" && n + 1 < argc) {
                block_samples = number<std::size_t>(argv[++n], arg);
                if (!block_samples) throw std::invalid_argument("Stream block size must be positive");
            }
            else if (arg == "--worker-queue" && n + 1 < argc) {
                worker_queue = number<std::size_t>(argv[++n], arg);
                if (!worker_queue) throw std::invalid_argument("Worker queue size must be positive");
            }
            else if (arg == "--json") {}
            else throw std::invalid_argument("Unknown or incomplete CLI option: " + std::string(arg));
        }
        if (input.empty()) throw std::invalid_argument("--input is required");
        if (!settings.fgb && !settings.sgb)
            throw std::invalid_argument("--fgb-only and --sgb-only are mutually exclusive");
        if (noise_preroll_ms < 0 || noise_preroll_ms > 10000)
            throw std::invalid_argument("Noise preroll must be between 0 and 10000 ms");
        if (worker_queue && !block_samples)
            throw std::invalid_argument("--worker-queue requires --block-samples");
        if (realtime && !events) throw std::invalid_argument("--realtime requires --events");
        if (control_stdin && !events) throw std::invalid_argument("--control-stdin requires --events");
        if (fgb_fm && !events) throw std::invalid_argument("--fgb-fm requires --events");
        if (events && worker_queue) throw std::invalid_argument("--events uses the incremental decoder directly");
        const auto started = std::chrono::steady_clock::now();
        auto signal = cospas::read_wav(input);
        if (fgb_fm && signal.sample_rate_hz < cospas::cli::FgbFm::audio_rate * 4)
            throw std::invalid_argument("--fgb-fm requires a WAV sample rate of at least 48 kHz");
        cospas::cli::FgbFm fm(signal.sample_rate_hz);
        const auto original_samples = signal.samples.size();
        std::complex<double> dc_offset{};
        if (remove_dc) {
            if (signal.samples.empty()) throw std::invalid_argument("DC removal requires non-empty WAV input");
            for (const auto sample : signal.samples)
                dc_offset += std::complex<double>(sample.real(), sample.imag());
            dc_offset /= double(signal.samples.size());
            for (auto& sample : signal.samples) {
                const auto centered = std::complex<double>(sample.real(), sample.imag()) - dc_offset;
                if (std::abs(centered.real()) > std::numeric_limits<float>::max() ||
                    std::abs(centered.imag()) > std::numeric_limits<float>::max())
                    throw std::invalid_argument("DC removal exceeds supported I/Q range");
                sample = {float(centered.real()), float(centered.imag())};
            }
        }
        if (noise_preroll_ms) {
            const auto prefix = std::size_t(signal.sample_rate_hz) / 5;
            if (signal.samples.size() < prefix) throw std::invalid_argument("Noise preroll requires at least 200 ms of input");
            const auto count = std::size_t(signal.sample_rate_hz) * std::size_t(noise_preroll_ms) / 1000;
            std::vector<cospas::Sample> padded(original_samples + count);
            for (std::size_t n = 0; n < count; ++n) padded[n] = signal.samples[n % prefix];
            std::copy(signal.samples.begin(), signal.samples.end(), padded.begin() + static_cast<std::ptrdiff_t>(count));
            signal.samples = std::move(padded);
        }
        cs_diagnostics diagnostics{};
        std::vector<cs_frame> frames;
        std::unique_ptr<cospas::cli::Spectrum> spectrum;
        const bool fine_audio_blocks = events && fgb_fm && settings.fgb && !block_samples;
        if (events) {
            if (!block_samples) block_samples = signal.sample_rate_hz / (fine_audio_blocks ? 40 : 10);
            spectrum = std::make_unique<cospas::cli::Spectrum>(signal.sample_rate_hz, 406050000,
                [&](const auto& line, double time, float) { emit_spectrum(line, time - double(noise_preroll_ms) / 1000); });
            std::cout << "{\"type\":\"session\",\"source\":\"sample\",\"sampleRateHz\":" << signal.sample_rate_hz
                      << ",\"centerHz\":406050000,\"durationSeconds\":" << double(original_samples) / signal.sample_rate_hz
                      << ",\"noisePrerollMs\":" << noise_preroll_ms
                      << ",\"dcRemovalApplied\":" << (remove_dc ? "true" : "false") << "}\n" << std::flush;
        }
        const auto collect = [&](cs_result* decoded, bool acquisition_tick = true) {
            if (events) {
                if (acquisition_tick) emit_acquisition(decoded);
                emit_frames(decoded, double(noise_preroll_ms) / 1000);
            }
            collect_result(decoded, diagnostics, frames, double(noise_preroll_ms) / 1000);
        };
        cs_result* decoded = nullptr;
        if (worker_queue) {
            cs_worker* created = nullptr;
            check(cs_worker_create(&settings, signal.sample_rate_hz, block_samples, worker_queue,
                                   worker_queue, &created, &error), error);
            const std::unique_ptr<cs_worker, decltype(&cs_worker_destroy)> worker(created, cs_worker_destroy);
            bool finished = false;
            const auto poll = [&] {
                cs_worker_event event{};
                const auto code = cs_worker_poll(worker.get(), &event, sizeof(event), &error);
                if (code == CS_AGAIN) return false;
                check(code, error);
                std::unique_ptr<cs_result, decltype(&cs_result_destroy)> result(event.result, cs_result_destroy);
                if (event.kind == CS_EVENT_ERROR) throw std::runtime_error(event.error.message);
                if (event.kind == CS_EVENT_DISCONTINUITY)
                    throw std::runtime_error("Unexpected sample discontinuity in WAV worker input");
                if (event.kind != CS_EVENT_FRAMES && event.kind != CS_EVENT_FINISHED)
                    throw std::runtime_error("Unknown DSP worker event");
                collect(result.release());
                finished = event.kind == CS_EVENT_FINISHED;
                return true;
            };
            const auto drain = [&] {
                while (!finished)
                    if (!poll()) check(cs_worker_wait_ready(worker.get(), &error), error);
            };
            for (std::size_t position = 0; position < signal.samples.size();) {
                const auto count = std::min(block_samples, signal.samples.size() - position);
                const auto code = cs_worker_submit(worker.get(), position, CS_IQ_CF32,
                    signal.samples.data() + position, count * sizeof(cospas::Sample), &error);
                if (code == CS_QUEUE_FULL) {
                    if (!poll()) check(cs_worker_wait_ready(worker.get(), &error), error);
                    continue;
                }
                if (code == CS_INVALID_STATE) {
                    drain();
                    throw std::runtime_error("DSP worker finished before all WAV input was accepted");
                }
                check(code, error);
                position += count;
                while (poll()) {}
            }
            const auto code = cs_worker_finish(worker.get(), &error);
            if (code == CS_INVALID_STATE) drain();
            else check(code, error);
            drain();
        } else if (block_samples) {
            cs_stream* created = nullptr;
            check(cs_stream_create(&settings, signal.sample_rate_hz, block_samples, &created, &error), error);
            const std::unique_ptr<cs_stream, decltype(&cs_stream_destroy)> stream(created, cs_stream_destroy);
            const auto play_started = std::chrono::steady_clock::now();
            for (std::size_t position = 0; position < signal.samples.size();) {
                if (control_stdin && cospas::cli::stop_requested()) break;
                const auto count = std::min(block_samples, signal.samples.size() - position);
                check(cs_stream_push(stream.get(), position, CS_IQ_CF32, signal.samples.data() + position,
                                     count * sizeof(cospas::Sample), &decoded, &error), error);
                if (fgb_fm && settings.fgb) {
                    cs_acquisition acquisition{};
                    check(cs_result_get_acquisition(decoded, &acquisition, sizeof(acquisition), &error), error);
                    fm.select(acquisition);
                    const auto preroll = std::size_t(signal.sample_rate_hz) * std::size_t(noise_preroll_ms) / 1000;
                    const auto audio_start = std::max(position, preroll);
                    if (audio_start < position + count)
                        fm.push(std::span(signal.samples).subspan(audio_start, position + count - audio_start));
                }
                const bool tick = !fine_audio_blocks || (position / block_samples + 1) % 4 == 0;
                collect(decoded, tick);
                if (spectrum) {
                    spectrum->push(std::span(signal.samples).subspan(position, count));
                    if (tick) {
                        std::cout << "{\"type\":\"metrics\",\"samples\":" << position + count << ",\"diagnostics\":";
                        write_diagnostics(diagnostics);
                        std::cout << "}\n" << std::flush;
                    }
                }
                position += count;
                if (realtime)
                    std::this_thread::sleep_until(play_started + std::chrono::duration_cast<std::chrono::steady_clock::duration>(
                        std::chrono::duration<double>(double(position) / signal.sample_rate_hz)));
            }
            fm.flush();
            check(cs_stream_finish(stream.get(), &decoded, &error), error);
            collect(decoded);
        } else {
            check(cs_decode_iq(&settings, CS_IQ_CF32, signal.sample_rate_hz, signal.samples.data(),
                              signal.samples.size() * sizeof(cospas::Sample), &decoded, &error), error);
            collect(decoded);
        }
        std::stable_sort(frames.begin(), frames.end(), [](const auto& a, const auto& b) {
            return a.time_seconds < b.time_seconds;
        });
        if (verbose)
            for (std::size_t n = 0; n < diagnostics.fgb_trial_count; ++n) {
                const auto& trial = diagnostics.fgb_trials[n];
                std::cerr << "FGB t=" << trial.time_seconds << " f=" << trial.frequency_hz
                          << " votes=" << trial.votes << " offset=" << trial.offset << '\n';
            }
        const double elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
        if (events) std::cout << "{\"type\":\"complete\",\"result\":";
        std::cout << std::setprecision(10) << "{\"tablesSha256\":\"" << diagnostics.tables_sha256
                  << "\",\"sampleRateHz\":" << signal.sample_rate_hz
                  << ",\"durationSeconds\":" << double(original_samples) / signal.sample_rate_hz
                  << ",\"noisePrerollMs\":" << noise_preroll_ms
                  << ",\"dcRemovalApplied\":" << (remove_dc ? "true" : "false")
                  << ",\"processingSeconds\":" << elapsed << ",\"frames\":[";
        bool first = true;
        for (const auto& frame : frames) {
            if (!first) std::cout << ',';
            first = false;
            write_frame(frame);
        }
        std::cout << "],\"diagnostics\":";
        write_diagnostics(diagnostics);
        std::cout << (events ? "}}\n" : "}\n");
        return frames.empty() ? 2 : 0;
    } catch (const std::exception& error) {
        std::cerr << "cospas-cli: " << error.what() << '\n';
        return 1;
    }
}

#ifndef COSPAS_CLI_EMBEDDED
int main(int argc, char** argv) { return cospas_cli_run(argc, argv); }
#endif
