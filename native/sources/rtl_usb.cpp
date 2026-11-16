#include "rtl_usb.hpp"
#include "dsp_tables.hpp"

#include <libusb.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <limits>
#include <stdexcept>
#include <string>

namespace cospas {
namespace {

void check_usb(int status, const char* operation) {
    if (status < 0) {
        throw std::runtime_error(std::string(operation) + ": " + libusb_error_name(status) +
                                 " (code " + std::to_string(status) + ")");
    }
}

class UsbContext {
public:
    UsbContext() {
#ifdef __ANDROID__
        // Android forbids usbfs enumeration; devices arrive as UsbManager file descriptors.
        libusb_set_option(nullptr, LIBUSB_OPTION_NO_DEVICE_DISCOVERY);
#endif
        check_usb(libusb_init(&value), "Initializing libusb");
    }
    ~UsbContext() { libusb_exit(value); }
    UsbContext(const UsbContext&) = delete;
    UsbContext& operator=(const UsbContext&) = delete;
    libusb_context* value{};
};

class UsbDeviceList {
public:
    explicit UsbDeviceList(libusb_context* context) {
        count = libusb_get_device_list(context, &value);
        if (count < 0) check_usb(static_cast<int>(count), "Enumerating USB devices");
    }
    ~UsbDeviceList() { libusb_free_device_list(value, 1); }
    UsbDeviceList(const UsbDeviceList&) = delete;
    UsbDeviceList& operator=(const UsbDeviceList&) = delete;
    libusb_device** value{};
    ssize_t count{};
};

std::array<std::uint8_t, 2> register_bytes(std::uint16_t value, std::uint8_t width) {
    return {static_cast<std::uint8_t>(width == 1 ? value : value >> 8),
            static_cast<std::uint8_t>(value)};
}

}

RtlUsbRegisters::RtlUsbRegisters(RtlUsbControlIo& io, std::uint8_t tuner_address)
    : io_(io), tuner_address_(tuner_address) {
    if (tuner_address != 0x34 && tuner_address != 0x74)
        throw std::invalid_argument("Unsupported R820T/R828D I2C address");
}

int RtlUsbRegisters::transfer(std::uint8_t request_type, std::uint16_t value, std::uint16_t index,
                               std::span<std::uint8_t> data) noexcept {
    const int count = io_.control_transfer(request_type, 0, value, index, data, 3000);
    if (count < 0) return count;
    return std::size_t(count) == data.size() ? 0 : LIBUSB_ERROR_IO;
}

int RtlUsbRegisters::write_register(std::uint8_t block, std::uint16_t address,
                                     std::uint16_t value, std::uint8_t width) noexcept {
    if (width != 1 && width != 2) return LIBUSB_ERROR_INVALID_PARAM;
    auto bytes = register_bytes(value, width);
    const auto index = static_cast<std::uint16_t>(block == 5 ? 0x211 : (unsigned(block) << 8) | 0x10);
    return transfer(0x40, address, index, std::span(bytes).first(width));
}

int RtlUsbRegisters::write_demod_register(std::uint8_t page, std::uint8_t address,
                                           std::uint16_t value, std::uint8_t width) noexcept {
    if (width != 1 && width != 2) return LIBUSB_ERROR_INVALID_PARAM;
    auto bytes = register_bytes(value, width);
    const auto encoded = static_cast<std::uint16_t>((unsigned(address) << 8) | 0x20);
    const int status = transfer(0x40, encoded, std::uint16_t(page | 0x10), std::span(bytes).first(width));
    std::array<std::uint8_t, 1> flush{};
    const int flush_status = read_demod_register(0x0a, 0x01, flush);
    return status != 0 ? status : flush_status;
}

int RtlUsbRegisters::read_register(std::uint8_t block, std::uint16_t address,
                                    std::span<std::uint8_t> data) noexcept {
    if (data.size() != 1 && data.size() != 2) return LIBUSB_ERROR_INVALID_PARAM;
    return transfer(0xc0, address, static_cast<std::uint16_t>(unsigned(block) << 8), data);
}

int RtlUsbRegisters::read_demod_register(std::uint8_t page, std::uint8_t address,
                                          std::span<std::uint8_t> data) noexcept {
    if (data.size() != 1 && data.size() != 2) return LIBUSB_ERROR_INVALID_PARAM;
    const auto encoded = static_cast<std::uint16_t>((unsigned(address) << 8) | 0x20);
    return transfer(0xc0, encoded, page, data);
}

int RtlUsbRegisters::read_i2c(std::uint8_t address, std::span<std::uint8_t> data) noexcept {
    if (data.empty() || data.size() > 255) return LIBUSB_ERROR_INVALID_PARAM;
    return transfer(0xc0, address, 0x600, data);
}

int RtlUsbRegisters::set_i2c_repeater(bool enabled) noexcept {
    return write_demod_register(1, 1, enabled ? 0x18 : 0x10, 1);
}

int RtlUsbRegisters::read_cached_tuner_register(std::uint8_t address, std::uint8_t& value) noexcept {
    if (address < 5 || address > 31) return LIBUSB_ERROR_INVALID_PARAM;
    const auto index = std::size_t(address - 5);
    if (!cached_[index]) return LIBUSB_ERROR_NOT_FOUND;
    value = cache_[index];
    return 0;
}

int RtlUsbRegisters::write_tuner_register(std::uint8_t address, std::uint8_t value) noexcept {
    return write_tuner_registers(address, std::span(&value, 1));
}

int RtlUsbRegisters::write_tuner_registers(std::uint8_t first,
                                           std::span<const std::uint8_t> values) noexcept {
    if (first < 5 || first > 31 || values.empty() || values.size() > std::size_t(32 - first))
        return LIBUSB_ERROR_INVALID_PARAM;
    const auto index = std::size_t(first - 5);
    // Update the desired register image before I2C, including on failure.
    std::copy(values.begin(), values.end(), cache_.begin() + std::ptrdiff_t(index));
    std::fill_n(cached_.begin() + std::ptrdiff_t(index), values.size(), true);
    for (std::size_t offset = 0; offset < values.size();) {
        const auto count = std::min<std::size_t>(7, values.size() - offset);
        std::array<std::uint8_t, 8> bytes{};
        bytes[0] = static_cast<std::uint8_t>(first + offset);
        std::copy_n(values.begin() + std::ptrdiff_t(offset), count, bytes.begin() + 1);
        const int status = transfer(0x40, tuner_address_, 0x610, std::span(bytes).first(count + 1));
        if (status != 0) return status;
        offset += count;
    }
    return 0;
}

int RtlUsbRegisters::read_tuner_registers(std::uint8_t first, std::span<std::uint8_t> values) noexcept {
    if (first > 31 || values.empty() || values.size() > std::size_t(32 - first))
        return LIBUSB_ERROR_INVALID_PARAM;
    std::array<std::uint8_t, 1> selector{first};
    int status = transfer(0x40, tuner_address_, 0x610, selector);
    if (status != 0) return status;
    status = read_i2c(tuner_address_, values);
    if (status != 0) return status;
    for (auto& value : values) {
        value = static_cast<std::uint8_t>((dsp_tables::r820_reverse_nibbles[value & 15] << 4) |
                                          dsp_tables::r820_reverse_nibbles[value >> 4]);
    }
    return 0;
}

void RtlUsbRegisters::invalidate_tuner_cache() noexcept { cached_.fill(false); }

bool supported_rtl_usb_id(std::uint16_t vendor_id, std::uint16_t product_id) noexcept {
    return std::any_of(dsp_tables::rtl_usb_ids.begin(), dsp_tables::rtl_usb_ids.end(),
                       [=](const auto& id) { return id[0] == vendor_id && id[1] == product_id; });
}

std::vector<RtlUsbDeviceInfo> enumerate_rtl_usb_devices() {
    UsbContext context;
    UsbDeviceList devices(context.value);
    std::vector<RtlUsbDeviceInfo> result;
    for (ssize_t n = 0; n < devices.count; ++n) {
        auto* device = devices.value[n];
        libusb_device_descriptor descriptor{};
        check_usb(libusb_get_device_descriptor(device, &descriptor), "Reading USB device descriptor");
        if (supported_rtl_usb_id(descriptor.idVendor, descriptor.idProduct)) {
            result.push_back({descriptor.idVendor, descriptor.idProduct,
                              libusb_get_bus_number(device), libusb_get_device_address(device)});
        }
    }
    return result;
}

struct RtlUsbDevice::Impl {
    struct BulkSlot {
        std::array<unsigned char, rtl_block_samples * 2> bytes{};
        std::unique_ptr<libusb_transfer, decltype(&libusb_free_transfer)> transfer{nullptr, libusb_free_transfer};
        std::atomic<bool> pending{};
    };
    UsbContext context;
    std::unique_ptr<libusb_device_handle, decltype(&libusb_close)> handle{nullptr, libusb_close};
    std::array<BulkSlot, 15> bulk;
    std::size_t next_bulk{}, bulk_offset{};
    bool streaming{};
    int stream_error{};
    bool claimed{};

