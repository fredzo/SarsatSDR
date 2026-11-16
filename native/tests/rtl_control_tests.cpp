#include "rtl_control.hpp"
#include "rtl_usb.hpp"
#include "r820_tuner.hpp"
#include "rtl2832.hpp"
#include "rtl_iq_capture.hpp"
#include <libusb.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <iostream>
#include <latch>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

template<class Error, class Action>
std::string require_error(Action action) {
    try { action(); }
    catch (const Error& error) { return error.what(); }
    throw std::runtime_error("Expected RTL control error was not reported");
}

enum class Kind { enable, disable, read, write };
struct Operation {
    Kind kind;
    std::uint8_t address{}, value{};
    bool operator==(const Operation&) const = default;
};

class RegisterRecorder final : public cospas::RtlRegisterIo {
public:
    std::array<std::uint8_t, 32> cache{};
    std::vector<Operation> operations;
    int enable_failures{}, disable_failures{}, read_failures{}, write_failures{};
    std::uint8_t failed_write_address{7};

    RegisterRecorder() {
        cache[5] = 0xe0;
        cache[7] = 0xf0;
        cache[12] = 0xff;
    }

    int set_i2c_repeater(bool enabled) noexcept override {
        operations.push_back({enabled ? Kind::enable : Kind::disable});
        auto& remaining = enabled ? enable_failures : disable_failures;
        if (remaining > 0) { --remaining; return enabled ? -9 : -10; }
        return 0;
    }

    int read_cached_tuner_register(std::uint8_t address, std::uint8_t& value) noexcept override {
        operations.push_back({Kind::read, address, cache[address]});
        if (read_failures > 0) { --read_failures; return -7; }
        value = cache[address];
        return 0;
    }

    int write_tuner_register(std::uint8_t address, std::uint8_t value) noexcept override {
        operations.push_back({Kind::write, address, value});
        if (write_failures > 0 && address == failed_write_address) { --write_failures; return -8; }
        cache[address] = value;
        return 0;
    }

    std::size_t count(Kind kind) const {
        return std::size_t(std::count_if(operations.begin(), operations.end(),
                                        [=](const auto& operation) { return operation.kind == kind; }));
    }
};

using Block = std::array<std::uint8_t, cospas::rtl_block_samples * 2>;

Block block(std::uint8_t i, std::uint8_t q = 128) {
    Block result;
    for (std::size_t n = 0; n < result.size(); n += 2) {
        result[n] = i;
        result[n + 1] = q;
    }
    return result;
}

Block clipped_block(std::size_t count) {
    auto result = block(128);
    for (std::size_t n = 0; n < count; ++n) result[n * 2] = 250;
    return result;
}

void registers() {
    constexpr std::array<std::array<std::uint8_t, 3>, 12> presets{{
        {15, 12, 15}, {15, 12, 12}, {15, 12, 10}, {15, 12, 7},
        {15, 12, 4}, {15, 6, 4}, {15, 0, 4}, {8, 0, 4},
        {4, 0, 4}, {1, 0, 4}, {0, 0, 2}, {0, 0, 0},
    }};
    for (int index = 0; index < 12; ++index) {
        RegisterRecorder io;
        cospas::RtlFrontendControl control(io, index);
        const auto& gain = presets[std::size_t(index)];
        const auto lna = std::uint8_t(0xf0 | gain[0]);
        const auto mixer = std::uint8_t(0xe0 | gain[1]);
        const auto vga = std::uint8_t(0x60 | gain[2]);
        const std::vector<Operation> expected{
            {Kind::enable},
            {Kind::read, 5, 0xe0}, {Kind::write, 5, 0xf0},
            {Kind::read, 5, 0xf0}, {Kind::write, 5, lna},
            {Kind::read, 7, 0xf0}, {Kind::write, 7, 0xe0},
            {Kind::read, 7, 0xe0}, {Kind::write, 7, mixer},
            {Kind::read, 12, 0xff}, {Kind::write, 12, vga},
            {Kind::disable},
        };
        require(io.operations == expected, "gain register order, masks or preset values differ");
        io.operations.clear();
        control.set_gain(index);
        require(io.operations.empty(), "Confirmed unchanged gain should not issue register writes");
        control.set_gain(-100);
        require(control.gain_index() == 0, "Gain must clamp to preset zero");
        control.set_gain(100);
        require(control.gain_index() == 11 && io.cache[5] == 0xf0 &&
                io.cache[7] == 0xe0 && io.cache[12] == 0x60,
                "Clamped minimum gain must clear controlled bits and preserve unrelated bits");
    }
}

void measurements() {
    RegisterRecorder io;
    cospas::RtlFrontendControl control(io, 5);
    control.set_automatic_gain(false);
    for (const auto i : {0, 128}) {
        const auto result = control.process_cu8(block(std::uint8_t(i), 255));
        require(result.positive_level == 0 && result.clipped_samples == 0 && !result.clipped,
                "FE_AGC must ignore Q, negative I and I equal to 128");
    }
    auto input = block(128);
    input[0] = 129;
    input[2] = 129;
    input[4] = 130;
    require(control.process_cu8(input).positive_level == 2, "FE_AGC positive mean must truncate, not round");
    const auto full_positive = control.process_cu8(block(249));
    require(full_positive.positive_level == 242 && !full_positive.clipped, "I=249 must not count as clipped");
    for (const auto count : {150u, 151u, 6400u}) {
        const auto result = control.process_cu8(clipped_block(count));
        require(result.clipped_samples == count && result.positive_level == 0 &&
                result.clipped == (count > 150) && !result.gain_changed,
                "Clipping uses strict count threshold and excludes I>=250 from positive mean");
    }
    require(control.process_cu8(block(255)).clipped_samples == 6400, "I=255 must count as clipped");
    require(control.gain_index() == 5 && io.count(Kind::enable) == 1, "Manual mode must not alter gain");
    RegisterRecorder alternate_io;
    cospas::RtlFrontendControl alternate(alternate_io, 5, {20, 15});
    require(!alternate.process_cu8(clipped_block(15)).clipped &&
            alternate.process_cu8(clipped_block(16)).clipped, "Alternate clipping threshold must remain strict");
}

