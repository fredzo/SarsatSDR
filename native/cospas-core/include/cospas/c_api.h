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

#ifndef COSPAS_C_API_H
#define COSPAS_C_API_H

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#if defined(COSPAS_C_API_BUILD)
#define CS_API __declspec(dllexport)
#else
#define CS_API __declspec(dllimport)
#endif
#define CS_CALL __cdecl
#else
#define CS_API __attribute__((visibility("default")))
#define CS_CALL
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define CS_ABI_VERSION 2u
#define CS_FGB_CHANNEL_COUNT 10u

typedef int32_t cs_status;
enum {
    CS_OK = 0,
    CS_INVALID_ARGUMENT = 1,
    CS_OUT_OF_MEMORY = 2,
    CS_OUT_OF_RANGE = 3,
    CS_INTERNAL_ERROR = 4,
    CS_QUEUE_FULL = 5,
    CS_AGAIN = 6,
    CS_INVALID_STATE = 7
};

typedef uint32_t cs_iq_format;
enum { CS_IQ_CU8 = 1, CS_IQ_CS16 = 2, CS_IQ_CF32 = 3 };
typedef uint32_t cs_trace_kind;
enum { CS_TRACE_PHASE_ERROR = 1, CS_TRACE_RECOVERED_I = 2, CS_TRACE_RECOVERED_Q = 3 };

typedef struct cs_error {
    cs_status code;
    char message[256];
} cs_error;

typedef struct cs_fgb_frequency_band {
    double offset_hz;
    double deviation_hz;
} cs_fgb_frequency_band;

typedef struct cs_config {
    uint32_t struct_size;
    uint32_t abi_version;
    uint32_t fgb;
    uint32_t sgb;
    uint32_t normal_prn;
    uint32_t test_prn;
    float fgb_alpha;
    float fgb_beta;
    float fgb_zeta;
    float fgb_over_peak_db;
    float fgb_average;
    int32_t fgb_runtime_ms;
    int32_t fgb_max_errors;
    uint32_t show_bch_failures;
    float sgb_detection_threshold;
    uint32_t quality_check;
    int32_t search_depth;
    int32_t prn_alignment;
    float sgb_filter;
    float sgb_phase_gain;
    float sgb_frequency_gain;
    int32_t sgb_max_errors;
    float sgb_feedback; /* ABI v1 tail extension; older configurations use the native default. */
    int32_t fgb_header_errors; /* ABI v1 tail extension, 0..3; older configurations use 2. */
    int32_t fgb_bch2_max_errors; /* ABI v1 tail extension, 0..2; older configurations use 2. */
    uint32_t show_fgb_bch_failures; /* ABI v1 tail extension; older configurations use 0. */
    uint32_t fgb_normal; /* ABI v1 tail extension; older configurations enable both FGB modes. */
    uint32_t fgb_self_test;
    int32_t fgb_max_candidates; /* ABI v2 tail extension, 1..10; older configurations use 5. */
    uint32_t fgb_excluded_band_count; /* ABI v2 tail extension, 0..6; older configurations exclude no bands. */
    cs_fgb_frequency_band fgb_excluded_bands[6];
} cs_config;

typedef struct cs_bch_status {
    uint32_t valid;
    int32_t corrected_errors; /* -1 when invalid; raw bits are preserved. */
} cs_bch_status;

typedef struct cs_frame {
    uint32_t generation;
    uint32_t self_test;
    uint32_t bit_count;
    uint32_t bch_count;
    double time_seconds;
    double frequency_offset_hz;
    float detection_level;
    char raw_hex[64];
    char corrected_hex[64];
    cs_bch_status bch[2];
    int32_t header_errors; /* ABI v1 tail extension: FGB 24-bit header Hamming distance, 0 for SGB. */
    int32_t fgb_bit_start_sample; /* ABI v1 tail extension: first bit in the FGB phase trace. */
} cs_frame;

typedef struct cs_fgb_trial {
    double time_seconds;
    double frequency_hz;
    int32_t votes;
    int32_t offset;
} cs_fgb_trial;