    static void LIBUSB_CALL complete_bulk(libusb_transfer* transfer) noexcept {
        auto& slot = *static_cast<BulkSlot*>(transfer->user_data);
        slot.pending.store(false, std::memory_order_release);
    }

    int submit(BulkSlot& slot) noexcept {
        slot.pending.store(true, std::memory_order_release);
        const int status = libusb_submit_transfer(slot.transfer.get());
        if (status != 0) slot.pending.store(false, std::memory_order_release);
        return status;
    }

    int start_bulk() noexcept {
        for (auto& slot : bulk) {
            slot.transfer.reset(libusb_alloc_transfer(0));
            if (!slot.transfer) return LIBUSB_ERROR_NO_MEM;
            libusb_fill_bulk_transfer(slot.transfer.get(), handle.get(), 0x81,
                slot.bytes.data(), int(slot.bytes.size()), complete_bulk, &slot, 0);
        }
        streaming = true;
        for (auto& slot : bulk) {
            const int status = submit(slot);
            if (status != 0) return status;
        }
        return 0;
    }

    int stop_bulk() noexcept {
        int error = 0;
        for (auto& slot : bulk) {
            if (!slot.pending.load(std::memory_order_acquire)) continue;
            const int status = libusb_cancel_transfer(slot.transfer.get());
            if (status != 0 && status != LIBUSB_ERROR_NOT_FOUND && error == 0) error = status;
        }
        while (std::any_of(bulk.begin(), bulk.end(), [](const auto& slot) {
            return slot.pending.load(std::memory_order_acquire);
        })) {
            timeval timeout{0, 250000};
            const int status = libusb_handle_events_timeout(context.value, &timeout);
            if (status != 0 && status != LIBUSB_ERROR_INTERRUPTED && error == 0) error = status;
        }
        for (auto& slot : bulk) slot.transfer.reset();
        streaming = false;
        stream_error = 0;
        next_bulk = bulk_offset = 0;
        return error;
    }