void automatic_gain() {
    const auto weak = block(128);
    const auto clipped = clipped_block(151);
    RegisterRecorder io;
    cospas::RtlFrontendControl control(io, 5);
    for (int n = 0; n < 21; ++n)
        require(!control.process_cu8(weak).gain_changed, "Default AGC acted before block 22");
    require(control.process_cu8(weak).gain_changed && control.gain_index() == 4,
            "Default AGC must first act on block 22");
    for (int n = 0; n < 20; ++n)
        require(!control.process_cu8(weak).gain_changed, "Subsequent AGC delay is too short");
    require(control.process_cu8(weak).gain_changed && control.gain_index() == 3,
            "Subsequent default AGC interval must be 21 blocks");

    RegisterRecorder paused_io;
    cospas::RtlFrontendControl paused(paused_io, 5);
    for (int n = 0; n < 7; ++n) paused.process_cu8(weak);
    paused.set_automatic_gain(false);
    for (int n = 0; n < 30; ++n)
        require(!paused.process_cu8(clipped).gain_changed, "Disabled FE_AGC changed gain");
    paused.set_automatic_gain(true);
    for (int n = 0; n < 14; ++n)
        require(!paused.process_cu8(weak).gain_changed, "Disabled FE_AGC must freeze its counter");
    require(paused.process_cu8(weak).gain_changed, "Re-enabled FE_AGC must retain its prior counter");

    RegisterRecorder immediate_io;
    cospas::RtlFrontendControl immediate(immediate_io, 3, {0, 150});
    require(!immediate.process_cu8(block(143)).gain_changed &&
            !immediate.process_cu8(block(143)).gain_changed, "Level exactly 30 must not increase gain");
    auto below = block(128);
    below[0] = 142; below[2] = 143; below[4] = 143;
    require(immediate.process_cu8(below).gain_changed && immediate.gain_index() == 2,
            "Truncated level 29 must increase gain");
    require(immediate.process_cu8(weak).gain_changed && immediate.gain_index() == 1 &&
            !immediate.process_cu8(weak).gain_changed, "FE_AGC must not increase gain beyond preset 1");
    immediate.set_gain(0);
    require(!immediate.process_cu8(weak).gain_changed &&
            immediate.process_cu8(clipped).gain_changed && immediate.gain_index() == 1,
            "Preset 0 must remain usable manually and decrease on clipping");
    immediate.set_gain(11);
    require(!immediate.process_cu8(clipped).gain_changed && immediate.gain_index() == 11,
            "Clipping must take priority over low positive level at minimum gain");

    RegisterRecorder limit_io;
    cospas::RtlFrontendControl limit(limit_io, 1, {1, 150});
    for (int n = 0; n < 3; ++n) require(!limit.process_cu8(weak).gain_changed, "Gain floor must hold");
    require(!limit.process_cu8(clipped).gain_changed && limit.process_cu8(clipped).gain_changed,
            "AGC must reset delay even when no gain change occurs");
}

void failures() {
    RegisterRecorder io;
    cospas::RtlFrontendControl control(io, 5, {0, 150});
    io.operations.clear();
    io.write_failures = 1;
    control.set_gain(6);
    require(control.gain_index() == 6 && io.count(Kind::enable) == 2 &&
            io.count(Kind::disable) == 2 && io.count(Kind::write) == 8,
            "Partial register failure must clean up and retry the entire preset once");

    io.operations.clear();
    io.write_failures = 2;
    io.disable_failures = 2;
    control.process_cu8(clipped_block(151));
    const auto message = require_error<std::runtime_error>([&] { control.process_cu8(clipped_block(151)); });
    require(message.find("failed twice") != std::string::npos &&
            message.find("code -8") != std::string::npos && message.find("code -10") != std::string::npos &&
            io.count(Kind::enable) == 2 && io.count(Kind::disable) == 2 && !control.gain_index(),
            "Failed AGC must expose register and cleanup errors without confirming gain");
    require_error<std::logic_error>([&] { control.process_cu8(block(128)); });
    io.operations.clear();
    control.set_gain(6);
    require(io.count(Kind::write) == 5 && control.gain_index() == 6,
            "Recovery must rewrite even the previously confirmed preset");

    for (const auto kind : {Kind::enable, Kind::read, Kind::disable}) {
        io.operations.clear();
        if (kind == Kind::enable) io.enable_failures = 2;
        if (kind == Kind::read) io.read_failures = 2;
        if (kind == Kind::disable) io.disable_failures = 2;
        const auto error = require_error<std::runtime_error>([&] { control.set_gain(7); });
        require(!control.gain_index() && io.count(Kind::enable) == 2 && io.count(Kind::disable) == 2,
                "Every failed gain attempt must attempt repeater cleanup and remain unconfirmed");
        const auto code = kind == Kind::enable ? "code -9" : kind == Kind::read ? "code -7" : "code -10";
        require(error.find(code) != std::string::npos, "Transport error code was lost");
        require(io.count(Kind::write) == (kind == Kind::disable ? 10u : 0u),
                "Register access continued after an earlier transport failure");
        control.set_gain(6);
    }
    io.operations.clear();
    io.disable_failures = 1;
    control.set_gain(7);
    require(control.gain_index() == 7 && io.count(Kind::write) == 10 &&
            io.count(Kind::disable) == 2, "Cleanup failure must be retried, not mistaken for success");
}

void invalid_input() {
    for (const auto settings : {cospas::RtlAgcSettings{-1, 150}, {51, 150}, {20, -1}, {20, 6401}}) {
        RegisterRecorder io;
        require_error<std::invalid_argument>([&] { cospas::RtlFrontendControl invalid(io, 5, settings); });
        require(io.operations.empty(), "Invalid settings must be rejected before device writes");
    }
    RegisterRecorder io;
    cospas::RtlFrontendControl control(io, 5, {0, 150});
    const auto input = block(128);
    for (const auto size : {0u, 1u, 12798u, 12799u})
        require_error<std::invalid_argument>([&] { control.process_cu8(std::span(input).first(size)); });
    const std::array<std::uint8_t, cospas::rtl_block_samples * 2 + 2> oversized{};
    require_error<std::invalid_argument>([&] { control.process_cu8(oversized); });
    require(!control.process_cu8(input).gain_changed && control.process_cu8(input).gain_changed,
            "Rejected CU8 blocks must not advance AGC state");
}

struct UsbRequest {
    std::uint8_t type{}, request{};
    std::uint16_t value{}, index{};
    std::vector<std::uint8_t> bytes;
    unsigned timeout_ms{};
    bool operator==(const UsbRequest&) const = default;
};

class UsbRecorder final : public cospas::RtlUsbControlIo {
public:
    std::vector<UsbRequest> requests;
    std::vector<std::vector<std::uint8_t>> received;
    std::vector<int> results;
    std::size_t next_result{};
    bool tuner_status{};
    std::uint8_t filter_code{3};
    int closing_failures{};
    std::vector<std::array<std::uint8_t, 7>> decoded_reads;
    std::size_t next_read{};
    bool receiver_mode{}, corrupt_fir{};
    std::uint8_t chip_id{0x69};
    std::uint8_t chip_address{0x34}, fine_tune{2};
    std::chrono::milliseconds pll_settle_time{};
    std::chrono::steady_clock::time_point pll_ready{};
    std::array<std::array<std::uint8_t, 256>, 16> demod_values{};