typedef struct cs_diagnostics {
    size_t frame_count;
    char tables_sha256[65];
    float fgb_max_peak_db;
    uint64_t fgb_candidates;
    int32_t fgb_max_sync_votes;
    float sgb_max_detection_level;
    uint64_t sgb_candidates;
    uint64_t sgb_quality_rejections;
    uint64_t sgb_bch_rejections;
    uint32_t fgb_trial_count;
    cs_fgb_trial fgb_trials[128];
} cs_diagnostics;

typedef struct cs_result cs_result;
typedef struct cs_stream cs_stream;
typedef struct cs_worker cs_worker;

typedef struct cs_fgb_channel {
    uint32_t active;
    double frequency_offset_hz;
    float level_dbfs;
} cs_fgb_channel;

typedef struct cs_acquisition {
    cs_fgb_channel fgb_channels[CS_FGB_CHANNEL_COUNT];
    float fgb_above_noise_db[CS_FGB_CHANNEL_COUNT];
} cs_acquisition;

enum {
    CS_WORKER_RUNNING = 1, CS_WORKER_DRAINING = 2, CS_WORKER_FINISHED = 3,
    CS_WORKER_FAILED = 4, CS_WORKER_STOPPED = 5
};
enum {
    CS_EVENT_FRAMES = 1, CS_EVENT_DISCONTINUITY = 2,
    CS_EVENT_FINISHED = 3, CS_EVENT_ERROR = 4
};

typedef struct cs_worker_event {
    uint32_t kind;
    uint64_t expected_sample_index;
    uint64_t actual_sample_index;
    cs_error error;
    cs_result* result;
} cs_worker_event;

typedef struct cs_worker_stats {
    uint32_t state;
    uint64_t accepted_blocks;
    uint64_t processed_blocks;
    uint64_t queue_full_count;
    uint64_t discontinuities;
    uint64_t missing_samples;
} cs_worker_stats;

CS_API uint32_t CS_CALL cs_abi_version(void);
CS_API cs_status CS_CALL cs_config_init(cs_config* config, size_t config_size, cs_error* error);

/* Synchronous batch decode. Scalars are interleaved I,Q in native byte order.
   Input is borrowed only during this call; byte_count is bytes, not complex samples.
   Calls must be serialized by the caller (FFTW planning is not thread-safe).
   No DC removal or noise preroll is applied here. */
CS_API cs_status CS_CALL cs_decode_iq(
    const cs_config* config, cs_iq_format format, uint32_t sample_rate_hz,
    const void* iq_interleaved, size_t byte_count, cs_result** output, cs_error* error);

CS_API cs_status CS_CALL cs_result_get_diagnostics(
    const cs_result* result, cs_diagnostics* output, size_t output_size, cs_error* error);
CS_API cs_status CS_CALL cs_result_get_acquisition(
    const cs_result* result, cs_acquisition* output, size_t output_size, cs_error* error);
CS_API cs_status CS_CALL cs_result_get_frame(
    const cs_result* result, size_t index, cs_frame* output, size_t output_size, cs_error* error);

/* Trace is immutable and borrowed until cs_result_destroy. Empty traces return NULL,0.
   Error is optional for status-returning calls; when provided, success clears it. */
CS_API cs_status CS_CALL cs_result_get_trace(
    const cs_result* result, size_t index, cs_trace_kind kind,
    const float** samples, size_t* count, cs_error* error);

/* NULL is accepted. Destruction must not race with any reader of this result. */
CS_API void CS_CALL cs_result_destroy(cs_result* result);

/* Incremental worker API. Input scratch space is reserved at creation.
   All operations on a stream must be serialized. Results use the batch ownership rules.
   Each result contains only new frames; diagnostics are cumulative since reset.
   Cross-call frame delivery order is not globally chronological.
   first_sample_index must equal the end of the last accepted input (initially zero).
   Indices count complex samples, not bytes.
   On a gap, reset explicitly; partial bursts and DSP history are discarded.
   Processing errors require reset. finish drains the tail and forbids further pushes
   until reset. Destroying a stream does not invalidate previously returned results. */
CS_API cs_status CS_CALL cs_stream_create(
    const cs_config* config, uint32_t sample_rate_hz, size_t max_block_samples,
    cs_stream** output, cs_error* error);