    int read_bulk(std::span<std::uint8_t> data, std::size_t& transferred, unsigned timeout_ms) noexcept {
        if (!streaming) {
            const int status = start_bulk();
            if (status != 0) return status;
        }
        auto& slot = bulk[next_bulk];
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
        while (slot.pending.load(std::memory_order_acquire)) {
            const auto remaining = std::chrono::duration_cast<std::chrono::microseconds>(
                deadline - std::chrono::steady_clock::now()).count();
            if (remaining <= 0) return LIBUSB_ERROR_TIMEOUT;
            timeval timeout{long(remaining / 1000000), long(remaining % 1000000)};
            const int status = libusb_handle_events_timeout(context.value, &timeout);
            if (status != 0 && status != LIBUSB_ERROR_INTERRUPTED) return status;
        }
        const auto& transfer = *slot.transfer;
        switch (transfer.status) {
        case LIBUSB_TRANSFER_COMPLETED:
        case LIBUSB_TRANSFER_TIMED_OUT: break;
        case LIBUSB_TRANSFER_NO_DEVICE: return LIBUSB_ERROR_NO_DEVICE;
        case LIBUSB_TRANSFER_STALL: return LIBUSB_ERROR_PIPE;
        case LIBUSB_TRANSFER_OVERFLOW: return LIBUSB_ERROR_OVERFLOW;
        case LIBUSB_TRANSFER_CANCELLED: return LIBUSB_ERROR_INTERRUPTED;
        default: return LIBUSB_ERROR_IO;
        }
        const int result = transfer.status == LIBUSB_TRANSFER_TIMED_OUT ? LIBUSB_ERROR_TIMEOUT : 0;
        if (transfer.actual_length < 0 || std::size_t(transfer.actual_length) > slot.bytes.size() ||
            bulk_offset > std::size_t(transfer.actual_length)) return LIBUSB_ERROR_IO;
        transferred = std::min(data.size(), std::size_t(transfer.actual_length) - bulk_offset);
        std::copy_n(slot.bytes.begin() + std::ptrdiff_t(bulk_offset), transferred, data.begin());
        bulk_offset += transferred;
        if (bulk_offset == std::size_t(transfer.actual_length)) {
            const int status = submit(slot);
            if (status != 0) return status;
            bulk_offset = 0;
            next_bulk = (next_bulk + 1) % bulk.size();
        }
        return result;
    }