    int control_transfer(std::uint8_t type, std::uint8_t request, std::uint16_t value,
                          std::uint16_t index, std::span<std::uint8_t> data,
                          unsigned timeout_ms) noexcept override {
        requests.push_back({type, request, value, index, {data.begin(), data.end()}, timeout_ms});
        if (type == 0x40 && index == 0x610 && data.size() == 2 && data[0] == 0x15)
            pll_ready = std::chrono::steady_clock::now() + pll_settle_time;
        if (receiver_mode && type == 0x40 && index >= 0x10 && index <= 0x1f) {
            for (std::size_t n = 0; n < data.size(); ++n)
                demod_values[index & 15][std::size_t(value >> 8) + n] = data[n];
        }
        if (type & 0x80) {
            std::fill(data.begin(), data.end(), 0x5a);
            if (receiver_mode && index <= 0x0f) {
                for (std::size_t n = 0; n < data.size(); ++n)
                    data[n] = demod_values[index][std::size_t(value >> 8) + n];
                if (corrupt_fir && index == 1 && value == 0x1c20) data[0] ^= 1;
            }
            if (tuner_status && index == 0x600) {
                std::array<std::uint8_t, 7> decoded{0, 0, 0x40, 0, std::uint8_t((fine_tune << 4) | filter_code), 0, 0};
                if (next_read < decoded_reads.size()) decoded = decoded_reads[next_read++];
                if (std::chrono::steady_clock::now() < pll_ready) decoded[2] &= ~0x40;
                for (std::size_t n = 0; n < data.size(); ++n) {
                    std::uint8_t raw{};
                    const auto value = n < decoded.size() ? decoded[n] : 0;
                    for (int bit = 0; bit < 8; ++bit) raw = std::uint8_t((raw << 1) | ((value >> bit) & 1));
                    data[n] = raw;
                }
            }
            if (receiver_mode && index == 0x600 && data.size() == 1) data[0] = chip_id;
        }
        received.emplace_back(data.begin(), data.end());
        if (closing_failures > 0 && type == 0x40 && value == 0x120 && index == 0x11 &&
            data.size() == 1 && data[0] == 0x10) {
            --closing_failures;
            return -9;
        }
        const auto normal = receiver_mode && type == 0xc0 && index == 0x600 && data.size() == 1 &&
                            value != chip_address ? LIBUSB_ERROR_PIPE : int(data.size());
        return next_result < results.size() ? results[next_result++] : normal;
    }

    void reset(std::vector<int> responses = {}) {
        requests.clear();
        received.clear();
        results = std::move(responses);
        next_result = 0;
        decoded_reads.clear();
        next_read = 0;
    }
};

std::string tuner_trace(const UsbRecorder& io) {
    constexpr char digits[] = "0123456789ABCDEF";
    std::string result;
    const auto byte = [&](std::uint8_t value) {
        result += digits[value >> 4];
        result += digits[value & 15];
    };
    for (std::size_t n = 0; n < io.requests.size(); ++n) {
        const auto& request = io.requests[n];
        if (request.index != 0x600 && request.index != 0x610) continue;
        const bool reading = (request.type & 0x80) != 0;
        result += reading ? 'R' : 'W';
        byte(std::uint8_t(request.value));
        result += ':';
        for (const auto value : reading ? io.received[n] : request.bytes) byte(value);
        result += ';';
    }
    return result;
}

void require_repeater_closed(const UsbRecorder& io) {
    require(io.requests.size() >= 2 &&
            io.requests[io.requests.size() - 2] == UsbRequest{0x40, 0, 0x120, 0x11, {0x10}, 3000} &&
            io.requests.back() == UsbRequest{0xc0, 0, 0x120, 0x0a, {0}, 3000},
            "Tuner operation did not attempt complete I2C repeater cleanup");
}

void usb_protocol() {
    UsbRecorder io;
    cospas::RtlUsbRegisters registers(io);
    require(registers.write_register(1, 0x2148, 0x1002, 2) == 0 &&
            registers.write_register(5, 0x1234, 0xabcd, 1) == 0 &&
            registers.write_demod_register(1, 0x16, 0x1234, 2) == 0,
            "Valid USB register writes failed");
    const std::vector<UsbRequest> expected{
        {0x40, 0, 0x2148, 0x110, {0x10, 0x02}, 3000},
        {0x40, 0, 0x1234, 0x211, {0xcd}, 3000},
        {0x40, 0, 0x1620, 0x11, {0x12, 0x34}, 3000},
        {0xc0, 0, 0x0120, 0x0a, {0}, 3000},
    };
    require(io.requests == expected, "USB vendor fields, big-endian payload or demod flush differs");
    io.reset();
    std::array<std::uint8_t, 2> data{};
    require(registers.read_i2c(0x34, data) == 0 && data == std::array<std::uint8_t, 2>{0x5a, 0x5a} &&
            io.requests == std::vector<UsbRequest>{{0xc0, 0, 0x34, 0x600, {0, 0}, 3000}},
            "I2C USB read request or received bytes differ");
    io.reset();
    data.fill(0);
    require(registers.read_register(2, 0x3001, data) == 0 &&
            io.requests == std::vector<UsbRequest>{{0xc0, 0, 0x3001, 0x200, {0, 0}, 3000}},
            "System register read must use the block index without the write flag");

    for (const auto& responses : {std::vector<int>{-7, 1}, {1, -9}, {0, 1}, {1, 0}, {-7, -9}}) {
        io.reset(responses);
        const auto status = registers.set_i2c_repeater(true);
        const int expected_status = responses[0] < 0 ? responses[0] :
                                    responses[0] == 0 ? LIBUSB_ERROR_IO :
                                    responses[1] < 0 ? responses[1] : LIBUSB_ERROR_IO;
        require(status == expected_status && io.requests.size() == 2 &&
                io.requests[1].type == 0xc0 && io.requests[1].index == 0x0a,
                "Failed/short demod writes must still flush and return the primary or flush error");
    }
    io.reset({1});
    require(registers.write_register(1, 0x2148, 0x1002, 2) == LIBUSB_ERROR_IO,
            "Short general register write was accepted");
    io.reset({0});
    require(registers.read_i2c(0x34, data) == LIBUSB_ERROR_IO, "Short I2C read was accepted");
    io.reset({-4});
    require(registers.read_i2c(0x34, data) == -4, "USB disconnect code was not preserved");

    io.reset();
    require(registers.write_register(1, 0, 0, 0) == LIBUSB_ERROR_INVALID_PARAM &&
            registers.write_demod_register(1, 0, 0, 3) == LIBUSB_ERROR_INVALID_PARAM &&
            registers.read_demod_register(1, 0, {}) == LIBUSB_ERROR_INVALID_PARAM &&
            registers.read_register(2, 0x3001, {}) == LIBUSB_ERROR_INVALID_PARAM &&
            registers.read_i2c(0x34, {}) == LIBUSB_ERROR_INVALID_PARAM,
            "Invalid USB register lengths were accepted");
    std::array<std::uint8_t, 256> large{};
    require(registers.read_i2c(0x34, large) == LIBUSB_ERROR_INVALID_PARAM && io.requests.empty(),
            "Invalid USB input must be rejected before issuing control requests");
    require_error<std::invalid_argument>([&] { cospas::RtlUsbRegisters invalid(io, 0x35); });
    require(cospas::supported_rtl_usb_id(0x0bda, 0x2838) &&
            cospas::supported_rtl_usb_id(0x1f4d, 0xd803), "USB devices were not recognized");
    require_error<std::invalid_argument>([] { cospas::RtlUsbDevice unrelated({0xffff, 0xffff, 0, 0}); });
}