/* Additive ABI v1 entry point. Legacy creators use zero mixing.
   mixer_hz must be finite and strictly inside +/-230400 Hz. Positive shifts down.
   Mixing is after the first RTL frontend FIR (460800 Hz), before the second FIR.
   Phase follows 3200-sample blocks and is cleared by stream reset. */
CS_API cs_status CS_CALL cs_stream_create_with_mixer(
    const cs_config* config, uint32_t sample_rate_hz, size_t max_block_samples, float mixer_hz,
    cs_stream** output, cs_error* error);
CS_API cs_status CS_CALL cs_stream_push(
    cs_stream* stream, uint64_t first_sample_index, cs_iq_format format,
    const void* iq_interleaved, size_t byte_count, cs_result** output, cs_error* error);
CS_API cs_status CS_CALL cs_stream_finish(cs_stream* stream, cs_result** output, cs_error* error);
CS_API cs_status CS_CALL cs_stream_reset(cs_stream* stream, uint64_t next_sample_index, cs_error* error);
/* NULL is accepted. */
CS_API void CS_CALL cs_stream_destroy(cs_stream* stream);

/* One producer (submit/finish), one consumer (poll). Payload is copied into reserved
   slots; submit never waits for DSP/UI and performs no explicit allocation.
   CS_QUEUE_FULL rejects the whole block without consuming its index. Retry outside
   an acquisition callback, or advance the next index to report the resulting gap.
   Overlaps are rejected. Gaps produce a DISCONTINUITY event and reset DSP history.
   CF32 NaN/Inf is checked asynchronously by DSP and produces an ERROR event.
   Output saturation pauses DSP, never drops events; input can then fill up.
   Finish is idempotent, drains accepted input and emits FINISHED with final diagnostics.
   Poll returns CS_AGAIN when empty; successful poll transfers result ownership.
   Stop cancels pending work and joins. Stop producer before stop/destroy; control
   calls must be serialized. Destroy joins and frees unpolled results; polled results
   remain owned by caller. Creation/destruction obey FFTW planner serialization. */
CS_API cs_status CS_CALL cs_worker_create(
    const cs_config* config, uint32_t sample_rate_hz, size_t max_block_samples,
    size_t input_queue_blocks, size_t output_queue_events, cs_worker** output, cs_error* error);
CS_API cs_status CS_CALL cs_worker_create_with_mixer(
    const cs_config* config, uint32_t sample_rate_hz, size_t max_block_samples,
    size_t input_queue_blocks, size_t output_queue_events, float mixer_hz,
    cs_worker** output, cs_error* error);
CS_API cs_status CS_CALL cs_worker_submit(
    cs_worker* worker, uint64_t first_sample_index, cs_iq_format format,
    const void* iq_interleaved, size_t byte_count, cs_error* error);
CS_API cs_status CS_CALL cs_worker_finish(cs_worker* worker, cs_error* error);
CS_API cs_status CS_CALL cs_worker_poll(
    cs_worker* worker, cs_worker_event* output, size_t output_size, cs_error* error);
/* Offline producer only: blocks until input space, an event, or terminal state.
   Never call from acquisition callbacks. After finish, waits for events/termination.
   Readiness is a hint; retry submit/poll and handle their returned status. */
CS_API cs_status CS_CALL cs_worker_wait_ready(cs_worker* worker, cs_error* error);
/* Stats are individually atomic counters, not a transactional snapshot. */
CS_API cs_status CS_CALL cs_worker_get_stats(
    const cs_worker* worker, cs_worker_stats* output, size_t output_size, cs_error* error);
/* Nonblocking snapshot of the last completed DSP block, including blocks without
   frames. CS_AGAIN leaves output untouched; retry on the next telemetry tick. */
CS_API cs_status CS_CALL cs_worker_get_diagnostics(
    cs_worker* worker, cs_diagnostics* output, size_t output_size, cs_error* error);
/* Same nonblocking snapshot contract as cs_worker_get_diagnostics. */
CS_API cs_status CS_CALL cs_worker_get_acquisition(
    cs_worker* worker, cs_acquisition* output, size_t output_size, cs_error* error);
CS_API cs_status CS_CALL cs_worker_stop(cs_worker* worker, cs_error* error);
CS_API void CS_CALL cs_worker_destroy(cs_worker* worker);

#ifdef __cplusplus
}
#endif

#endif
