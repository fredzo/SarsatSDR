#include "rtl_iq_capture.hpp"

#include <libusb.h>

#include <atomic>
#include <condition_variable>
#include <cstdio>
#include <exception>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>

namespace cospas {

struct RtlIqCapture::Impl {
    RtlUsbSampleIo& source;
    std::array<RtlIqBlock, rtl_iq_queue_blocks> queue;
    std::mutex mutex;
    std::condition_variable ready;
    std::size_t begin{}, count{};
    std::atomic<bool> stopping{};
    bool finished{};
    std::exception_ptr failure;
    std::thread producer;

    explicit Impl(RtlUsbSampleIo& input) : source(input), producer([this] { acquire(); }) {}

    void acquire() noexcept {
        std::exception_ptr error;
        try {
            RtlIqBlock block;
            while (!stopping.load()) {
                block.transferred = 0;
                const int status = source.read_iq(block.bytes, block.transferred, 250);
                if (block.transferred > block.bytes.size())
                    throw std::runtime_error("RTL-SDR USB returned an invalid I/Q byte count");
                if (status != 0 && status != LIBUSB_ERROR_TIMEOUT)
                    throw std::runtime_error(std::string("Reading RTL-SDR I/Q: ") + libusb_error_name(status) +
                                             " (code " + std::to_string(status) + ", partial bytes " +
                                             std::to_string(block.transferred) + ")");
                block.timed_out = status == LIBUSB_ERROR_TIMEOUT;
                {
                    std::lock_guard lock(mutex);
                    if (count == queue.size())
                        throw std::runtime_error("RTL-SDR I/Q acquisition queue full; sample continuity lost");
                    queue[(begin + count) % queue.size()] = block;
                    ++count;
                }
                ready.notify_one();
            }
        } catch (const std::exception&) {
            error = std::current_exception();
        }
        const int stop_status = source.stop_iq();
        if (stop_status != 0) {
            if (!error) {
                try {
                    throw std::runtime_error(std::string("Stopping RTL-SDR I/Q: ") +
                        libusb_error_name(stop_status) + " (code " + std::to_string(stop_status) + ")");
                } catch (const std::exception&) {
                    error = std::current_exception();
                }
            } else {
                std::fprintf(stderr, "Stopping RTL-SDR I/Q: %s (code %d)\n",
                    libusb_error_name(stop_status), stop_status);
            }
        }
        {
            std::lock_guard lock(mutex);
            failure = error;
            finished = true;
        }
        ready.notify_one();
    }

    bool read(RtlIqBlock& block) {
        std::unique_lock lock(mutex);
        ready.wait(lock, [&] { return count || finished; });
        if (count) {
            block = queue[begin];
            begin = (begin + 1) % queue.size();
            --count;
            return true;
        }
        if (failure) std::rethrow_exception(failure);
        block.transferred = 0;
        block.timed_out = false;
        return false;
    }

    void stop() noexcept {
        stopping.store(true);
        if (producer.joinable()) producer.join();
    }

    ~Impl() { stop(); }
};

RtlIqCapture::RtlIqCapture(RtlUsbSampleIo& source) : impl_(std::make_unique<Impl>(source)) {}
RtlIqCapture::~RtlIqCapture() = default;
bool RtlIqCapture::read(RtlIqBlock& block) { return impl_->read(block); }
void RtlIqCapture::stop() noexcept { impl_->stop(); }

}