void usb_gain_integration() {
    UsbRecorder io;
    cospas::RtlUsbRegisters registers(io);
    std::uint8_t cached = 0xaa;
    require(registers.read_cached_tuner_register(5, cached) == LIBUSB_ERROR_NOT_FOUND && cached == 0xaa &&
            registers.read_cached_tuner_register(4, cached) == LIBUSB_ERROR_INVALID_PARAM,
            "Uninitialized tuner cache must not invent register values");
    require(registers.write_tuner_register(5, 0xe0) == 0 &&
            registers.write_tuner_register(7, 0xf0) == 0 &&
            registers.write_tuner_register(12, 0xff) == 0, "Test register image writes failed");
    io.reset();
    cospas::RtlFrontendControl control(registers, 0);
    const std::vector<UsbRequest> expected{
        {0x40, 0, 0x0120, 0x11, {0x18}, 3000},
        {0xc0, 0, 0x0120, 0x0a, {0}, 3000},
        {0x40, 0, 0x34, 0x610, {5, 0xf0}, 3000},
        {0x40, 0, 0x34, 0x610, {5, 0xff}, 3000},
        {0x40, 0, 0x34, 0x610, {7, 0xe0}, 3000},
        {0x40, 0, 0x34, 0x610, {7, 0xec}, 3000},
        {0x40, 0, 0x34, 0x610, {12, 0x6f}, 3000},
        {0x40, 0, 0x0120, 0x11, {0x10}, 3000},
        {0xc0, 0, 0x0120, 0x0a, {0}, 3000},
    };
    require(io.requests == expected && control.gain_index() == 0,
            "gain controller did not produce the exact USB transaction sequence");
    io.reset({1, 1, 2, -7, 1, 1});
    control.set_gain(8);
    require(control.gain_index() == 8 && io.requests.size() == 15 &&
            registers.read_cached_tuner_register(5, cached) == 0 && cached == 0xf4,
            "USB gain retry must work after a failed partial register transaction");
    io.reset({1});
    require(registers.write_tuner_register(5, 0xab) == LIBUSB_ERROR_IO &&
            registers.read_cached_tuner_register(5, cached) == 0 && cached == 0xab,
            "Failed tuner write must preserve the desired cache image for retry");
    registers.invalidate_tuner_cache();
    require(registers.read_cached_tuner_register(5, cached) == LIBUSB_ERROR_NOT_FOUND,
            "Tuner reset must invalidate the cache");
    io.reset();
    require(registers.write_tuner_register(32, 0) == LIBUSB_ERROR_INVALID_PARAM && io.requests.empty(),
            "Out-of-range tuner register must not reach USB");
    cospas::RtlUsbRegisters r828d(io, 0x74);
    require(r828d.write_tuner_register(5, 0x12) == 0 &&
            io.requests == std::vector<UsbRequest>{{0x40, 0, 0x74, 0x610, {5, 0x12}, 3000}},
            "R828D transport must use its I2C address");
}

void tuner_blocks() {
    UsbRecorder io;
    cospas::RtlUsbRegisters registers(io);
    std::array<std::uint8_t, 27> values{};
    for (std::size_t n = 0; n < values.size(); ++n) values[n] = std::uint8_t(n + 1);
    require(registers.write_tuner_registers(5, values) == 0 &&
            tuner_trace(io) == "W34:0501020304050607;W34:0C08090A0B0C0D0E;"
                               "W34:130F101112131415;W34:1A161718191A1B;",
            "Multi-register writes must advance by 7 data bytes, never by the register address");
    io.reset({8, -7});
    require(registers.write_tuner_registers(5, values) == -7 && io.requests.size() == 2,
            "Multi-register transfer must stop at first failed chunk");
    std::uint8_t cached{};
    require(registers.read_cached_tuner_register(31, cached) == 0 && cached == 27,
            "Partial write must retain complete desired image for explicit recovery");
    io.reset();
    require(registers.write_tuner_registers(6, values) == LIBUSB_ERROR_INVALID_PARAM &&
            registers.write_tuner_registers(5, {}) == LIBUSB_ERROR_INVALID_PARAM &&
            registers.read_tuner_registers(31, std::span(values).first(2)) == LIBUSB_ERROR_INVALID_PARAM &&
            io.requests.empty(), "Invalid tuner spans must not issue USB transfers");
    for (const auto& responses : {std::vector<int>{-7}, {0}, {1, -4}, {1, 0}}) {
        io.reset(responses);
        std::array<std::uint8_t, 5> status{};
        const auto result = registers.read_tuner_registers(0, status);
        const auto expected = responses[0] < 0 ? responses[0] :
                              responses.size() == 2 && responses[1] < 0 ? responses[1] : LIBUSB_ERROR_IO;
        require(result == expected && io.requests.size() == responses.size(),
                "Status selector/read failures must stop and preserve their USB error");
    }
}

// Expected register sequences for cold starts and repeated tuning.
constexpr auto initial_tuner_oracle =
        "W34:05833275C040D66C;W34:0CF56375686C8380;W34:13000F00C03048CC;W34:1A600054AE4AC0;"
        "W34:1DED;W34:1C24;W34:0D53;W34:0E75;W34:0583;W34:0632;W34:11BB;W34:1720;W34:0AD6;"
        "W34:1DC5;W34:1C20;W34:0632;W34:1A70;W34:1DDD;W34:1C24;W34:1E4E;W34:1A60;"
        "W34:0CF0;W34:1331;W34:1D86;W34:0B68;W34:0F6C;W34:106C;W34:106C;W34:1A60;W34:1206;"
        "W34:00;R34:00000200C40000;W34:108C;W34:1484;W34:1206;W34:161C;W34:156E;"
        "W34:00;R34:00000200C4;W34:1A68;W34:0B78;W34:0B68;W34:0F68;W34:00;R34:00000200C4;"
        "W34:0AD3;W34:0B6B;W34:0775;W34:0612;W34:1E6A;W34:0503;W34:19EC;W34:1DC5;"
        "W34:1C24;W34:0D53;W34:0E75;W34:0503;W34:0612;W34:11BB;W34:1720;W34:0AD3;"
        "W34:1DC5;W34:1C20;W34:0612;W34:1A78;W34:1DDD;W34:1C24;W34:1E6E;W34:1A68;";
