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

#include "telemetry.hpp"
#include "dsp_tables.hpp"
#include "iq_recording.hpp"

#include <jni.h>

#include <iostream>
#include <mutex>
#include <streambuf>
#include <string>
#include <vector>
#include <unistd.h>

int cospas_cli_run(int argc, char** argv);

namespace {
JavaVM* vm = nullptr;
std::mutex run_mutex;

class LineBuffer final : public std::streambuf {
public:
    LineBuffer(jobject sink, jmethodID method, int stream) : sink_(sink), method_(method), stream_(stream) {}
    ~LineBuffer() override { flush_line(); }
protected:
    int_type overflow(int_type c) override {
        if (c == traits_type::eof()) return traits_type::not_eof(c);
        std::lock_guard lock(mutex_);
        if (c == '\n') flush_locked();
        else line_.push_back(char(c));
        return c;
    }
    std::streamsize xsputn(const char* data, std::streamsize count) override {
        std::lock_guard lock(mutex_);
        for (std::streamsize n = 0; n < count; ++n) {
            if (data[n] == '\n') flush_locked();
            else line_.push_back(data[n]);
        }
        return count;
    }
private:
    void flush_line() { std::lock_guard lock(mutex_); if (!line_.empty()) flush_locked(); }
    void flush_locked() {
        JNIEnv* env = nullptr;
        bool attached = false;
        if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
            vm->AttachCurrentThread(&env, nullptr);
            attached = true;
        }
        const auto bytes = env->NewByteArray(jsize(line_.size()));
        env->SetByteArrayRegion(bytes, 0, jsize(line_.size()), reinterpret_cast<const jbyte*>(line_.data()));
        env->CallVoidMethod(sink_, method_, jint(stream_), bytes);
        if (env->ExceptionCheck()) env->ExceptionClear();
        env->DeleteLocalRef(bytes);
        if (attached) vm->DetachCurrentThread();
        line_.clear();
    }
    jobject sink_;
    jmethodID method_;
    int stream_;
    std::mutex mutex_;
    std::string line_;
};
}

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM* loaded, void*) {
    vm = loaded;
    return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_sarsatnative_NativeEngine_run(JNIEnv* env, jobject, jobjectArray arguments, jobject sink) {
    std::lock_guard lock(run_mutex);
    cospas::cli::set_stop_requested(false);
    std::vector<std::string> values{"cospas-cli"};
    for (jsize n = 0; n < env->GetArrayLength(arguments); ++n) {
        auto text = static_cast<jstring>(env->GetObjectArrayElement(arguments, n));
        const char* chars = env->GetStringUTFChars(text, nullptr);
        values.emplace_back(chars);
        env->ReleaseStringUTFChars(text, chars);
        env->DeleteLocalRef(text);
    }
    std::vector<char*> argv;
    for (auto& value : values) argv.push_back(value.data());
    const auto global = env->NewGlobalRef(sink);
    const auto method = env->GetMethodID(env->GetObjectClass(sink), "onLine", "(I[B)V");
    int code = 1;
    {
        LineBuffer out(global, method, 1), err(global, method, 2);
        auto* old_out = std::cout.rdbuf(&out);
        auto* old_err = std::cerr.rdbuf(&err);
        code = cospas_cli_run(int(argv.size()), argv.data());
        if (values.size() > 1 && values[1] == "receive") {
            try { cospas::iq_recorder().finish_session(); }
            catch (const std::exception& error) {
                std::cerr << "I/Q recording: " << error.what() << '\n';
                code = 1;
            }
        }
        std::cout.flush();
        std::cerr.flush();
        std::cout.rdbuf(old_out);
        std::cerr.rdbuf(old_err);
    }
    env->DeleteGlobalRef(global);
    return code;
}

extern "C" JNIEXPORT void JNICALL Java_expo_modules_sarsatnative_NativeEngine_stop(JNIEnv*, jobject) {
    cospas::cli::set_stop_requested(true);
}

extern "C" JNIEXPORT jintArray JNICALL Java_expo_modules_sarsatnative_NativeEngine_supportedIds(JNIEnv* env, jobject) {
    std::vector<jint> ids;
    for (const auto& id : cospas::dsp_tables::rtl_usb_ids) ids.push_back(jint(id[0] << 16 | id[1]));
    const auto result = env->NewIntArray(jsize(ids.size()));
    env->SetIntArrayRegion(result, 0, jsize(ids.size()), ids.data());
    return result;
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_sarsatnative_NativeEngine_startRecording(JNIEnv* env, jobject, jint descriptor) {
    try {
        const int copied = dup(descriptor);
        if (copied < 0) throw std::runtime_error("Could not duplicate I/Q recording descriptor");
        auto* file = fdopen(copied, "w+b");
        if (!file) {
            close(copied);
            throw std::runtime_error("Could not open I/Q WAV output");
        }
        cospas::iq_recorder().start(file);
    } catch (const std::exception& error) {
        env->ThrowNew(env->FindClass("java/io/IOException"), error.what());
    }
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_sarsatnative_NativeEngine_stopRecording(JNIEnv* env, jobject) {
    try { cospas::iq_recorder().stop(); }
    catch (const std::exception& error) {
        env->ThrowNew(env->FindClass("java/io/IOException"), error.what());
    }
}
