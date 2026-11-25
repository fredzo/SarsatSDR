# 🛠️ SarsatSDR

`sarsat-sdr` receives and decodes first-generation (FGB) and second-generation
(SGB) COSPAS-SARSAT 406 MHz beacons.

A shared C++20 engine for Windows and Android, a React Native / Web interface,
RTL-SDR USB acquisition, and WAV I/Q capture playback. The engine also runs
from the command line without a graphical interface.

## ✨ Features

- RTL-SDR reception at 921600 complex samples/s, supporting R820T/R820T2/R828D and
  RTL-SDR Blog V4, FE_AGC, and twelve gain presets. Bias-T is disabled.
- Asynchronous libusb acquisition, a DSP worker, and bounded queues; disconnects,
  overflows, and discontinuities are reported explicitly. If the DSP queue is
  full, the block is retained and resubmitted. On a fatal overflow,
  the interface keeps the error visible and restarts RTL-SDR acquisition.
- FGB/SGB decoding, raw and corrected words, beacon identification and position,
  frequency, timestamps, acquisition diagnostics, and phase/I/Q traces.
  Independent FGB Normal / Self Test selection in the native engine
  (`--fgb-normal-only` / `--fgb-self-test-only`), matching the SGB PRN options.
  With no mode selected, detection for that generation is disabled; both
  generations can be disabled while keeping the spectrum and waterfall.
- BCH correction capacity: 3 bits for FGB BCH-1, 2 bits for BCH-2, and 6 bits for SGB.
  Configurable rejection limits, with corrections and header mismatches displayed.
  Short and orbitography FGB frames do not produce a BCH-2 status.
- English interface with bottom navigation: Detection, Frames, Map, Detail, Signal,
  Receiver, Player, and Settings. On Android, the RTL-SDR device list
  refreshes automatically when a device is connected or disconnected.
  Arrows around `Frames (x/y)` browse
  visible frames; each new unfiltered reception becomes the active selection.
  Detail sends the selected frame to the external COSPAS-SARSAT decoder
  when the tab is displayed; Share offers copying and sharing of corrected
  hexadecimal data or the URL.
- Detection: a fixed four-pane dashboard (spectrum/waterfall,
  frame list, essential details, and map), designed for landscape tablets.
  FGB details include Data, the corrected hexadecimal frame.
  Frames: a table on the left and full details on the right, with independent
  scrolling when needed. Map: a map without
  page scrolling, with zoom and pan gestures.
- Center frequency adjustable from 100 to 999 MHz (406.050 MHz by default).
  Spectrum covering 100 kHz around the center, 1024 bins, 10 spectra/s; cyan trace,
  red fill for strong peaks, a fixed vertical scale from -150 to -110 dB
  with clipping above it, fast attack, and peak decay to the noise floor in about three seconds. GPU
  waterfall with a black background and gradients interpolated in frequency and time;
  FGB candidates remain marked.
- Animated scrolling from 0.25x to 4x, default 1x: visible history from 28 to
  1.75 seconds, seven seconds by default. Texture and position are synchronized
  in a single Skia render on Android to prevent backward jumps.
- Persisted daily sessions with the latest 200 frames per acquisition day,
  detailed fields, JSON file export, an OpenStreetMap map,
  and Google Maps / Waze links. The map requires Internet access.
- FGB FM audio for RTL-SDR and WAV (Android and Web), enabled by default with
  a default volume of 50%, independent of notifications. The strongest FGB candidate
  opens audio only after an unmodulated carrier at the start of the frame
  is confirmed, then keeps listening until it disappears, without waiting for BCH. FM audio
  is muted during the first 2 seconds of each RTL-SDR acquisition.
- Distinct MP3 notifications for BCH OK, KO, and filtered frames. On Android,
  each sound is preloaded and played once at an inaudible volume on startup;
  the shared volume
  is adjustable. BCH KO and `Filter system frames` (FGB ORB / SGB SYSTM) display filters
  are reversible without losing stored frames or excluding them from exports.