    explicit Impl(const RtlUsbDeviceInfo& selected) {
        if (selected.fd >= 0) {
            libusb_device_handle* opened = nullptr;
            check_usb(libusb_wrap_sys_device(context.value, intptr_t(selected.fd), &opened), "Opening RTL-SDR USB descriptor");
            handle.reset(opened);
            libusb_device_descriptor descriptor{};
            check_usb(libusb_get_device_descriptor(libusb_get_device(opened), &descriptor), "Reading selected RTL-SDR descriptor");
            if (!supported_rtl_usb_id(descriptor.idVendor, descriptor.idProduct))
                throw std::runtime_error("USB descriptor is not a RTL-SDR device");
            check_usb(libusb_claim_interface(handle.get(), 0), "Claiming RTL-SDR USB interface 0");
            claimed = true;
            return;
        }
        UsbDeviceList devices(context.value);
        for (ssize_t n = 0; n < devices.count; ++n) {
            auto* device = devices.value[n];
            if (libusb_get_bus_number(device) != selected.bus ||
                libusb_get_device_address(device) != selected.address) continue;
            libusb_device_descriptor descriptor{};
            check_usb(libusb_get_device_descriptor(device, &descriptor), "Reading selected RTL-SDR descriptor");
            if (descriptor.idVendor != selected.vendor_id || descriptor.idProduct != selected.product_id) break;
            libusb_device_handle* opened = nullptr;
            check_usb(libusb_open(device, &opened), "Opening RTL-SDR USB device");
            handle.reset(opened);
            check_usb(libusb_claim_interface(handle.get(), 0), "Claiming RTL-SDR USB interface 0");
            claimed = true;
            return;
        }
        throw std::runtime_error("Selected RTL-SDR USB device is no longer present");
    }

    int close() noexcept {
        int status = stop_bulk();
        if (claimed) {
            const int release = libusb_release_interface(handle.get(), 0);
            if (status == 0) status = release;
            claimed = false;
        }
        handle.reset();
        return status;
    }

    ~Impl() {
        const int status = close();
        if (status != 0)
            std::fprintf(stderr, "Releasing RTL-SDR USB interface: %s (code %d)\n", libusb_error_name(status), status);
    }
};

RtlUsbDevice::RtlUsbDevice(const RtlUsbDeviceInfo& device) {
    if (device.fd < 0 && !supported_rtl_usb_id(device.vendor_id, device.product_id))
        throw std::invalid_argument("USB device is not in the RTL-SDR VID/PID table");
    impl_ = std::make_unique<Impl>(device);
}

RtlUsbDevice::~RtlUsbDevice() = default;

int RtlUsbDevice::control_transfer(std::uint8_t request_type, std::uint8_t request,
                                    std::uint16_t value, std::uint16_t index,
                                    std::span<std::uint8_t> data, unsigned timeout_ms) noexcept {
    if (data.size() > std::numeric_limits<std::uint16_t>::max() || timeout_ms == 0)
        return LIBUSB_ERROR_INVALID_PARAM;
    if (!impl_->handle) return LIBUSB_ERROR_NO_DEVICE;
    return libusb_control_transfer(impl_->handle.get(), request_type, request, value, index,
                                   data.data(), static_cast<std::uint16_t>(data.size()), timeout_ms);
}

int RtlUsbDevice::close() noexcept { return impl_->close(); }
int RtlUsbDevice::stop_iq() noexcept { return impl_->stop_bulk(); }

bool RtlUsbDevice::is_blog_v4() const {
    if (!impl_->handle) throw std::logic_error("Cannot read identity of a closed RTL-SDR USB device");
    libusb_device_descriptor descriptor{};
    check_usb(libusb_get_device_descriptor(libusb_get_device(impl_->handle.get()), &descriptor),
              "Reading RTL-SDR identity descriptor");
    const auto text = [&](std::uint8_t index) {
        if (index == 0) return std::string{};
        std::array<unsigned char, 256> bytes{};
        const int count = libusb_get_string_descriptor_ascii(impl_->handle.get(), index, bytes.data(), int(bytes.size()));
        check_usb(count, "Reading RTL-SDR USB identity string");
        return std::string(reinterpret_cast<const char*>(bytes.data()), static_cast<std::size_t>(count));
    };
    const auto manufacturer = text(descriptor.iManufacturer);
    const auto product = text(descriptor.iProduct);
    return manufacturer == "RTLSDRBlog" && product == "Blog V4";
}

int RtlUsbDevice::read_iq(std::span<std::uint8_t> data, std::size_t& transferred, unsigned timeout_ms) noexcept {
    transferred = 0;
    if (data.empty() || data.size() > std::size_t(std::numeric_limits<int>::max()) || timeout_ms == 0)
        return LIBUSB_ERROR_INVALID_PARAM;
    if (!impl_->handle) return LIBUSB_ERROR_NO_DEVICE;
    if (impl_->stream_error != 0) return impl_->stream_error;
    const int status = impl_->read_bulk(data, transferred, timeout_ms);
    if (status != 0 && status != LIBUSB_ERROR_TIMEOUT) impl_->stream_error = status;
    return status;
}

}
