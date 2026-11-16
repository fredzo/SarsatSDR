#pragma once

#include "rtl_control.hpp"

#include <array>
#include <memory>
#include <vector>

namespace cospas {

class RtlUsbControlIo {
public:
    virtual ~RtlUsbControlIo() = default;
    // Return the transferred byte count, or a negative libusb error.
    virtual int control_transfer(std::uint8_t request_type, std::uint8_t request,
                                 std::uint16_t value, std::uint16_t index,
                                 std::span<std::uint8_t> data, unsigned timeout_ms) noexcept = 0;
};

class RtlUsbSampleIo {
public:
    virtual ~RtlUsbSampleIo() = default;
    // Return zero or a negative libusb error; timeout payload bytes remain valid.
    virtual int read_iq(std::span<std::uint8_t> data, std::size_t& transferred,
                        unsigned timeout_ms) noexcept = 0;
    virtual int stop_iq() noexcept { return 0; }
};

class RtlUsbRegisters final : public RtlRegisterIo {
public:
    explicit RtlUsbRegisters(RtlUsbControlIo& io, std::uint8_t tuner_address = 0x34);
    RtlUsbRegisters(const RtlUsbRegisters&) = delete;
    RtlUsbRegisters& operator=(const RtlUsbRegisters&) = delete;
    // Register operations return zero on success, or a negative libusb error.
    int write_register(std::uint8_t block, std::uint16_t address,
                       std::uint16_t value, std::uint8_t width) noexcept;
    int read_register(std::uint8_t block, std::uint16_t address,
                      std::span<std::uint8_t> data) noexcept;
    int write_demod_register(std::uint8_t page, std::uint8_t address,
                             std::uint16_t value, std::uint8_t width) noexcept;
    int read_demod_register(std::uint8_t page, std::uint8_t address,
                            std::span<std::uint8_t> data) noexcept;
    int read_i2c(std::uint8_t address, std::span<std::uint8_t> data) noexcept;
    int set_i2c_repeater(bool enabled) noexcept override;
    int read_cached_tuner_register(std::uint8_t address, std::uint8_t& value) noexcept override;
    int write_tuner_register(std::uint8_t address, std::uint8_t value) noexcept override;
    int write_tuner_registers(std::uint8_t first, std::span<const std::uint8_t> values) noexcept;
    int read_tuner_registers(std::uint8_t first, std::span<std::uint8_t> values) noexcept;
    void invalidate_tuner_cache() noexcept;
private:
    friend class R820Tuner;
    friend class Rtl2832;
    int transfer(std::uint8_t request_type, std::uint16_t value, std::uint16_t index,
                 std::span<std::uint8_t> data) noexcept;
    RtlUsbControlIo& io_;
    std::uint8_t tuner_address_;
    std::array<std::uint8_t, 27> cache_{};
    std::array<bool, 27> cached_{};
};

struct RtlUsbDeviceInfo {
    std::uint16_t vendor_id{}, product_id{};
    std::uint8_t bus{}, address{};
    int fd{-1};
};

bool supported_rtl_usb_id(std::uint16_t vendor_id, std::uint16_t product_id) noexcept;
std::vector<RtlUsbDeviceInfo> enumerate_rtl_usb_devices();

class RtlUsbDevice final : public RtlUsbControlIo, public RtlUsbSampleIo {
public:
    explicit RtlUsbDevice(const RtlUsbDeviceInfo& device);
    ~RtlUsbDevice();
    RtlUsbDevice(const RtlUsbDevice&) = delete;
    RtlUsbDevice& operator=(const RtlUsbDevice&) = delete;
    int control_transfer(std::uint8_t request_type, std::uint8_t request,
                         std::uint16_t value, std::uint16_t index,
                         std::span<std::uint8_t> data, unsigned timeout_ms) noexcept override;
    // Partial data remains valid on timeout; transferred is set for every call.
    int read_iq(std::span<std::uint8_t> data, std::size_t& transferred, unsigned timeout_ms) noexcept override;
    int stop_iq() noexcept override;
    bool is_blog_v4() const;
    // Drain transfers before releasing the handle; return transport/release errors.
    int close() noexcept;
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}
