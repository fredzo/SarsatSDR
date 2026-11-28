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

cmake_minimum_required(VERSION 3.22)
project(sarsat_native LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
get_filename_component(ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(ENABLE_FLOAT ON CACHE BOOL "" FORCE)
set(DISABLE_FORTRAN ON CACHE BOOL "" FORCE)
if(ANDROID_ABI STREQUAL "x86_64")
  set(ENABLE_SSE2 ON CACHE BOOL "" FORCE)
endif()
add_subdirectory("${ROOT}/native/third_party/fftw-3.3.10" fftw EXCLUDE_FROM_ALL)
set_target_properties(fftw3f PROPERTIES POSITION_INDEPENDENT_CODE ON)
set(FFTW_INCLUDE "${ROOT}/native/third_party/fftw-3.3.10/api")

set(LIBUSB "${ROOT}/native/third_party/libusb-1.0.30")
add_library(usb-1.0 STATIC
  ${LIBUSB}/libusb/core.c ${LIBUSB}/libusb/descriptor.c ${LIBUSB}/libusb/hotplug.c ${LIBUSB}/libusb/io.c
  ${LIBUSB}/libusb/sync.c ${LIBUSB}/libusb/strerror.c ${LIBUSB}/libusb/os/linux_usbfs.c
  ${LIBUSB}/libusb/os/events_posix.c ${LIBUSB}/libusb/os/threads_posix.c ${LIBUSB}/libusb/os/linux_netlink.c)
target_include_directories(usb-1.0 PRIVATE ${LIBUSB}/android ${LIBUSB}/libusb/os PUBLIC ${LIBUSB}/libusb)
target_compile_options(usb-1.0 PRIVATE -fvisibility=hidden -pthread)
set_target_properties(usb-1.0 PROPERTIES POSITION_INDEPENDENT_CODE ON)

add_library(sarsat-native SHARED
  sarsat_jni.cpp
  "${ROOT}/native/cospas-core/decoder.cpp"
  "${ROOT}/native/cospas-core/c_api.cpp"
  "${ROOT}/native/sources/rtl_control.cpp" "${ROOT}/native/sources/rtl_usb.cpp"
  "${ROOT}/native/sources/r820_tuner.cpp" "${ROOT}/native/sources/rtl2832.cpp"
  "${ROOT}/native/sources/rtl_iq_capture.cpp" "${ROOT}/native/sources/wav.cpp"
  "${ROOT}/native/sources/iq_recording.cpp"
  "${ROOT}/native/cospas-cli/main.cpp" "${ROOT}/native/cospas-cli/beacon.cpp"
  "${ROOT}/native/cospas-cli/telemetry.cpp"
  "${ROOT}/native/cospas-core/dsp_tables.hpp")
target_include_directories(sarsat-native PRIVATE "${ROOT}/native/cospas-core/include" "${ROOT}/native/cospas-core"
  "${ROOT}/native/sources" "${ROOT}/native/cospas-cli" "${FFTW_INCLUDE}")
target_compile_definitions(sarsat-native PRIVATE COSPAS_CLI_EMBEDDED COSPAS_C_API_BUILD)
target_compile_options(sarsat-native PRIVATE -O2)
target_link_libraries(sarsat-native PRIVATE fftw3f usb-1.0 log)
target_link_options(sarsat-native PRIVATE "-Wl,-z,max-page-size=16384")