void tuner_oracle() {
    UsbRecorder io;
    io.tuner_status = true;
    cospas::RtlUsbRegisters registers(io);
    cospas::R820Tuner tuner(registers);
    require_error<std::logic_error>([&] { tuner.tune(406050000); });
    require(io.requests.empty(), "Uninitialized tuner must not program RF");
    tuner.initialize();
    require(tuner_trace(io) == initial_tuner_oracle, "Native R820 initialization differs from isolated original trace");
    require(tuner.status().initialized && tuner.status().filter_code == 3 &&
            !tuner.status().actual_frequency_hz, "Calibration must finish before reporting an operating RF frequency");
    require_repeater_closed(io);
    struct Expected { std::uint32_t hz; double actual_mhz; const char* trace; };
    const std::array<Expected, 9> expected{{
        {406000000, 405.99943359375,
         "W34:1720;W34:1A69;W34:1B00;W34:1084;W34:08C0;W34:0940;W34:1084;W34:1A61;W34:1206;"
         "W34:00;R34:00000200C40000;W34:1044;W34:14CA;W34:1206;W34:16E2;W34:1578;W34:00;R34:00000200C4;W34:1A69;"},
        {406050000, 406.04975097656251,
         "W34:1720;W34:1A69;W34:1B00;W34:1044;W34:08C0;W34:0940;W34:1044;W34:1A61;W34:1206;"
         "W34:00;R34:00000200C40000;W34:1044;W34:14CA;W34:1206;W34:16E4;W34:1542;W34:00;R34:00000200C4;W34:1A69;"},
        {406100000, 406.0998486328125,
         "W34:1720;W34:1A69;W34:1B00;W34:1044;W34:08C0;W34:0940;W34:1044;W34:1A61;W34:1206;"
         "W34:00;R34:00000200C40000;W34:1044;W34:14CA;W34:1206;W34:16E6;W34:150A;W34:00;R34:00000200C4;W34:1A69;"},
        {50000000, 49.999940185546876,
         "W34:1728;W34:1A2A;W34:1BBE;W34:1044;W34:08C0;W34:0940;W34:1044;W34:1A22;W34:1206;"
         "W34:00;R34:00000200C40000;W34:10A4;W34:148B;W34:1206;W34:1685;W34:15AC;W34:00;R34:00000200C4;W34:1A2A;"},
        {450000000, 449.99923828125,
         "W34:1720;W34:1A69;W34:1B00;W34:10A4;W34:08C0;W34:0940;W34:10A4;W34:1A61;W34:1206;"
         "W34:00;R34:00000200C40000;W34:1024;W34:1484;W34:1206;W34:167F;W34:1574;W34:00;R34:00000200C4;W34:1A69;"},
        {1760000000, 1759.99845703125,
         "W34:1720;W34:1A68;W34:1B00;W34:1024;W34:08C0;W34:0940;W34:1024;W34:1A60;W34:1206;"
         "W34:00;R34:00000200C40000;W34:1004;W34:140C;W34:1206;W34:163C;W34:152A;W34:00;R34:00000200C4;W34:1A68;"},
        {399630000, 399.63,
         "W34:1720;W34:1A69;W34:1B00;W34:1004;W34:08C0;W34:0940;W34:1004;W34:1A61;W34:1206;"
         "W34:00;R34:00000200C40000;W34:1044;W34:14CA;W34:120E;W34:1600;W34:1500;W34:00;R34:00000200C4;W34:1A69;"},
        {399630125, 399.63,
         "W34:1720;W34:1A69;W34:1B00;W34:1044;W34:08C0;W34:0940;W34:1044;W34:1A61;W34:1206;"
         "W34:00;R34:00000200C40000;W34:1044;W34:14CA;W34:1206;W34:1600;W34:1500;W34:00;R34:00000200C4;W34:1A69;"},
        {403230000, 403.22934082031247,
         "W34:1720;W34:1A69;W34:1B00;W34:1044;W34:08C0;W34:0940;W34:1044;W34:1A61;W34:1206;"
         "W34:00;R34:00000200C40000;W34:1044;W34:14CA;W34:1206;W34:167F;W34:15FA;W34:00;R34:00000200C4;W34:1A69;"},
    }};
    for (const auto& item : expected) {
        io.reset();
        const auto actual = tuner.tune(item.hz);
        require(tuner_trace(io) == item.trace, "Native RF tuning commands differ from expected register sequence");
        require(std::abs(actual - item.actual_mhz * 1000000.0) <= 0.000001,
                "Native actual RF frequency differs from original PLL by over one microhertz");
        require_repeater_closed(io);
    }
    const auto previous = tuner.status().actual_frequency_hz;
    io.reset();
    for (const auto invalid : {0u, 2000000000u, 4294967295u})
        require_error<std::invalid_argument>([&] { tuner.tune(invalid); });
    require(io.requests.empty() && tuner.status().actual_frequency_hz == previous && tuner.status().initialized,
            "Invalid RF input must be rejected before state changes or USB writes");
}

