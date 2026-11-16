#include <cospas/c_api.h>

#include <math.h>
#include <stdio.h>
#include <string.h>

#define CHECK(condition) do { \
    if (!(condition)) { fprintf(stderr, "Line %d: %s\n", __LINE__, #condition); return 1; } \
} while (0)

int main(void) {
    cs_config config;
    cs_error error;
    cs_result* result = NULL;
    cs_diagnostics diagnostics;
    cs_frame frame;
    const uint8_t u8[] = {0, 255, 128, 127};
    const int16_t s16[] = {-32768, 32767, 0, -1};
    const float f32[] = {-1, 1, 0, 0.5f};
    const float invalid[] = {0, NAN};
    const void* buffers[] = {u8, s16, f32};
    const size_t sizes[] = {sizeof(u8), sizeof(s16), sizeof(f32)};
    const cs_iq_format formats[] = {CS_IQ_CU8, CS_IQ_CS16, CS_IQ_CF32};
    size_t n;

    CHECK(cs_abi_version() == CS_ABI_VERSION);
    CHECK(cs_config_init(&config, sizeof(config) - 1, &error) == CS_INVALID_ARGUMENT);
    CHECK(error.code == CS_INVALID_ARGUMENT && error.message[0]);
    CHECK(cs_config_init(&config, sizeof(config), &error) == CS_OK);
    CHECK(error.code == CS_OK && !error.message[0]);
    {
        const size_t legacy_size = offsetof(cs_config, sgb_feedback);
        config.sgb_feedback = NAN;
        CHECK(cs_config_init(&config, legacy_size, &error) == CS_OK);
        CHECK(config.struct_size == legacy_size && isnan(config.sgb_feedback));
        CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 0, &result, &error) == CS_OK);
        cs_result_destroy(result);
        result = NULL;
        CHECK(cs_config_init(&config, sizeof(config), &error) == CS_OK);
        config.sgb_feedback = -1;
        CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 0, &result, &error) == CS_INVALID_ARGUMENT);
        CHECK(result == NULL && error.message[0]);
        CHECK(cs_config_init(&config, sizeof(config), &error) == CS_OK);
        CHECK(config.fgb_header_errors == 2);
        CHECK(config.fgb_max_errors == 3 && config.fgb_bch2_max_errors == 2);
        config.fgb_bch2_max_errors = 3;
        CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 0, &result, &error) == CS_INVALID_ARGUMENT);
        config.struct_size = (uint32_t)offsetof(cs_config, fgb_bch2_max_errors);
        CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 0, &result, &error) == CS_OK);
        cs_result_destroy(result);
        result = NULL;
        config.struct_size = (uint32_t)sizeof(config);
        config.fgb_bch2_max_errors = 2;
        config.fgb_header_errors = 4;
        CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 0, &result, &error) == CS_INVALID_ARGUMENT);
        config.struct_size = (uint32_t)offsetof(cs_config, fgb_header_errors);
        CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 0, &result, &error) == CS_OK);
        cs_result_destroy(result);
        result = NULL;
        CHECK(cs_config_init(&config, sizeof(config), &error) == CS_OK);
    }
    config.sgb = 0;
    for (n = 0; n < 3; ++n) {
        CHECK(cs_decode_iq(&config, formats[n], 230400, buffers[n], sizes[n], &result, &error) == CS_OK);
        CHECK(result != NULL);
        CHECK(cs_result_get_diagnostics(result, &diagnostics, sizeof(diagnostics), &error) == CS_OK);
        CHECK(diagnostics.frame_count == 0 && strlen(diagnostics.tables_sha256) == 64);
        {
            cs_acquisition acquisition;
            size_t channel;
            CHECK(cs_result_get_acquisition(result, &acquisition, sizeof(acquisition) - 1, &error) == CS_INVALID_ARGUMENT);
            CHECK(cs_result_get_acquisition(result, NULL, sizeof(acquisition), &error) == CS_INVALID_ARGUMENT);
            CHECK(cs_result_get_acquisition(result, &acquisition, sizeof(acquisition), &error) == CS_OK);
            for (channel = 0; channel < 4; ++channel) CHECK(!acquisition.fgb_channels[channel].active);
        }
        CHECK(cs_result_get_frame(result, 0, &frame, sizeof(frame), &error) == CS_OUT_OF_RANGE);
        {
            const float* trace = f32;
            size_t count = 99;
            CHECK(cs_result_get_trace(result, 0, CS_TRACE_PHASE_ERROR, &trace, &count, &error) == CS_OUT_OF_RANGE);
            CHECK(trace == NULL && count == 0);
        }
        cs_result_destroy(result);
        result = NULL;
        CHECK(cs_decode_iq(&config, formats[n], 230400, buffers[n], sizes[n] - 1, &result, &error) == CS_INVALID_ARGUMENT);
        CHECK(result == NULL && error.message[0]);
    }

    CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, invalid, sizeof(invalid), &result, &error) == CS_INVALID_ARGUMENT);
    CHECK(strstr(error.message, "Non-finite") != NULL);
    CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 8, &result, &error) == CS_INVALID_ARGUMENT);
    CHECK(cs_decode_iq(&config, 99, 230400, NULL, 0, &result, &error) == CS_INVALID_ARGUMENT);
    CHECK(cs_decode_iq(&config, CS_IQ_CF32, 0, NULL, 0, &result, &error) == CS_INVALID_ARGUMENT);
    CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 0, NULL, &error) == CS_INVALID_ARGUMENT);
    CHECK(cs_decode_iq(NULL, CS_IQ_CF32, 230400, NULL, 0, &result, NULL) == CS_INVALID_ARGUMENT);

    CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 0, &result, &error) == CS_OK);
    {
        cs_result* output = result;
        ++config.abi_version;
        CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 0, &output, &error) == CS_INVALID_ARGUMENT);
        CHECK(output == NULL);
        --config.abi_version;
    }
    frame.generation = 99;
    CHECK(cs_result_get_frame(result, 0, &frame, sizeof(frame) - 1, &error) == CS_INVALID_ARGUMENT);
    CHECK(frame.generation == 99);
    CHECK(cs_result_get_frame(result, 0, &frame, offsetof(cs_frame, header_errors), &error) == CS_OUT_OF_RANGE);
    CHECK(cs_result_get_diagnostics(result, &diagnostics, sizeof(diagnostics) - 1, &error) == CS_INVALID_ARGUMENT);
    cs_result_destroy(result);
    result = NULL;
    config.fgb = 2;
    CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 0, &result, &error) == CS_INVALID_ARGUMENT);
    config.fgb = 1;
    config.sgb_phase_gain = NAN;
    CHECK(cs_decode_iq(&config, CS_IQ_CF32, 230400, NULL, 0, &result, &error) == CS_INVALID_ARGUMENT);
    CHECK(error.code == CS_INVALID_ARGUMENT && error.message[0]);
    cs_result_destroy(NULL);
    {
        cs_stream* stream = NULL;
        CHECK(cs_config_init(&config, sizeof(config), &error) == CS_OK);
        config.sgb = 0;
        CHECK(cs_stream_create(&config, 230400, 0, &stream, &error) == CS_INVALID_ARGUMENT);
        CHECK(stream == NULL);
        CHECK(cs_stream_create(&config, 230400, 2, &stream, &error) == CS_OK);
        CHECK(cs_stream_push(stream, 0, CS_IQ_CU8, u8, sizeof(u8), &result, &error) == CS_OK);
        cs_result_destroy(result);
        CHECK(cs_stream_push(stream, 7, CS_IQ_CU8, u8, sizeof(u8), &result, &error) == CS_INVALID_ARGUMENT);
        CHECK(result == NULL && strstr(error.message, "discontinuity") != NULL);
        CHECK(cs_stream_push(stream, 2, CS_IQ_CF32, invalid, sizeof(invalid), &result, &error) == CS_INVALID_ARGUMENT);
        CHECK(cs_stream_push(stream, 2, CS_IQ_CU8, f32, sizeof(f32), &result, &error) == CS_INVALID_ARGUMENT);
        CHECK(strstr(error.message, "capacity") != NULL);
        CHECK(cs_stream_push(stream, 2, CS_IQ_CS16, s16, sizeof(s16), &result, &error) == CS_OK);
        cs_result_destroy(result);
        CHECK(cs_stream_finish(stream, &result, &error) == CS_OK);
        cs_result_destroy(result);
        CHECK(cs_stream_push(stream, 4, CS_IQ_CU8, u8, sizeof(u8), &result, &error) == CS_INVALID_ARGUMENT);
        CHECK(result == NULL);
        CHECK(cs_stream_reset(stream, 123, &error) == CS_OK);
        CHECK(cs_stream_push(stream, 123, CS_IQ_CF32, f32, sizeof(f32), &result, &error) == CS_OK);
        cs_stream_destroy(stream);
        CHECK(cs_result_get_diagnostics(result, &diagnostics, sizeof(diagnostics), &error) == CS_OK);
        cs_result_destroy(result);
        CHECK(cs_stream_reset(NULL, 0, &error) == CS_INVALID_ARGUMENT);
        cs_stream_destroy(NULL);
    }
    {
        cs_stream* stream = NULL;
        cs_worker* worker = NULL;
        const float invalid_hz[] = {NAN, INFINITY, -INFINITY, 230400, -230400};
        for (n = 0; n < sizeof(invalid_hz) / sizeof(invalid_hz[0]); ++n) {
            CHECK(cs_stream_create_with_mixer(&config, 921600, 2, invalid_hz[n],
                                               &stream, &error) == CS_INVALID_ARGUMENT);
            CHECK(stream == NULL && error.message[0]);
            CHECK(cs_worker_create_with_mixer(&config, 921600, 2, 1, 1, invalid_hz[n],
                                               &worker, &error) == CS_INVALID_ARGUMENT);
            CHECK(worker == NULL && error.message[0]);
        }
        CHECK(cs_stream_create_with_mixer(&config, 921600, 2, 10000, NULL, &error) == CS_INVALID_ARGUMENT);
        CHECK(cs_worker_create_with_mixer(&config, 921600, 2, 1, 1, 10000, NULL, &error) == CS_INVALID_ARGUMENT);
        CHECK(cs_stream_create_with_mixer(&config, 921600, 2, -70000, &stream, &error) == CS_OK);
        CHECK(cs_stream_push(stream, 0, CS_IQ_CU8, u8, sizeof(u8), &result, &error) == CS_OK);
        cs_result_destroy(result);
        cs_stream_destroy(stream);
    }
    {
        cs_worker* worker = NULL;
        cs_worker_stats snapshot;
        cs_worker_event event;
        CHECK(cs_worker_create(&config, 230400, 2, 0, 1, &worker, &error) == CS_INVALID_ARGUMENT);
        CHECK(worker == NULL);
        CHECK(cs_worker_create(&config, 230400, 2, 1, 0, &worker, &error) == CS_INVALID_ARGUMENT);
        CHECK(cs_worker_create(&config, 230400, 2, 1, 1, &worker, &error) == CS_OK);
        CHECK(cs_worker_get_diagnostics(NULL, &diagnostics, sizeof(diagnostics), &error) == CS_INVALID_ARGUMENT);
        CHECK(cs_worker_get_diagnostics(worker, NULL, sizeof(diagnostics), &error) == CS_INVALID_ARGUMENT);
        CHECK(cs_worker_get_diagnostics(worker, &diagnostics, sizeof(diagnostics) - 1, &error) == CS_INVALID_ARGUMENT);
        CHECK(cs_worker_get_diagnostics(worker, &diagnostics, sizeof(diagnostics), &error) == CS_OK);
        {
            cs_acquisition acquisition;
            CHECK(cs_worker_get_acquisition(NULL, &acquisition, sizeof(acquisition), &error) == CS_INVALID_ARGUMENT);
            CHECK(cs_worker_get_acquisition(worker, &acquisition, sizeof(acquisition) - 1, &error) == CS_INVALID_ARGUMENT);
            CHECK(cs_worker_get_acquisition(worker, &acquisition, sizeof(acquisition), &error) == CS_OK);
            for (n = 0; n < 4; ++n) CHECK(!acquisition.fgb_channels[n].active);
        }
        CHECK(strlen(diagnostics.tables_sha256) == 64 && diagnostics.frame_count == 0);
        CHECK(cs_worker_poll(worker, &event, sizeof(event) - 1, &error) == CS_INVALID_ARGUMENT);
        CHECK(cs_worker_poll(worker, &event, sizeof(event), &error) == CS_AGAIN);
        CHECK(cs_worker_submit(worker, 0, CS_IQ_CU8, NULL, 2, &error) == CS_INVALID_ARGUMENT);
        CHECK(cs_worker_submit(worker, UINT64_MAX, CS_IQ_CU8, u8, sizeof(u8), &error) == CS_INVALID_ARGUMENT);
        CHECK(cs_worker_get_stats(worker, &snapshot, sizeof(snapshot), &error) == CS_OK);
        CHECK(snapshot.accepted_blocks == 0);
        CHECK(cs_worker_wait_ready(worker, &error) == CS_OK);
        CHECK(cs_worker_stop(worker, &error) == CS_OK);
        CHECK(cs_worker_stop(worker, &error) == CS_OK);
        CHECK(cs_worker_wait_ready(worker, &error) == CS_INVALID_STATE);
        CHECK(cs_worker_submit(worker, 0, CS_IQ_CU8, u8, sizeof(u8), &error) == CS_INVALID_STATE);
        cs_worker_destroy(worker);
        cs_worker_destroy(NULL);
    }
    puts("C ABI error, size, input format and ownership checks passed");
    return 0;
}
