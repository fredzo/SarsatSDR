#include "rtl_usb.hpp"
#include <libusb.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>

struct libusb_context {};
struct libusb_device {};
struct libusb_device_handle {};

namespace {
libusb_context context;
libusb_device device;
libusb_device_handle handle;
libusb_device* devices[]{&device, nullptr};
struct Pending { libusb_transfer* transfer; int sequence; bool cancelled{}; };
std::vector<Pending> pending;
int submissions{}, allocations{}, frees{}, cancellations{}, fail_submission{};
bool wait_only{}, disconnected{}, partial_timeout{};

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
}

extern "C" {
int LIBUSB_CALL libusb_init(libusb_context** result) { *result = &context; return 0; }
void LIBUSB_CALL libusb_exit(libusb_context*) {}
const char* LIBUSB_CALL libusb_error_name(int) { return "test USB status"; }
ssize_t LIBUSB_CALL libusb_get_device_list(libusb_context*, libusb_device*** result) {
    *result = devices;
    return 1;
}
void LIBUSB_CALL libusb_free_device_list(libusb_device**, int) {}
int LIBUSB_CALL libusb_get_device_descriptor(libusb_device*, libusb_device_descriptor* descriptor) {
    *descriptor = {};
    descriptor->idVendor = 0x0bda;
    descriptor->idProduct = 0x2838;
    return 0;
}
uint8_t LIBUSB_CALL libusb_get_bus_number(libusb_device*) { return 1; }
uint8_t LIBUSB_CALL libusb_get_device_address(libusb_device*) { return 2; }
int LIBUSB_CALL libusb_open(libusb_device*, libusb_device_handle** result) { *result = &handle; return 0; }
void LIBUSB_CALL libusb_close(libusb_device_handle*) {}
libusb_device* LIBUSB_CALL libusb_get_device(libusb_device_handle*) { return &device; }
int LIBUSB_CALL libusb_claim_interface(libusb_device_handle*, int) { return 0; }
int LIBUSB_CALL libusb_release_interface(libusb_device_handle*, int) { return 0; }
int LIBUSB_CALL libusb_control_transfer(libusb_device_handle*, uint8_t, uint8_t, uint16_t, uint16_t,
                                        unsigned char*, uint16_t, unsigned int) { return LIBUSB_ERROR_NOT_SUPPORTED; }
int LIBUSB_CALL libusb_get_string_descriptor_ascii(libusb_device_handle*, uint8_t, unsigned char*, int) {
    return LIBUSB_ERROR_NOT_SUPPORTED;
}
libusb_transfer* LIBUSB_CALL libusb_alloc_transfer(int) {
    auto* transfer = static_cast<libusb_transfer*>(std::calloc(1, sizeof(libusb_transfer)));
    if (transfer) ++allocations;
    return transfer;
}
void LIBUSB_CALL libusb_free_transfer(libusb_transfer* transfer) {
    if (!transfer) return;
    if (std::any_of(pending.begin(), pending.end(), [=](const auto& entry) {
        return entry.transfer == transfer;
    })) std::abort();
    ++frees;
    std::free(transfer);
}
int LIBUSB_CALL libusb_submit_transfer(libusb_transfer* transfer) {
    ++submissions;
    if (submissions == fail_submission) return LIBUSB_ERROR_IO;
    if (transfer->endpoint != 0x81 || transfer->length != 12800 || transfer->timeout != 0) std::abort();
    pending.push_back({transfer, submissions});
    return 0;
}
int LIBUSB_CALL libusb_cancel_transfer(libusb_transfer* transfer) {
    for (auto& entry : pending) {
        if (entry.transfer != transfer) continue;
        entry.cancelled = true;
        ++cancellations;
        return 0;
    }
    return LIBUSB_ERROR_NOT_FOUND;
}
int LIBUSB_CALL libusb_handle_events_timeout(libusb_context*, timeval* timeout) {
    if (wait_only) {
        std::this_thread::sleep_for(std::chrono::seconds(timeout->tv_sec) +
                                   std::chrono::microseconds(timeout->tv_usec));
        return 0;
    }
    auto completed = std::move(pending);
    pending.clear();
    for (auto entry = completed.rbegin(); entry != completed.rend(); ++entry) {
        auto* transfer = entry->transfer;
        transfer->status = entry->cancelled ? LIBUSB_TRANSFER_CANCELLED :
            disconnected ? LIBUSB_TRANSFER_NO_DEVICE :
            partial_timeout ? LIBUSB_TRANSFER_TIMED_OUT : LIBUSB_TRANSFER_COMPLETED;
        transfer->actual_length = transfer->status == LIBUSB_TRANSFER_COMPLETED ? transfer->length :
            transfer->status == LIBUSB_TRANSFER_TIMED_OUT ? 512 : 0;
        std::fill_n(transfer->buffer, transfer->actual_length, static_cast<unsigned char>(entry->sequence));
        transfer->callback(transfer);
    }
    return 0;
}
}