void tuner_failures() {
    UsbRecorder io;
    io.tuner_status = true;
    cospas::RtlUsbRegisters registers(io);
    cospas::R820Tuner tuner(registers);
    io.pll_settle_time = std::chrono::milliseconds(5);
    tuner.initialize();
    tuner.tune(406050000);
    tuner.initialize();
    tuner.tune(406050000);
    require(tuner.status().initialized && tuner.status().actual_frequency_hz.has_value(),
            "Cold PLL and repeated receiver initialization must allow hardware settling before lock checks");
    io.pll_settle_time = std::chrono::milliseconds(0);
    io.reset();
    const std::array<std::uint8_t, 7> good{0, 0, 0x40, 0, 0x23, 0, 0};
    auto invalid_cal = good;
    invalid_cal[4] = 0x2f;
    auto recovered_cal = good;
    recovered_cal[4] = 0x24;
    io.decoded_reads = {good, good, invalid_cal, good, good, recovered_cal};
    tuner.initialize();
    require(tuner.status().initialized && tuner.status().filter_code == 4 && io.next_read == 6,
            "Filter calibration must retry once when status code is 15");

    io.reset();
    auto unlocked = good;
    unlocked[2] = 0;
    io.decoded_reads = {good, unlocked, good};
    tuner.tune(406050000);
    require(io.next_read == 3 && tuner.status().actual_frequency_hz.has_value(),
            "PLL must retry its lock read once after writing VCO current");
    require_repeater_closed(io);
    io.reset();
    io.decoded_reads = {good, unlocked, unlocked};
    const auto lock_error = require_error<std::runtime_error>([&] { tuner.tune(406050000); });
    require(lock_error.find("did not lock") != std::string::npos && !tuner.status().initialized &&
            !tuner.status().actual_frequency_hz, "Unlocked PLL must invalidate tuner state");
    require_repeater_closed(io);
    io.reset();
    require_error<std::logic_error>([&] { tuner.tune(406050000); });
    require(io.requests.empty(), "Failed tuner must require explicit reinitialization");
    tuner.initialize();
    require(tuner.status().initialized, "Explicit initialization must recover a failed tuner");

    for (const auto& test : {std::array<std::uint32_t, 3>{406050000, 1, 0x60},
                            {406050000, 3, 0x20}, {1760000000, 3, 0xe0}}) {
        io.reset();
        auto fine = good;
        fine[4] = std::uint8_t((test[1] << 4) | 3);
        io.decoded_reads = {fine, good};
        tuner.tune(test[0]);
        std::uint8_t divider{};
        require(registers.read_cached_tuner_register(0x10, divider) == 0 &&
                (divider & 0xe0) == test[2], "VCO fine status must adjust the divider with byte wrap semantics");
    }

    io.reset();
    io.closing_failures = 1;
    const auto close_error = require_error<std::runtime_error>([&] { tuner.initialize(); });
    require(close_error.find("code -9") != std::string::npos && !tuner.status().initialized,
            "Successful calibration must not be confirmed after repeater close fails");
    require_repeater_closed(io);
    io.reset();
    io.filter_code = 15;
    const auto calibration_error = require_error<std::runtime_error>([&] { tuner.initialize(); });
    require(calibration_error.find("failed twice") != std::string::npos && !tuner.status().initialized,
            "Double calibration failure must not silently substitute filter code zero");
    require_repeater_closed(io);
    std::uint8_t cached{};
    require(registers.read_cached_tuner_register(5, cached) == LIBUSB_ERROR_NOT_FOUND,
            "Failed tuner initialization must invalidate its desired register image");

    io.filter_code = 3;
    io.reset({1, 1, -7, 1, -9});
    const auto transport_error = require_error<std::runtime_error>([&] { tuner.initialize(); });
    require(transport_error.find("code -7") != std::string::npos &&
            transport_error.find("code -9") != std::string::npos && !tuner.status().initialized,
            "Initialization must report both primary USB and repeater cleanup failures");
    require_repeater_closed(io);
    require_error<std::invalid_argument>([&] { cospas::R820Tuner inconsistent_v4(registers, true); });
}

void r828_oracle() {
    std::string initialization(initial_tuner_oracle);
    for (const auto& pair : {std::pair{"W34:", "W74:"}, {"R34:", "R74:"},
                             {"R74:00000200C4", "R74:00000200C8"}}) {
        std::size_t offset = 0;
        while ((offset = initialization.find(pair.first, offset)) != std::string::npos) {
            initialization.replace(offset, std::string_view(pair.first).size(), pair.second);
            offset += std::string_view(pair.second).size();
        }
    }
    struct Expected { std::uint32_t hz; double actual; const char *trace, *normal, *blog; };
    const std::array<Expected, 3> expected{{
        {162000000, 161999804.6875,
         "W74:1720;W74:1A2A;W74:1B14;W74:1084;W74:08C0;W74:0940;W74:1084;W74:1A22;W74:1206;"
         "W74:00;R74:00000200C80000;W74:1064;W74:1408;W74:1206;W74:1678;W74:15E0;"
         "W74:00;R74:00000200C8;W74:1A2A;", "W74:0563;", "W74:0612;W74:0543;W74:0563;"},
        {406050000, 406049658.203125,
         "W74:1720;W74:1A69;W74:1B00;W74:1064;W74:08C0;W74:0940;W74:1064;W74:1A61;W74:1206;"
         "W74:00;R74:00000200C80000;W74:1044;W74:14CA;W74:1206;W74:16A1;W74:15C4;"
         "W74:00;R74:00000200C8;W74:1A69;", "W74:0503;", "W74:0612;W74:0523;W74:0503;"},
        {406100000, 406099755.859375,
         "W74:1720;W74:1A69;W74:1B00;W74:1044;W74:08C0;W74:0940;W74:1044;W74:1A61;W74:1206;"
         "W74:00;R74:00000200C80000;W74:1044;W74:14CA;W74:1206;W74:16A3;W74:158C;"
         "W74:00;R74:00000200C8;W74:1A69;", "", ""},
    }};
    for (const bool blog : {false, true}) {
        UsbRecorder io;
        io.tuner_status = true;
        io.fine_tune = 1;
        cospas::RtlUsbRegisters registers(io, 0x74);
        cospas::R820Tuner tuner(registers, blog);
        tuner.initialize();
        require(tuner_trace(io) == initialization && tuner.status().i2c_address == 0x74,
                "R828D initialization must match its configured I2C address and VCO fine-tune");
        io.reset();
        require(tuner.set_bandwidth(921600) == 1700000 && tuner_trace(io) == "W74:0AC3;W74:0BEB;",
                "R828D bandwidth trace differs from original");
        for (const auto& item : expected) {
            io.reset();
            require(std::abs(tuner.tune(item.hz) - item.actual) <= 0.000001 &&
                    tuner_trace(io) == std::string(item.trace) + (blog ? item.blog : item.normal),
                    "R828D/Blog V4 RF input switching or PLL differs from original");
            require_repeater_closed(io);
        }
        for (const auto fine : {0, 2}) {
            io.reset();
            io.fine_tune = std::uint8_t(fine);
            tuner.tune(406050000);
            std::uint8_t divider{};
            require(registers.read_cached_tuner_register(0x10, divider) == 0 &&
                    (divider & 0xe0) == (fine == 0 ? 0x60 : 0x20),
                    "R828D fine tuning must be relative to one, not the R820 value two");
        }
        if (blog) {
            io.reset();
            const auto previous = tuner.status().actual_frequency_hz;
            require_error<std::invalid_argument>([&] { tuner.tune(26500000); });
            require(io.requests.empty() && tuner.status().actual_frequency_hz == previous,
                    "Unported Blog V4 HF mode must be refused without changing operating state");
        }
    }
}