- Acquisition spinner and a default 50 s FGB countdown, restarted by each
  unfiltered FGB frame. Low beeps at 5/4/3/2 s, then a high beep at 1 s, with optional auto-reload;
  a modulo-1000 count-up timer runs at startup and after expiry without auto-reload.
  Long press: reset to count-up mode until the next unfiltered FGB frame,
  with a double beep, without changing the auto-reload setting. Sounds, countdown, and beeps are enabled by default,
  filters are enabled, and auto-reload is disabled. Settings groups Filtering, Audio, and RTL-SDR,
  with confirmation before restoring defaults for each group and for Receiver.
  Settings fields remain visible above the keyboard.
  All settings (decoders, USB, display, player, and reception) are stored
  on the device and restored on the next launch, except for the USB device selection:
  the connected device is selected at startup.
- Real-time playback of the nine bundled captures; opening user WAV files
  on Android. Stereo I/Q PCM in 8-bit, 16-bit, and 32-bit floating-point formats.

## 🗂️ Project layout

- `native/cospas-core`: portable engine, embedded DSP tables, and C API.
- `native/sources`: WAV, RTL2832, R820 tuner, and USB transport.
- `native/cospas-cli`: headless executable and JSONL events.
- `native/android`: Android build and JNI adapter.
- `apps/mobile`: Expo / React Native application and shared Web interface.
- `apps/diagnostic-web`: local HTTP/WebSocket server and UI tests, without a separate frontend.
- `packages/shared`: protocol, playback profiles, and display.
- `samples`: regression captures, documented expectations, and JSON profiles.
- `spec`: FGB/SGB specifications.


## 🧰 Installing prerequisites on Windows

This procedure starts from a clean Windows 10/11 x64 machine. Use **MSYS2 UCRT64** to build the Windows engine and **Windows Command Prompt (`cmd.exe`)** for Node.js, Android, and ADB. Clone the repository into a short path without accented characters, such as `C:\src\sarsat-sdr`.

For the PC version, follow steps 1 through 3 and, for RTL-SDR reception,
step 6. Steps 4 and 5 are only needed to build the Android APK;
installing an existing APK only requires Platform-Tools for ADB deployment.

### 🔀 1. Git and long paths

