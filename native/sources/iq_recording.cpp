#include "iq_recording.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <memory>
#include <numbers>
#include <stdexcept>
#include <utility>

namespace cospas {
namespace {
void put32(std::vector<std::uint8_t>& bytes, std::size_t offset, std::uint32_t value) {
    for (int n = 0; n < 4; ++n) bytes[offset + std::size_t(n)] = std::uint8_t(value >> (8 * n));
}
void append32(std::vector<std::uint8_t>& bytes, std::uint32_t value) {
    const auto offset = bytes.size();
    bytes.resize(offset + 4);
    put32(bytes, offset, value);
}
void append_text(std::vector<std::uint8_t>& bytes, const std::string& value) {
    bytes.insert(bytes.end(), value.begin(), value.end());
}
void write(std::FILE* file, std::span<const std::uint8_t> bytes) {
    if (std::fwrite(bytes.data(), 1, bytes.size(), file) != bytes.size())
        throw std::runtime_error("Could not write I/Q WAV; check available storage");
}
}

IqRecorder::~IqRecorder() {
    if (file_) std::fclose(file_);
}

void IqRecorder::configure(std::uint32_t rate, double mixer_hz, std::uint32_t center_hz) {
    std::lock_guard lock(mutex_);
    if (file_) throw std::runtime_error("An I/Q recording is already active");
    if (rate < 76800 || rate > 10000000 || !std::isfinite(mixer_hz) || std::abs(mixer_hz) >= rate / 2.0 ||
        center_hz < 100000000 || center_hz > 999000000)
        throw std::invalid_argument("Invalid I/Q recording configuration");
    rate_ = rate;
    center_hz_ = center_hz;
    // The receiver's DSP mixer uses a negative frequency to shift the tuner offset up.
    step_ = std::polar(1.0, -2 * std::numbers::pi * mixer_hz / rate);
    failure_.clear();
    available_ = true;
}

void IqRecorder::start(std::FILE* file) {
    std::unique_ptr<std::FILE, decltype(&std::fclose)> owned(file, std::fclose);
    std::lock_guard lock(mutex_);
    if (!file) throw std::invalid_argument("Missing I/Q WAV output");
    if (!available_) throw std::runtime_error("I/Q recording requires a running RTL-SDR acquisition");
    if (file_) throw std::runtime_error("An I/Q recording is already active");
    failure_.clear();
    header_.clear();
    append_text(header_, "RIFF");
    append32(header_, 0);
    append_text(header_, "WAVEfmt ");
    append32(header_, 16);
    append32(header_, 0x00020001);
    append32(header_, rate_);
    append32(header_, rate_ * 4);
    append32(header_, 0x00100004);
    const auto comment = "SarsatSDR centerHz=" + std::to_string(center_hz_);
    const auto comment_size = std::uint32_t(comment.size() + 1);
    append_text(header_, "LIST");
    append32(header_, 12 + comment_size + (comment_size & 1));
    append_text(header_, "INFOICMT");
    append32(header_, comment_size);
    append_text(header_, comment);
    header_.push_back(0);
    if (comment_size & 1) header_.push_back(0);
    append_text(header_, "data");
    append32(header_, 0);
    put32(header_, 4, std::uint32_t(header_.size() - 8));
    write(file, header_);
    if (std::fflush(file)) throw std::runtime_error("Could not initialize I/Q WAV output");
    file_ = owned.release();
    data_bytes_ = 0;
    samples_ = 0;
    oscillator_ = {1, 0};
}

void IqRecorder::push(std::span<const std::uint8_t> iq) {
    std::lock_guard lock(mutex_);
    if (!file_) return;
    try {
        if (iq.size() % 2) throw std::invalid_argument("Incomplete I/Q recording sample");
        const auto capacity = std::numeric_limits<std::uint32_t>::max() - (header_.size() - 8);
        if (iq.size() > (capacity - data_bytes_) / 2)
            throw std::runtime_error("I/Q WAV reached the 4 GiB RIFF limit");
        std::array<std::uint8_t, 32768> pcm{};
        std::size_t filled = 0;
        for (std::size_t p = 0; p < iq.size(); p += 2) {
            const auto value = std::complex<double>((double(iq[p]) - 128) / 128,
                                                    (double(iq[p + 1]) - 128) / 128) * oscillator_;
            oscillator_ *= step_;
            if (++samples_ % 4096 == 0) oscillator_ /= std::abs(oscillator_);
            for (const auto component : {value.real(), value.imag()}) {
                const auto sample = std::uint16_t(std::clamp(std::lround(component * 32768), -32768L, 32767L));
                pcm[filled++] = std::uint8_t(sample);
                pcm[filled++] = std::uint8_t(sample >> 8);
            }
            if (filled == pcm.size() || p + 2 == iq.size()) {
                write(file_, std::span(pcm).first(filled));
                data_bytes_ += std::uint32_t(filled);
                filled = 0;
            }
        }
    } catch (const std::exception& error) {
        failure_ = error.what();
        throw;
    }
}

void IqRecorder::stop_locked() {
    if (auto* file = std::exchange(file_, nullptr)) {
        try {
            put32(header_, 4, std::uint32_t(header_.size() - 8) + data_bytes_);
            put32(header_, header_.size() - 4, data_bytes_);
            if (std::fseek(file, 0, SEEK_SET)) throw std::runtime_error("Could not finalize I/Q WAV header");
            write(file, header_);
            if (std::fflush(file)) throw std::runtime_error("Could not flush I/Q WAV output");
        } catch (const std::exception& error) {
            if (failure_.empty()) failure_ = error.what();
        }
        if (std::fclose(file) && failure_.empty()) failure_ = "Could not close I/Q WAV output";
    }
    if (!failure_.empty()) throw std::runtime_error(failure_);
}

void IqRecorder::stop() {
    std::lock_guard lock(mutex_);
    stop_locked();
}

void IqRecorder::finish_session() {
    std::lock_guard lock(mutex_);
    available_ = false;
    stop_locked();
}

IqRecorder& iq_recorder() {
    static IqRecorder recorder;
    return recorder;
}
}