void bandwidth_oracle() {
    UsbRecorder io;
    io.tuner_status = true;
    cospas::RtlUsbRegisters registers(io);
    cospas::R820Tuner tuner(registers);
    require_error<std::logic_error>([&] { tuner.set_bandwidth(921600); });
    require(io.requests.empty(), "Bandwidth selection must require initialized hardware");
    tuner.initialize();
    struct Expected { std::uint32_t bandwidth, intermediate; const char* trace; };
    const std::array<Expected, 15> expected{{
        {921600, 1700000, "W34:0AC3;W34:0BEB;"},
        {350000, 2125000, "W34:0AC3;W34:0BE6;"},
        {350001, 2075000, "W34:0AC3;W34:0BE7;"},
        {450000, 2075000, "W34:0AC3;W34:0BE7;"},
        {450001, 2025000, "W34:0AC3;W34:0BE8;"},
        {1700000, 1450000, "W34:0AC3;W34:0BEF;"},
        {1700001, 1750000, "W34:0AC3;W34:0BAC;"},
        {2050000, 1625000, "W34:0AC3;W34:0BAF;"},
        {2050001, 1640000, "W34:0AC3;W34:0BCF;"},
        {2430000, 1815000, "W34:0AC3;W34:0B8F;"},
        {2430001, 3570000, "W34:0AD3;W34:0B6B;"},
        {6000000, 3570000, "W34:0AD3;W34:0B6B;"},
        {6000001, 4570000, "W34:0AD3;W34:0B2A;"},
        {7000000, 4570000, "W34:0AD3;W34:0B2A;"},
        {7000001, 4570000, "W34:0AD3;W34:0B0B;"},
    }};
    for (const auto& item : expected) {
        io.reset();
        require(tuner.set_bandwidth(item.bandwidth) == item.intermediate &&
                tuner.status().intermediate_frequency_hz == item.intermediate &&
                !tuner.status().actual_frequency_hz && tuner_trace(io) == item.trace,
                "R820 bandwidth/IF boundary differs from isolated original trace");
        require_repeater_closed(io);
        if (item.bandwidth == 921600) {
            io.reset();
            const auto actual = tuner.tune(406050000);
            require(std::abs(actual - 406049658.203125) <= 0.000001 &&
                    tuner_trace(io) ==
                    "W34:1720;W34:1A69;W34:1B00;W34:1084;W34:08C0;W34:0940;W34:1084;W34:1A61;W34:1206;"
                    "W34:00;R34:00000200C40000;W34:1044;W34:14CA;W34:1206;W34:16A1;W34:15C4;"
                    "W34:00;R34:00000200C4;W34:1A69;",
                    "RF PLL must use the selected IF, including actual-frequency subtraction");
        }
    }
    tuner.tune(406050000);
    const auto previous = tuner.status().actual_frequency_hz;
    io.reset();
    require_error<std::invalid_argument>([&] { tuner.set_bandwidth(0); });
    require(io.requests.empty() && tuner.status().actual_frequency_hz == previous,
            "Invalid bandwidth must preserve the operating state without I/O");
    io.reset({1, 1, 2, -7});
    const auto error = require_error<std::runtime_error>([&] { tuner.set_bandwidth(921600); });
    require(error.find("code -7") != std::string::npos && !tuner.status().initialized &&
            !tuner.status().actual_frequency_hz, "Failed bandwidth writes must invalidate RF and IF confirmation");
    require_repeater_closed(io);
    io.reset();
    tuner.initialize();
    require(tuner.status().intermediate_frequency_hz == 3570000,
            "Explicit reinitialization must restore the initial IF");
}

std::string baseband_trace(const UsbRecorder& io) {
    constexpr char digits[] = "0123456789ABCDEF";
    std::string result;
    const auto hex = [&](unsigned value, int width) {
        for (int digit = width - 1; digit >= 0; --digit) result += digits[(value >> (digit * 4)) & 15];
    };
    for (const auto& request : io.requests) {
        if (request.type != 0x40 || request.index == 0x610) continue;
        const bool demod = request.index <= 0x1f;
        result += demod ? 'D' : 'W';
        hex(demod ? request.index & 15 : request.index >> 8, 2); result += ':';
        hex(demod ? request.value >> 8 : request.value, 4); result += ':';
        result += char('0' + request.bytes.size()); result += ':';
        unsigned value = 0;
        for (const auto byte : request.bytes) value = (value << 8) | byte;
        hex(value, 4); result += ';';
    }
    return result;
}

