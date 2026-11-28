# SarsatSDR
# Copyright (C) 2026 Frederic BORRY - F4JRX
# Authors: Frederic BORRY - F4JRX and Copilot (AI-assisted development).
# SPDX-License-Identifier: GPL-3.0-or-later
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

cmake_minimum_required(VERSION 3.24)
project(sarsat_sdr VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
include(CTest)
find_package(Python3 REQUIRED COMPONENTS Interpreter)
find_package(Threads REQUIRED)
find_path(FFTW_INCLUDE_DIR fftw3.h REQUIRED)
find_library(FFTW_LIBRARY NAMES fftw3f libfftw3f-3 REQUIRED)
find_path(LIBUSB_INCLUDE_DIR libusb.h PATH_SUFFIXES libusb-1.0 REQUIRED)
find_library(LIBUSB_LIBRARY NAMES usb-1.0 libusb-1.0 REQUIRED)

set(DSP_TABLES "${CMAKE_CURRENT_SOURCE_DIR}/native/cospas-core/dsp_tables.hpp")

add_library(cospas-core
  native/cospas-core/decoder.cpp
  "${DSP_TABLES}")
set_target_properties(cospas-core PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(cospas-core PUBLIC native/cospas-core/include
  PRIVATE native/cospas-core "${FFTW_INCLUDE_DIR}")
target_link_libraries(cospas-core PRIVATE "${FFTW_LIBRARY}")
if(MSVC)
  target_compile_options(cospas-core PRIVATE /W4 /permissive- /fp:precise)
else()
  target_compile_options(cospas-core PRIVATE -Wall -Wextra -Wpedantic -Wconversion)
endif()

add_library(cospas-rtl-control native/sources/rtl_control.cpp native/sources/rtl_usb.cpp
  native/sources/r820_tuner.cpp native/sources/rtl2832.cpp native/sources/rtl_iq_capture.cpp "${DSP_TABLES}")
target_include_directories(cospas-rtl-control PUBLIC native/sources
  PRIVATE native/cospas-core)
target_include_directories(cospas-rtl-control SYSTEM PRIVATE "${LIBUSB_INCLUDE_DIR}")
target_link_libraries(cospas-rtl-control PRIVATE "${LIBUSB_LIBRARY}" Threads::Threads)
if(MSVC)
  target_compile_options(cospas-rtl-control PRIVATE /W4 /permissive-)
else()
  target_compile_options(cospas-rtl-control PRIVATE -Wall -Wextra -Wpedantic -Wconversion)
endif()

add_library(cospas-c-api SHARED native/cospas-core/c_api.cpp)
target_link_libraries(cospas-c-api PRIVATE cospas-core Threads::Threads)
target_include_directories(cospas-c-api PUBLIC native/cospas-core/include)
target_compile_definitions(cospas-c-api PRIVATE COSPAS_C_API_BUILD)
if(WIN32)
  set_target_properties(cospas-c-api PROPERTIES PREFIX "")
endif()
if(MSVC)
  target_compile_options(cospas-c-api PRIVATE /W4 /permissive- /fp:precise)
else()
  target_compile_options(cospas-c-api PRIVATE -Wall -Wextra -Wpedantic -Wconversion)
endif()

add_executable(cospas-cli native/cospas-cli/main.cpp native/cospas-cli/beacon.cpp native/cospas-cli/telemetry.cpp
  native/sources/iq_recording.cpp
  native/sources/wav.cpp)
target_link_libraries(cospas-cli PRIVATE cospas-c-api cospas-rtl-control "${FFTW_LIBRARY}")
target_include_directories(cospas-cli PRIVATE native/sources)
target_include_directories(cospas-cli PRIVATE native/cospas-core)
target_include_directories(cospas-cli SYSTEM PRIVATE "${LIBUSB_INCLUDE_DIR}")
target_include_directories(cospas-cli SYSTEM PRIVATE "${FFTW_INCLUDE_DIR}")

if(BUILD_TESTING)
  add_executable(iq-recording-tests native/tests/iq_recording_tests.cpp native/sources/iq_recording.cpp native/sources/wav.cpp)
  target_include_directories(iq-recording-tests PRIVATE native/sources native/cospas-core/include)
  target_link_libraries(iq-recording-tests PRIVATE Threads::Threads)
  add_test(NAME iq-wav-recording COMMAND iq-recording-tests "${CMAKE_CURRENT_BINARY_DIR}/test-iq-recording.wav")
  add_executable(telemetry-tests native/tests/telemetry_tests.cpp native/cospas-cli/telemetry.cpp "${DSP_TABLES}")
  target_include_directories(telemetry-tests PRIVATE native/cospas-core native/cospas-core/include)
  target_include_directories(telemetry-tests SYSTEM PRIVATE "${FFTW_INCLUDE_DIR}")
  target_link_libraries(telemetry-tests PRIVATE "${FFTW_LIBRARY}")
  add_test(NAME ui-native-spectrum COMMAND telemetry-tests)
  add_executable(rtl-control-tests native/tests/rtl_control_tests.cpp)
  target_include_directories(rtl-control-tests SYSTEM PRIVATE "${LIBUSB_INCLUDE_DIR}")
  target_link_libraries(rtl-control-tests PRIVATE cospas-rtl-control)
  add_test(NAME rtl-register-control COMMAND rtl-control-tests)
  set_tests_properties(rtl-register-control PROPERTIES LABELS "rtl" TIMEOUT 30)
  add_executable(rtl-usb-stream-tests native/tests/rtl_usb_stream_tests.cpp)
  target_include_directories(rtl-usb-stream-tests SYSTEM PRIVATE "${LIBUSB_INCLUDE_DIR}")
  target_link_libraries(rtl-usb-stream-tests PRIVATE cospas-rtl-control)
  add_test(NAME rtl-asynchronous-usb COMMAND rtl-usb-stream-tests)
  set_tests_properties(rtl-asynchronous-usb PROPERTIES LABELS "rtl" TIMEOUT 10)
  # Link ABI source directly so the test can reject allocations on the producer thread.
  add_executable(worker-tests native/tests/worker_tests.cpp native/cospas-core/c_api.cpp native/sources/wav.cpp)
  target_include_directories(worker-tests PRIVATE native/sources)
  target_compile_definitions(worker-tests PRIVATE COSPAS_C_API_BUILD)
  target_link_libraries(worker-tests PRIVATE cospas-core Threads::Threads)
  add_test(NAME worker-backpressure COMMAND worker-tests "${CMAKE_CURRENT_SOURCE_DIR}/samples/sgb.wav"
    "${CMAKE_CURRENT_SOURCE_DIR}/samples/fgb.wav")
  set_tests_properties(worker-backpressure PROPERTIES LABELS "worker" TIMEOUT 60)
  add_executable(stream-tests native/tests/stream_tests.cpp native/sources/wav.cpp)
  target_include_directories(stream-tests PRIVATE native/sources)
  target_link_libraries(stream-tests PRIVATE cospas-core)
  add_test(NAME stream-chunk-equivalence COMMAND stream-tests "${CMAKE_CURRENT_SOURCE_DIR}/samples/sgb.wav")
  set_tests_properties(stream-chunk-equivalence PROPERTIES LABELS "stream" TIMEOUT 60)
  add_executable(c-api-tests native/tests/c_api_tests.c)
  set_target_properties(c-api-tests PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED ON C_EXTENSIONS OFF)
  target_link_libraries(c-api-tests PRIVATE cospas-c-api)
  add_test(NAME c-api-contract COMMAND c-api-tests)
  add_executable(c-api-integration-tests native/tests/c_api_integration_tests.cpp native/sources/wav.cpp)
  target_include_directories(c-api-integration-tests PRIVATE native/sources)
  target_link_libraries(c-api-integration-tests PRIVATE cospas-c-api cospas-core)
  add_test(NAME c-api-sgb-formats COMMAND c-api-integration-tests "${CMAKE_CURRENT_SOURCE_DIR}/samples/sgb.wav")
  set_tests_properties(c-api-sgb-formats PROPERTIES TIMEOUT 60)
  add_executable(decoder-tests native/tests/decoder_tests.cpp)
  target_include_directories(decoder-tests PRIVATE native/cospas-core)
  target_link_libraries(decoder-tests PRIVATE cospas-core)
  add_test(NAME decoder-primitives COMMAND decoder-tests)
  add_executable(beacon-tests native/tests/beacon_tests.cpp native/cospas-cli/beacon.cpp)
  target_include_directories(beacon-tests PRIVATE native/cospas-cli)
  add_test(NAME beacon-fields COMMAND beacon-tests)
  add_test(NAME cli-invalid-options
    COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/native/tests/sample_regression.py"
            --cli "$<TARGET_FILE:cospas-cli>")
  add_test(NAME cli-rtl-discovery
    COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/native/tests/sample_regression.py"
            --cli "$<TARGET_FILE:cospas-cli>" --devices)
  set_tests_properties(cli-rtl-discovery PROPERTIES LABELS "rtl" TIMEOUT 40)
  foreach(sample IN ITEMS fgb fgb-cnes fgb-cnes-boost sgb sgb-cnes sgb-cnes-boost
                          sgb-self-test cnes-short-1 cnes-long-1)
    add_test(NAME "sample-${sample}"
      COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/native/tests/sample_regression.py"
              --cli "$<TARGET_FILE:cospas-cli>"
              --sample "${CMAKE_CURRENT_SOURCE_DIR}/samples/${sample}.wav")
    set_tests_properties("sample-${sample}" PROPERTIES LABELS "samples" TIMEOUT 200)
    add_test(NAME "stream-sample-${sample}"
      COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/native/tests/sample_regression.py"
              --cli "$<TARGET_FILE:cospas-cli>" --block-samples 4093
              --sample "${CMAKE_CURRENT_SOURCE_DIR}/samples/${sample}.wav")
    set_tests_properties("stream-sample-${sample}" PROPERTIES LABELS "samples;stream" TIMEOUT 200)
    add_test(NAME "worker-sample-${sample}"
      COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/native/tests/sample_regression.py"
              --cli "$<TARGET_FILE:cospas-cli>" --block-samples 4093 --worker-queue 2
              --sample "${CMAKE_CURRENT_SOURCE_DIR}/samples/${sample}.wav")
    set_tests_properties("worker-sample-${sample}" PROPERTIES LABELS "samples;worker" TIMEOUT 200)
  endforeach()
endif()