int main() {
    try {
        const cospas::RtlUsbDeviceInfo selected{0x0bda, 0x2838, 1, 2};
        std::array<std::uint8_t, 12800> bytes{};
        std::size_t count{};
        {
            cospas::RtlUsbDevice radio(selected);
            require(radio.read_iq(std::span(bytes).first(3), count, 10) == 0 && count == 3 && submissions == 15,
                    "All fifteen transfers must be posted before reading the first byte");
            require(radio.read_iq(bytes, count, 10) == 0 && count == bytes.size() - 3 && submissions == 16 &&
                    std::all_of(bytes.begin(), bytes.begin() + std::ptrdiff_t(count), [](auto value) { return value == 1; }),
                    "Short caller spans must preserve the remainder of a completed USB transfer");
            for (int sequence = 2; sequence <= 19; ++sequence) {
                require(radio.read_iq(bytes, count, 10) == 0 && count == bytes.size() &&
                        std::all_of(bytes.begin(), bytes.end(), [=](auto value) { return value == sequence; }),
                        "Out-of-order completion notifications must not reorder or lose I/Q bytes");
            }
            require(radio.stop_iq() == 0 && pending.empty() && allocations == frees && cancellations > 0,
                    "Stop must cancel and drain every outstanding transfer before releasing its buffers");
            wait_only = true;
            require(radio.read_iq(bytes, count, 1) == LIBUSB_ERROR_TIMEOUT && count == 0 && pending.size() == 15,
                    "Read deadline must not cancel queued transfers or discard arriving I/Q");
            wait_only = false;
            require(radio.read_iq(bytes, count, 10) == 0 && count == bytes.size(),
                    "Timed-out reads must resume the same queued stream");
        }
        require(pending.empty() && allocations == frees, "Closing must drain transfers even without explicit stop");
        {
            cospas::RtlUsbDevice radio(selected);
            fail_submission = submissions + 3;
            require(radio.read_iq(bytes, count, 10) == LIBUSB_ERROR_IO && count == 0 && pending.size() == 2,
                    "Partial startup submission failure must remain an explicit transport error");
            const int before = submissions;
            require(radio.read_iq(bytes, count, 10) == LIBUSB_ERROR_IO && submissions == before,
                    "Failed startup must not expose unsubmitted buffers as successful reads");
            require(radio.stop_iq() == 0 && pending.empty() && allocations == frees,
                    "Partial startup must cancel its submitted prefix without freeing active transfers");
        }
        {
            cospas::RtlUsbDevice radio(selected);
            partial_timeout = true;
            require(radio.read_iq(bytes, count, 10) == LIBUSB_ERROR_TIMEOUT && count == 512 &&
                    std::all_of(bytes.begin(), bytes.begin() + 512, [&](auto value) {
                        return value == static_cast<unsigned char>(submissions - 15);
                    }), "Partial USB timeout payload must retain bytes and timeout status");
            partial_timeout = false;
        }
        {
            cospas::RtlUsbDevice radio(selected);
            disconnected = true;
            require(radio.read_iq(bytes, count, 10) == LIBUSB_ERROR_NO_DEVICE && count == 0,
                    "Asynchronous disconnect must retain the actual USB error");
        }
        require(pending.empty() && allocations == frees, "Disconnect cleanup must release all transfers");
        std::cout << "RTL asynchronous USB ordering, partial reads, timeout, cancellation and failure checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