void receiver_oracle() {
    UsbRecorder io;
    io.tuner_status = io.receiver_mode = true;
    cospas::RtlUsbRegisters registers(io);
    cospas::Rtl2832 receiver(registers);
    require_error<std::logic_error>([&] { receiver.status(); });
    require_error<std::logic_error>([&] { receiver.reset_buffer(); });
    for (const auto invalid : {0u, 405999999u, 406170001u, 4294967295u})
        require_error<std::invalid_argument>([&] { receiver.initialize(invalid); });
    require(io.requests.empty(), "Invalid receiver requests must not access USB");
    receiver.initialize(406050000);
    // Original baseband routine with the approved signed-FIR check repair.
    constexpr auto original =
        "W01:2000:1:0009;W01:2158:2:0002;W01:2148:2:1002;W02:300B:1:0022;W02:3000:1:00E8;"
        "D01:0001:1:0014;D01:0001:1:0010;D01:0015:1:0000;D01:0016:2:0000;"
        "D01:0016:1:0000;D01:0017:1:0000;D01:0018:1:0000;D01:0019:1:0000;D01:001A:1:0000;D01:001B:1:0000;"
        "D01:001C:1:00CA;D01:001D:1:00DC;D01:001E:1:00D7;D01:001F:1:00D8;D01:0020:1:00E0;"
        "D01:0021:1:00F2;D01:0022:1:000E;D01:0023:1:0035;D01:0024:1:0006;D01:0025:1:0050;"
        "D01:0026:1:009C;D01:0027:1:000D;D01:0028:1:0071;D01:0029:1:0011;D01:002A:1:0014;"
        "D01:002B:1:0071;D01:002C:1:0074;D01:002D:1:0019;D01:002E:1:0041;D01:002F:1:00A5;"
        "D00:0019:1:0005;D01:0093:1:00F0;D01:0094:1:000F;D01:0011:1:0000;D01:0004:1:0000;"
        "D00:0061:1:0060;D00:0006:1:0080;D01:00B1:1:001A;D00:000D:1:0083;";
    const auto trace = baseband_trace(io);
    require(trace.starts_with(original), "RTL2832 baseband and packed signed FIR differ from original oracle");
    const auto initial_if = trace.find("D01:0019:1:0030;D01:001A:1:00AA;D01:001B:1:00AA;");
    const auto operating_if = trace.find("D01:0019:1:003C;D01:001A:1:0038;D01:001B:1:00E3;");
    require(initial_if != std::string::npos && operating_if > initial_if && operating_if != std::string::npos,
            "Demod IF must preserve original negative floor rounding and replace the transient 35.7 MHz IF");
    require(trace.ends_with("D01:009F:2:07D0;D01:00A1:2:0000;D01:003F:1:0000;D01:003E:1:0000;"
                            "D01:0001:1:0014;D01:0001:1:0010;D01:0001:1:0018;D01:0001:1:0010;"),
            "RTL sample ratio, zero PPM correction or final reset/repeater sequence differs");
    require(trace.find("W02:3001:1:005A;W02:3004:1:005A;W02:3003:1:005B;") != std::string::npos,
            "Bias-T GPIO must go low before output enable, preserving unrelated GPIO bits");
    require(receiver.status().initialized && receiver.status().intermediate_frequency_hz == 1700000 &&
            std::abs(*receiver.status().actual_frequency_hz - 406049658.203125) <= 0.000001,
            "Receiver must confirm the complete startup and actual RF only after readback");
    const auto successful = io.requests;
    io.reset();
    receiver.reset_buffer();
    require(io.requests == std::vector<UsbRequest>{
                {0x40, 0, 0x2148, 0x110, {0x10, 0x02}, 3000},
                {0x40, 0, 0x2148, 0x110, {0x00, 0x00}, 3000}},
            "FIFO reset must use both original big-endian USB writes");
    io.reset({-7});
    require_error<std::runtime_error>([&] { receiver.reset_buffer(); });
    require_error<std::logic_error>([&] { receiver.status(); });
    for (const auto failure : {std::size_t(0), std::size_t(18), successful.size() - 1}) {
        std::vector<int> responses;
        for (std::size_t n = 0; n < failure; ++n) responses.push_back(int(successful[n].bytes.size()));
        responses.push_back(-7);
        io.reset(std::move(responses));
        const auto error = require_error<std::runtime_error>([&] { receiver.initialize(406050000); });
        require(error.find("code -7") != std::string::npos, "Receiver lost the original USB failure");
        require_error<std::logic_error>([&] { receiver.status(); });
        std::uint8_t value{};
        require(registers.read_cached_tuner_register(5, value) == LIBUSB_ERROR_NOT_FOUND,
                "Failed receiver must not leave a confirmed tuner cache");
        require_repeater_closed(io);
    }
    const auto probe = std::find_if(successful.begin(), successful.end(), [](const auto& request) {
        return request.type == 0xc0 && request.index == 0x600 && request.bytes.size() == 1;
    });
    require(probe != successful.end(), "Successful receiver startup must contain the raw tuner probe");
    std::vector<int> disconnected;
    for (auto request = successful.begin(); request != probe; ++request)
        disconnected.push_back(int(request->bytes.size()));
    disconnected.push_back(LIBUSB_ERROR_NO_DEVICE);
    io.reset(std::move(disconnected));
    require(require_error<std::runtime_error>([&] { receiver.initialize(406050000); }).find("code -4") !=
            std::string::npos && std::none_of(io.requests.begin(), io.requests.end(), [](const auto& request) {
                return request.index == 0x600 && request.value == 0x74;
            }), "USB disconnect during probing must not be mistaken for an absent I2C address");
    io.reset();
    io.corrupt_fir = true;
    const auto mismatch = require_error<std::runtime_error>([&] { receiver.initialize(406050000); });
    require(mismatch.find("FIR readback mismatch") != std::string::npos,
            "Receiver must reject a FIR write acknowledged but not applied");
    io.corrupt_fir = false;
    io.reset();
    io.chip_id = 0x42;
    require(require_error<std::runtime_error>([&] { receiver.initialize(406050000); }).find("chip ID") !=
            std::string::npos, "Unsupported tuner must not be initialized as R820");
    require_repeater_closed(io);
    io.reset();
    io.chip_id = 0x69;
    receiver.initialize(406050000);
    require(receiver.status().initialized, "Explicit initialization must recover a failed receiver");
    io.reset();
    io.chip_address = 0x74;
    io.fine_tune = 1;
    cospas::Rtl2832 v4(registers, true);
    v4.initialize(406050000);
    require(v4.status().i2c_address == 0x74 &&
            std::abs(*v4.status().actual_frequency_hz - 406049658.203125) <= 0.000001,
            "Receiver must detect R828D after the expected absent-address STALL at 0x34");
    require(std::all_of(io.requests.begin(), io.requests.end(), [](const auto& request) {
                return request.index != 0x610 || request.value == 0x74;
            }), "Detected R828D must never receive tuner writes at the R820 address");
}

class SampleRecorder final : public cospas::RtlUsbSampleIo {
public:
    int calls{}, stops{};
    bool disconnect{true}, invalid_count{};
    std::latch* seventeenth_read{};
    int read_iq(std::span<std::uint8_t> data, std::size_t& transferred, unsigned timeout_ms) noexcept override {
        ++calls;
        if (seventeenth_read && calls == 17) seventeenth_read->count_down();
        transferred = 0;
        if (timeout_ms != 250) return LIBUSB_ERROR_INVALID_PARAM;
        if (disconnect && calls >= 3) return LIBUSB_ERROR_NO_DEVICE;
        transferred = disconnect && calls == 2 ? 512 : data.size();
        if (invalid_count) transferred = data.size() + 1;
        std::fill(data.begin(), data.end(), std::uint8_t(calls));
        return disconnect && calls == 2 ? LIBUSB_ERROR_TIMEOUT : 0;
    }
    int stop_iq() noexcept override { ++stops; return 0; }
};

void iq_acquisition() {
    SampleRecorder io;
    cospas::RtlIqCapture capture(io);
    cospas::RtlIqBlock block;
    require(capture.read(block) && block.transferred == 12800 && !block.timed_out &&
            block.bytes.front() == 1 && block.bytes.back() == 1,
            "Acquisition must deliver the first complete USB payload before later transport errors");
    require(capture.read(block) && block.transferred == 512 && block.timed_out && block.bytes[511] == 2,
            "Partial timeout payload must retain its exact count, ordering and timeout status");
    const auto disconnected = require_error<std::runtime_error>([&] { capture.read(block); });
    require(disconnected.find("code -4") != std::string::npos,
            "USB disconnect must be terminal and retain the actual libusb error");
    capture.stop();
    require(io.calls == 3 && io.stops == 1,
            "Capture must stop reading and drain USB exactly once after its first terminal transport error");

    SampleRecorder overflowing;
    overflowing.disconnect = false;
    std::latch full(1);
    overflowing.seventeenth_read = &full;
    cospas::RtlIqCapture bounded(overflowing);
    full.wait();
    bounded.stop();
    for (int n = 1; n <= 16; ++n)
        require(bounded.read(block) && block.transferred == 12800 && block.bytes.front() == n,
                "The sixteen preallocated acquisition slots must preserve FIFO order");
    const auto overflow = require_error<std::runtime_error>([&] { bounded.read(block); });
    require(overflow.find("continuity lost") != std::string::npos && overflowing.calls == 17 && overflowing.stops == 1,
            "Full acquisition queue must terminate explicitly instead of blocking or silently dropping samples");
    SampleRecorder malformed;
    malformed.invalid_count = true;
    cospas::RtlIqCapture invalid(malformed);
    require(require_error<std::runtime_error>([&] { invalid.read(block); }).find("invalid I/Q byte count") !=
            std::string::npos, "Malformed USB sample counts must not escape the capture buffer");
}

}

int main() {
    try {
        registers();
        measurements();
        automatic_gain();
        failures();
        invalid_input();
        usb_protocol();
        usb_gain_integration();
        tuner_blocks();
        tuner_oracle();
        tuner_failures();
        r828_oracle();
        bandwidth_oracle();
        receiver_oracle();
        iq_acquisition();
        std::cout << "RTL gain, FE_AGC, USB, R820 PLL/bandwidth and RTL2832/FIR register checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