Install [Git for Windows](https://git-scm.com/download/win), then check in `cmd.exe`:

```bat
git --version
```

Enable long paths in a **Command Prompt running as administrator**, then restart Windows:

```bat
reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f
```

Clone the repository:

```bat
mkdir C:\src
cd /d C:\src
git clone https://github.com/fredzo/SarsatSDR.git sarsat-sdr
cd /d C:\src\sarsat-sdr
```

### ⚙️ 2. MSYS2 UCRT64, compiler, and native libraries

1. Install [MSYS2](https://www.msys2.org/) in `C:\msys64`.
2. Open **MSYS2 UCRT64**, not the MSYS or MINGW64 terminal.
3. Update the system. Reopen UCRT64 and repeat if the terminal asks to close:

```bash
pacman -Syu
```

4. Install the full toolchain:

```bash
pacman -S --needed \
  mingw-w64-ucrt-x86_64-gcc \
  mingw-w64-ucrt-x86_64-cmake \
  mingw-w64-ucrt-x86_64-ninja \
  mingw-w64-ucrt-x86_64-python \
  mingw-w64-ucrt-x86_64-fftw \
  mingw-w64-ucrt-x86_64-libusb \
  mingw-w64-ucrt-x86_64-pkgconf
```

5. Check in UCRT64:

```bash
gcc --version
g++ --version
cmake --version
ninja --version
python --version
pkg-config --modversion fftw3f
pkg-config --modversion libusb-1.0
```

In **Advanced system settings > Environment Variables > User
variables > Path > Edit > New**, add `C:\msys64\ucrt64\bin`
without removing existing entries. Create the `Path` variable if it
does not exist yet. Close and reopen terminals afterward.
Do not use `setx PATH`: its 1024-character limit can truncate
the existing `PATH`.

### 📦 3. Node.js and npm

Install **Node.js 22 LTS, version 22.12 or later**, from [nodejs.org](https://nodejs.org/en/download). Node.js 24+ is also supported. Check:

```bat
node --version
npm --version
```

### ☕ 4. JDK 17

Only required to build the Android application.

Install an x64 JDK 17, such as [Microsoft Build of OpenJDK 17](https://learn.microsoft.com/java/openjdk/download). Adjust the path to the actual directory, then run in `cmd.exe`:

```bat
setx JAVA_HOME "C:\Program Files\Microsoft\jdk-17"
```

Then add `%JAVA_HOME%\bin` to `PATH` through **Advanced system settings > Environment Variables** to avoid incorrect expansion with `setx`. In a new Command Prompt:

```bat
java -version
javac -version
```

Both commands must report Java 17.

### 🤖 5. Android Studio, SDK, NDK, and Android CMake

The SDK, NDK, and Android CMake are only needed to build the APK.
Platform-Tools is sufficient to install an existing APK with ADB.

1. Install [Android Studio](https://developer.android.com/studio).
2. Open **Tools > SDK Manager > SDK Platforms** and install **Android API 37**.
3. In **SDK Tools**, enable **Show Package Details** and install:
   - Android SDK Platform-Tools;
   - the Android SDK Build-Tools required by the project;
   - Android SDK Command-line Tools (latest);
   - NDK (Side by side) **27.1.12297006**;
   - CMake **3.22.1**.
4. Set the variables, assuming the default SDK path:

```bat
setx ANDROID_HOME "%LOCALAPPDATA%\Android\Sdk"
setx ANDROID_SDK_ROOT "%LOCALAPPDATA%\Android\Sdk"
```

Then add these two entries to the user `PATH` through **Environment Variables**:

```text
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\cmdline-tools\latest\bin
```

Reopen `cmd.exe`, then check:

```bat
adb version
sdkmanager --list
```

Behind a corporate TLS proxy, use the Windows certificate store if needed:

```bat
setx JAVA_TOOL_OPTIONS "-Djavax.net.ssl.trustStoreType=Windows-ROOT"
```

### 🔌 6. Windows RTL-SDR driver

For live reception on Windows, **interface 0** of the RTL-SDR device
must use **WinUSB**. If this driver is already installed and reception
works, no changes are needed.

Otherwise, connect the device and open [Zadig](https://zadig.akeo.ie/):

1. Select **Options > List All Devices**.
2. Select **Bulk-In, Interface 0** of the RTL2832U device
   (the name may vary; check the USB ID and interface 0).
3. Select **WinUSB**, then **Install Driver** or **Replace Driver**.

**Warning: do not replace the driver for interface 1, a USB
controller, or the tablet's ADB interface.** Replacing the DVB-T driver
for interface 0 may prevent TV use until the driver is restored.

Zadig is not needed to build, play WAV files, or receive
on Android: the application uses Android USB permission directly.

## 🔨 Building on Windows

In **MSYS2 UCRT64**, at the repository root:

```bash
cmake -S . -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH=C:/msys64/ucrt64
cmake --build build
ctest --test-dir build --output-on-failure
```

The build produces `cospas-c-api.dll`, `cospas-cli.exe`, and the test executables, among other outputs.

Then, in **cmd.exe**, at the repository root:

```bat
npm install
npm run ui:build
```

## ▶️ Running the application on Windows

Make sure `C:\msys64\ucrt64\bin` is in `PATH`, then run from the repository root in **cmd.exe**:

```bat
npm run ui:start
```

Open <http://127.0.0.1:4173> in Chrome or Edge. The server listens on loopback only. To change the port:

```bat
set "SARSAT_UI_PORT=4180"
npm run ui:start
```

The bridge launches `build/cospas-cli.exe` and does not transport raw I/Q data. To test the engine before the interface:

```bat
.\build\cospas-cli.exe --help
.\build\cospas-cli.exe devices --json
.\build\cospas-cli.exe decode --input .\samples\sgb.wav --sgb-only
```

If a DLL cannot be found, reopen the terminal and run `where.exe libfftw3f-3.dll` and `where.exe libusb-1.0.dll`.

## 🤖 Android application

`apps/mobile`: Expo / React Native, the **SarsatSDR** application,
package `org.adrasec.f4jrx.sarsatsdr`, minSdk 26, arm64-v8a and x86_64.
The embedded CLI, FFTW, and libusb are linked into `libsarsat-native.so`,
called by the local Expo module through JNI.

Sources: RTL-SDR USB OTG device (Android permission and foreground service),
bundled captures, and WAV files selected with `OPEN WAV`.
When a compatible device is connected, Android offers **SarsatSDR** as
an application to open it. Reception is then started with the Start button.
The captures add about 350 MB to the APK; each WAV is loaded into RAM.
The tuner waits 10 ms before each of the two PLL lock checks,
particularly after disconnecting/reconnecting. Failure to lock remains an error.

Prerequisites: JDK 17, Android SDK platform 37, NDK 27.1.12297006, and CMake 3.22.1.
## 📲 Deploying the application to an Android device

### 🔌 1. Preparing the tablet

1. In **Settings > About tablet**, tap **Build number** seven times.
2. Open **Developer options** and enable **USB debugging**.
3. Connect a data-capable USB cable and accept the displayed RSA fingerprint.
4. In `cmd.exe`, check the connection:

```bat
adb kill-server
adb start-server
adb devices -l
```

The status must be `device`. If it is `unauthorized`, unlock the tablet and grant permission. If the device is missing, install the manufacturer's USB driver; the Google USB Driver is available in SDK Manager for Google devices.

### 🔨 2. Building the release APK

From `cmd.exe`, at the repository root:

```bat
npm install
cd /d apps\mobile
npx expo prebuild -p android --no-install
cd android
gradlew.bat assembleRelease --max-workers=2
```

The APK is generated at:

```text
apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

### 📲 3. Installing or updating the application

From `apps\mobile\android`:

```bat
adb install -r app\build\outputs\apk\release\app-release.apk
```

With multiple devices, use the serial number returned by `adb devices -l`:

```bat
adb -s <SERIAL> install -r app\build\outputs\apk\release\app-release.apk
```

For a clean installation, which erases existing data:

```bat
adb uninstall org.adrasec.f4jrx.sarsatsdr
adb install app\build\outputs\apk\release\app-release.apk
```

To diagnose a crash or USB issue:

```bat
adb logcat -c
adb logcat | findstr /i "SarsatSDR AndroidRuntime libusb FFTW"
```

The release APK currently uses the Expo debug key. Configure a proper signing key before distribution. EAS `preview` and `production` profiles are provided; an EAS build without `--local` uploads the code to Expo servers.

On Windows, enable LongPathsEnabled and use Ninja >= 1.12 if needed.
Behind a corporate TLS proxy, the Windows certificate store can be
used with `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT`.
The release APK currently uses the Expo debug key: configure a proper key
before distribution. EAS `preview` and `production` profiles are provided;
an EAS build without `--local` uploads the code to Expo servers.

## 🧭 Usage

### 🚀 GitHub Actions: Android build and release

The **Build** workflow runs on pushes to `main`, pull requests, and
manual triggers. It builds the C++ engine, checks WAV regressions
(batch, streaming, and worker), runs UI tests, and builds the Web/Android applications.
The `android-apk` artifact, retained for 14 days, contains `SarsatSDR.apk`
for the `arm64-v8a` and `x86_64` architectures.

The **Release** workflow rebuilds and tests the commit of an existing
`vMAJOR.MINOR.PATCH` tag, such as `v0.2.0`. It starts when the tag is pushed or through
**Actions > Release > Run workflow**, specifying that same tag.
The Android version is taken from the tag. The release publishes
`SarsatSDR-v0.2.0.apk`, its SHA-256 checksum, and GitHub-generated release notes.
Tags such as `v0.2.0-rc.1` produce a prerelease.

No signing secret is required: these APKs use the current Expo debug key
and are intended for testing, not production distribution.
Only the publishing job has `contents: write` permission.

The header button, to the right of RECEIVING / STOPPED, opens the device
(green triangle) or stops the session (red square). Stopping waits for USB shutdown and DSP draining before
another session. With multiple devices, select the bus/address in Settings.
Hardware and decoder settings are locked during acquisition. App settings are
persisted separately from frame sessions.

Daily frame sessions use the local calendar date captured at acquisition start,
for both RTL-SDR and WAV sources. Midnight, automatic retries, and retuning do not
change that date. `SessionCore` annotates session events with `startedAt` and
preserves it across retries and retuning, including for a browser joining an
already-running acquisition.

`apps/mobile/src/frame-sessions.ts` serializes storage operations, validates
versioned daily records, and retains the latest 200 complete entries, including
traces. Android stores one JSON file per day under the private document directory
(`frame-sessions/YYYY-MM-DD.json`), replacing files through a temporary file and
rename; it does not put large trace arrays into AsyncStorage. Web uses IndexedDB
at the UI's origin. Storage failures are reported in the UI.

Frames exposes idle-only session loading, confirmed deletion, and dated JSON
exports. Exports preserve the `Entry[]` format, including hidden frames and all
metadata. Android uses the Storage Access Framework to create an
`application/json` file in a user-selected folder, rather than sharing a large
text Intent; Web downloads a Blob. Historical sessions cannot be cleared.
Starting acquisition restores today's history before starting the engine.
User-visible dates use `DD/MM/YYYY`; JSON exports use
`sarsat-decodes-DD-MM-YYYY.json`. Internal session keys, private storage filenames,
and JSON timestamps retain ISO formats for compatibility and chronological sorting.

Player preroll feedback derives its PREROLL/PLAYING label and remaining
milliseconds from processed-sample metrics, not a separate wall clock.
Settings shows the application version from `apps/mobile/app.json`, which the
release workflow updates before bundling. FGB controls are grouped in rows:
OverPeak/Average/RunTime, Alpha/Beta/Zeta, the three error limits, then max candidates.

DSP defaults:

| Parameter | Default |
|---|---|
| FGB OverPeak / average / RunTime | 15 dB / 0.045 / 550 ms |
| FGB PLL Alpha / Beta / Zeta | 0.1 / 0.01 / 0.01 |
| FGB BCH-1 / BCH-2 / header errors | 3 / 2 / 2 |
| SGB threshold / Alpha / Beta / TC / FB | 35 / 0.83 / 3.81 / 0.5 / 4 |
| SGB BCH limit / PRN / quality | 5 / Late / enabled |
| Search Depth | 9, indices -9..+9 in 150 Hz steps |
| Initial UI gain / FE_AGC | preset 8 / enabled |
| FFT Average / WF Base / WF Range | 0.5 / 27 / 11 |
| WF Auto / RTL calibration | enabled / 0 dB |

The SGB rejection limit is separate from the mathematical capacity of six corrections.
The interface receives synchronized FGB frames even when BCH fails or the correction
limit is exceeded. `Filter invalid frames` hides them without deleting them.
For SGB, `Show invalid / over-limit SGB BCH` allows these failures to be received.
The CLI keeps its default behavior; `--show-fgb-bch-failures` includes
FGB failures only.
Search Depth is displayed using the scale `position * 1.2 / 9` kHz.

The FFT uses a doubled half-Blackman window, the response of both FIR filters,
and the maximum bin value per pixel. In RTL mode, the level accounts for the active
gain preset, including under FE_AGC. `RTL calibration · dB` in Settings adds
a correction to the FFT, markers, and Full BW without changing the decoder.
To calibrate it, enter the known RF level minus the displayed level; the correction
is specific to the device and is not yet saved. Without a reference source,
dBm values are estimates. WAV levels remain relative, with no Full BW measurement in dBm.
Full BW integrates FFT energy across the receiver's 115.2 kHz bandwidth, with window
and gain correction; it is not the sum of the displayed maxima.

WF Auto, enabled by default, estimates noise in the central part of the spectrum:
the lower quartile, with a rise limited to 0.2 dB/s to avoid tracking short frames.
Noise stays black/purple; each color adds 3 dB, giving 18 dB up to
red. RF calibration does not change this relative contrast.
Disabling WF Auto re-enables Base/Range, whose values are retained.
In manual mode, the color is `Round((Round(level) + 180) * (100 - Range) / 600 - Base / 10)`,
clamped between 0 and 6, with ties rounded to even. Increasing Base darkens the background;
increasing Range reduces contrast. Settings and calibration also recolor history.
FFT dots indicate FGB acquisition attempts before BCH, not validated frames.

Receiver splits the available height between the spectrum/waterfall on the left (75%)
and compact controls without internal scrolling on the right (25%), with the settings
reset button to the right of WF Duration. Readouts and metrics remain accessible
by scrolling down. Enter the center in MHz, then confirm with the frequency
button; during reception, acquisition restarts cleanly at the new frequency.
Stored frames retain their original reception frequency.
Player uses the same 75/25 split, without scrolling, with progress
across the full width at the bottom. The supplied samples use a center of 406.050 MHz.
During RTL-SDR reception, PLAY becomes RECORD (red). On Android 10+,
RECORD saves the I/Q stream as a stereo 16-bit PCM WAV at 921600 samples/s
in `Download/SarsatSDR/capture-DD-MM-YYYY_HH-mm-ss.wav`.
The PLAYING and RECORDING labels indicate the current action; while
recording, the red bottom bar scrolls continuously.
STOP first finalizes the WAV without interrupting reception; a second STOP
stops reception. Stopping the receiver, reconnecting, or changing the frequency
also finalizes the capture. The tuner offset is compensated, and the center
stored in the WAV is restored during playback through OPEN WAV.
RIFF/WAV files are limited to 4 GiB (about 19 minutes); a write
error is reported, reception stops, and the incomplete capture is not published.
Select a capture, then `PLAY`. The validated profile, enabled by
default, applies DC removal, preroll, and PLL settings from `samples/playback-profiles.json`,
without changing radio reception settings. Manual mode uses Settings.
DC removal is never implicit; `dcRemovalApplied` reports it in JSON.
Preroll repeats the first 200 milliseconds of the WAV, which may already
contain a carrier. Reported times exclude this prefix.

Frames allocates more width to details, with all fields grouped
by section. Details scroll independently of the table when needed.
In Signal, the initial zoom displays bits from the start of the frame.
Pinch or use `+` / `-` to zoom, then drag horizontally
to browse the trace and its time scale. At sufficient zoom, raw bits and hexadecimal data are displayed
below the FGB phase or SGB I/Q. For SGB, I (green) and Q (red) are overlaid
across the full second above the phase; both plots remain aligned.
Both tables virtualize their rows to avoid mounting the entire history
and display
the local reception timestamp; source time remains available in the details.
Each new frame is selected automatically. Changing the selection
brings the corresponding row into the table's visible area.
MAP uses the selected frame if it has a position,
or the most recent frame containing a position.

## 💻 Headless mode

```bat
.\build\cospas-cli.exe --help
.\build\cospas-cli.exe devices --json
.\build\cospas-cli.exe decode --input .\samples\sgb.wav --sgb-only
.\build\cospas-cli.exe decode --input .\samples\sgb-cnes.wav --sgb-only --remove-dc
.\build\cospas-cli.exe decode --input .\samples\fgb.wav --fgb-only --noise-preroll-ms 2000
.\build\cospas-cli.exe decode --input .\samples\sgb.wav --sgb-only --block-samples 4093 --worker-queue 2
.\build\cospas-cli.exe receive --frequency-hz 406050000 --gain-index 8 --agc --seconds 5 --json
```

Exit codes: `0` with a frame, `2` without a frame, `1` on error. `devices` and
`rtl-probe` return `0` for a successful operation, even when no device is detected.
Frame JSON contains raw/corrected bits, BCH status and correction counts,
`headerErrors`, times, frequency offset, and `fields: [{section, name, value}]`.
`tablesSha256` identifies the embedded DSP tables; JSONL spectra include
`displayOffsetDb`, and reception exposes `dspOffsetHz`.

The decoding center is separate from the tuner center: the default DSP offset is -70 kHz,
with an NCO after FIR55 and before FIR104, compensating for PLL error.
`--events` enables JSONL: session, spectrum, acquisition, metrics, frame, and complete.
`spectrum.fullBandwidthDbm` is an RTL estimate before user correction,
or `null` during WAV playback and when no measurable energy is present.
`--events --continuous --control-stdin` removes the reception duration limit;
`stop` followed by a newline, or closing the pipe, requests an orderly shutdown.
`decode --events --realtime` paces WAV playback without changing its bits.

## 🧩 C API

Contract: [c_api.h](native/cospas-core/include/cospas/c_api.h), target
`cospas-c-api`. Check `cs_abi_version()` and initialize with `cs_config_init`.
The public C++ header is `cospas/decoder.hpp`.

- `cs_decode_iq`: batch processing of CU8/CS16/CF32, at rates from 76800 to 10000000 Hz.
  Sizes are in bytes, I/Q is interleaved, and the buffer is borrowed for the duration of the call.
- `cs_stream_*`: incremental processing, with the index of the first complex sample,
  bounded blocks, and explicit rejection of gaps/overlaps. Reset is required
  after a discontinuity or error; finish drains the tail, then forbids further pushes.
- `cs_worker_*`: one producer, one consumer, preallocated SPSC queues.
  Submit copies without waiting for DSP; a full queue returns `CS_QUEUE_FULL`.
  Events transfer ownership of the result to the consumer.
- `cs_result_get_*`: access to frames/diagnostics and borrowed traces.
  `cs_result_destroy` frees the result; the result survives stream destruction.
- Failures return a status and `cs_error`, without silent global state.
  Synchronous calls allocate memory; do not run them in a USB callback.

The trailing configuration fields and `cs_frame.header_errors` extend ABI v1
with size checks. The `tables_sha256` diagnostic member retains the
size and memory offset of the 65-character field. C/C++ consumers
must be recompiled with the current public names. The current ABI is v2:
acquisition arrays can contain up to 10 simultaneous FGB channels,
with corresponding telemetry, FFT markers, and FM audio selection.
The FGB "max candidates" setting is saved in Settings: 4 by default,
from 1 to 10, applying to reception and playback, including with a validated profile.
On the command line: `--fgb-max-candidates N`.
FFTW plans require plan creation and batch calls to be serialized.

## ✅ Validation

```bat
ctest --test-dir build --output-on-failure
ctest --test-dir build -L samples --output-on-failure
ctest --test-dir build -L rtl --output-on-failure
npm run ui:test
npm run ui:build
```

The nine captures are checked in batch, incremental, and worker modes against
documented expectations: protected words, corrections, and the absence of
additional distinct frames. BCH-2 values documented as invalid are reported;
expected values are never injected into the engine.
Additional tests cover the C contract, I/Q format equivalence, NCO continuity,
RTL registers, PLL, reconnection, USB errors, worker saturation, and shutdown.
UI tests include all nine real-time playbacks through JSONL.
