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

import argparse
import json
import math
import re
import struct
import subprocess
import tempfile
from pathlib import Path


def bits(word, count):
    return f"{int(word, 16):0{len(word) * 4}b}"[-count:]


def valid_bch2(word):
    powers = []
    value = 1
    for _ in range(63):
        powers.append(value)
        value <<= 1
        if value & 64:
            value ^= 0x43
    code = bits(word, 144)[106:]
    for root in range(1, 5):
        syndrome = 0
        for n, bit in enumerate(reversed(code)):
            if bit == "1":
                syndrome ^= powers[(n * root) % 63]
        if syndrome:
            return False
    return True


def fgb_header(bits_text):
    sync = bits_text[15:24]
    normal = sum(a != b for a, b in zip(sync, "000101111"))
    test = sum(a != b for a, b in zip(sync, "011010000"))
    return bits_text[:15].count("0") + min(normal, test), test < normal


def fgb_has_bch2(bits_text):
    return len(bits_text) == 144 and bits_text[24] == "1" and not (bits_text[25] == "1" and bits_text[36:39] == "000")


def check_corrections(frame):
    generation = frame["generation"]
    count = 250 if generation == 2 else len(frame["rawHex"]) * 4
    raw = bits(frame["rawHex"], count)
    corrected = bits(frame["correctedHex"], count)
    assert len(raw) == len(corrected) == count
    assert re.fullmatch(r"[0-9A-F]+", frame["rawHex"])
    assert re.fullmatch(r"[0-9A-F]+", frame["correctedHex"])
    assert len(frame["rawHex"]) == len(frame["correctedHex"]) == (count + 3) // 4
    if generation == 1:
        errors, self_test = fgb_header(raw)
        assert frame["headerErrors"] == errors and 0 <= errors <= 3, "FGB header error count mismatch"
        assert frame["mode"] == ("self_test" if self_test else "normal")
        assert raw[:24] == corrected[:24], "Unprotected FGB sync must preserve received bits"
    fields = [(0, 250, 6)] if generation == 2 else [(24, 106, 3)] + ([(106, count, 2)] if fgb_has_bch2(corrected) else [])
    assert len(frame["bch"]) == len(fields)
    for status, (start, end, limit) in zip(frame["bch"], fields):
        changed = sum(a != b for a, b in zip(raw[start:end], corrected[start:end]))
        if status["valid"]:
            assert 0 <= status["correctedErrors"] <= limit
            assert status["correctedErrors"] == changed
        else:
            assert status["correctedErrors"] is None
            assert changed == 0, "Invalid BCH word must preserve raw bits"
    assert frame["bch"][0]["valid"], "Default output must not accept invalid BCH-1"
    assert frame["fields"] and all(set(field) == {"section", "name", "value"} and
                                   all(isinstance(value, str) for value in field.values())
                                   for field in frame["fields"])


def check_sample(cli, sample, block_samples=None, worker_queue=None):
    expected = re.findall(r"^```([0-9A-F]{28,63})```", sample.with_suffix(".md").read_text(encoding="utf-8"),
                          flags=re.MULTILINE)
    assert expected, f"No expected frame in {sample.with_suffix('.md')}"
    command = [str(cli), "decode", "--input", str(sample), "--json"]
    if block_samples is not None:
        command += ["--block-samples", str(block_samples)]
    if worker_queue is not None:
        command += ["--worker-queue", str(worker_queue)]
    profile = json.loads((sample.parent / "playback-profiles.json").read_text(encoding="utf-8"))[sample.name]
    settings = profile["settings"]
    if not settings["sgb"]:
        command += ["--fgb-only"]
    if not settings["fgb"]:
        command += ["--sgb-only"]
    if profile["removeDc"]:
        command += ["--remove-dc"]
    command += ["--noise-preroll-ms", str(profile["noisePrerollMs"])]
    for field, option in [("fgbOverPeakDb", "--fgb-over-peak"), ("fgbAlpha", "--fgb-alpha"),
                          ("fgbBeta", "--fgb-beta"), ("fgbAverage", "--fgb-average"),
                          ("fgbZeta", "--fgb-zeta"), ("fgbMaxErrors", "--fgb-max-errors"),
                          ("fgbHeaderErrors", "--fgb-header-errors"), ("fgbBch2MaxErrors", "--fgb-bch2-max-errors")]:
        if field in settings:
            command += [option, str(settings[field])]
    result = subprocess.run(command, capture_output=True, text=True, timeout=180, check=False)
    assert result.returncode in (0, 2), f"CLI failed: {result.stderr}"
    output = json.loads(result.stdout)
    assert output["sampleRateHz"] > 0 and output["durationSeconds"] > 0
    assert output["dcRemovalApplied"] == profile["removeDc"]
    assert len(output["tablesSha256"]) == 64
    frames = output["frames"]
    assert result.returncode == (0 if frames else 2), "Exit status disagrees with frame output"
    for frame in frames:
        check_corrections(frame)
        if frame["generation"] == 1:
            assert frame["headerErrors"] <= settings.get("fgbHeaderErrors", 2)
    actual = {(f["generation"], f["correctedHex"]): f for f in frames}
    unmatched = dict(actual)
    missing = []
    for word in expected:
        generation = 2 if len(word) == 63 else 1
        match = unmatched.pop((generation, word), None)
        if generation == 1:
            expected_bch2_valid = valid_bch2(word)
            if match is None:
                end = len(word) * 4 if expected_bch2_valid else 106
                key = next((key for key in unmatched
                            if key[0] == 1 and len(key[1]) == len(word) and
                            bits(key[1], len(word) * 4)[24:end] == bits(word, len(word) * 4)[24:end]), None)
                if key is not None:
                    match = unmatched.pop(key)
            if not expected_bch2_valid:
                print(f"DOCUMENT DISCREPANCY: {word} has invalid BCH-2; "
                      f"checking BCH-1, decoded={match['correctedHex'] if match else 'missing'}")
            if match:
                if match["rawHex"][:6] != word[:6]:
                    print(f"UNCODED SYNC DIFFERENCE: expected={word[:6]}, received={match['rawHex'][:6]}; "
                          "preamble gate and protected fields checked separately")
                if expected_bch2_valid and fgb_has_bch2(bits(word, len(word) * 4)):
                    assert match["bch"][1]["valid"], "Expected valid BCH-2 must decode successfully"
        if match is None:
            missing.append(word)
            continue
        expected_mode = "self_test" if ((generation == 2 and int(word[0], 16) & 8) or
                                       (generation == 1 and fgb_header(bits(word, 144))[1])) else "normal"
        assert match["mode"] == expected_mode
    assert not missing and not unmatched, (
        f"{sample.name}: missing={missing}, unexpected={list(unmatched)}, "
        f"diagnostics={output['diagnostics']}")
    print(f"{sample.name}: {len(actual)} distinct frame(s) verified; "
          f"{len(frames) - len(actual)} duplicate channel result(s)")


def check_devices(cli):
    result = subprocess.run([str(cli), "devices", "--json"], capture_output=True,
                            text=True, check=False, timeout=30)
    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)
    assert set(output) == {"devices"} and isinstance(output["devices"], list)
    locations = set()
    for device in output["devices"]:
        assert set(device) == {"vendorId", "productId", "bus", "address"}
        for field in ("vendorId", "productId", "bus", "address"):
            assert type(device[field]) is int
            assert 0 <= device[field] <= (65535 if field in ("vendorId", "productId") else 255)
        location = (device["bus"], device["address"])
        assert location not in locations, "Duplicate RTL-SDR USB device"
        locations.add(location)
    print(f"Descriptor-only USB enumeration JSON verified: {len(locations)} supported devices")


def check_invalid_options(cli):
    help_result = subprocess.run([str(cli), "rtl-probe", "--help"], capture_output=True,
                                 text=True, check=False, timeout=10)
    assert help_result.returncode == 0 and "Diagnostic I/Q acquisition only" in help_result.stdout
    help_result = subprocess.run([str(cli), "receive", "--help"], capture_output=True,
                                 text=True, check=False, timeout=10)
    assert help_result.returncode == 0 and "Live FGB/SGB decoding" in help_result.stdout
    valid_probe = ["--frequency-hz", "406050000", "--gain-index", "1"]
    for options, message in [
            ([], "requires --frequency-hz"),
            (["--frequency-hz", "406050000"], "requires --gain-index"),
            (["--frequency-hz", "406100001", "--gain-index", "1"], "requires --frequency-hz"),
            (["--frequency-hz", "406050000", "--gain-index", "12"], "requires --gain-index"),
            (valid_probe + ["--seconds", "0"], "duration must be"),
            (valid_probe + ["--seconds", "31"], "duration must be"),
            (valid_probe + ["--seconds", "nan"], "Invalid number for --seconds"),
            (valid_probe + ["--gain-index", "1junk"], "Invalid number for --gain-index"),
            (valid_probe + ["--bus", "1"], "requires both --bus and --address"),
            (valid_probe + ["--bus", "-1", "--address", "46"], "requires both --bus and --address"),
            (valid_probe + ["--unknown"], "Unknown or incomplete RTL probe option"),
            (valid_probe + ["--seconds"], "Unknown or incomplete RTL probe option")]:
        result = subprocess.run([str(cli), "rtl-probe", *options], capture_output=True,
                                text=True, check=False, timeout=10)
        assert result.returncode == 1 and not result.stdout
        assert message in result.stderr, result.stderr
        result = subprocess.run([str(cli), "receive", *options], capture_output=True,
                                text=True, check=False, timeout=10)
        assert result.returncode == 1 and not result.stdout
        assert message.replace("RTL probe", "RTL receive") in result.stderr, result.stderr
    result = subprocess.run([str(cli), "receive", *valid_probe, "--fgb-only", "--sgb-only"],
                            capture_output=True, text=True, check=False, timeout=10)
    assert result.returncode == 1 and not result.stdout and "Select only one generation filter" in result.stderr
    for command, options, message in [
            ("receive", valid_probe + ["--continuous"], "--continuous requires --events"),
            ("receive", valid_probe + ["--continuous", "--events"], "--continuous requires --control-stdin"),
            ("receive", valid_probe + ["--control-stdin"], "--control-stdin requires --events"),
            ("decode", ["--input", "not-read.wav", "--realtime"], "--realtime requires --events"),
            ("decode", ["--input", "not-read.wav", "--control-stdin"], "--control-stdin requires --events")]:
        result = subprocess.run([str(cli), command, *options], capture_output=True,
                                text=True, check=False, timeout=10)
        assert result.returncode == 1 and not result.stdout and message in result.stderr, result.stderr
    help_result = subprocess.run([str(cli), "devices", "--help"], capture_output=True,
                                 text=True, check=False, timeout=10)
    assert help_result.returncode == 0 and "cospas-cli devices" in help_result.stdout
    for options in [["--input", "not-read.wav"], ["--unknown"], ["--json", "--json"]]:
        result = subprocess.run([str(cli), "devices", *options], capture_output=True,
                                text=True, check=False, timeout=10)
        assert result.returncode == 1 and not result.stdout
        assert "Usage: cospas-cli devices" in result.stderr, result.stderr
    for option, value in [("--sgb-threshold", "nan"), ("--sgb-threshold", "15junk"),
                          ("--sgb-phase-gain", "nan"), ("--sgb-phase-gain", "0.25junk"),
                          ("--fgb-alpha", "nan"), ("--fgb-beta", "0.01junk"),
                          ("--fgb-zeta", "nan"), ("--fgb-average", "0.5junk"),
                          ("--fgb-max-errors", "1.5"), ("--fgb-header-errors", "1.5"), ("--fgb-bch2-max-errors", "1.5"),
                          ("--sgb-filter", "inf"),
                          ("--sgb-frequency-gain", "nan"), ("--sgb-max-errors", "1junk"),
                          ("--sgb-feedback", "nan"), ("--sgb-feedback", "4junk"),
                          ("--search-depth", "3.5"),
                          ("--fgb-over-peak", "inf"), ("--noise-preroll-ms", "2000junk"),
                          ("--prn-alignment", "1.5"), ("--block-samples", "-1"),
                          ("--block-samples", "4096junk"), ("--worker-queue", "-1"),
                          ("--worker-queue", "2junk")]:
        result = subprocess.run([str(cli), "decode", "--input", "not-read.wav", option, value],
                                capture_output=True, text=True, check=False, timeout=10)
        assert result.returncode == 1 and not result.stdout
        assert "Invalid number for " + option in result.stderr, result.stderr
    result = subprocess.run([str(cli), "decode", "--input", "not-read.wav", "--block-samples", "0"],
                            capture_output=True, text=True, check=False, timeout=10)
    assert result.returncode == 1 and not result.stdout
    assert "Stream block size must be positive" in result.stderr
    for options, message in [
            (["--worker-queue", "0"], "Worker queue size must be positive"),
            (["--worker-queue", "2"], "--worker-queue requires --block-samples")]:
        result = subprocess.run([str(cli), "decode", "--input", "not-read.wav", *options],
                                capture_output=True, text=True, check=False, timeout=10)
        assert result.returncode == 1 and not result.stdout
        assert message in result.stderr
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "dc-input.wav"
        for data, error in [
                (b"", "DC removal requires non-empty WAV input"),
                (struct.pack("<6f", 3.4028234663852886e38, 0,
                             -3.4028234663852886e38, 0, -3.4028234663852886e38, 0),
                 "DC removal exceeds supported I/Q range")]:
            path.write_bytes(struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(data), b"WAVE",
                                         b"fmt ", 16, 3, 2, 230400, 1843200, 8, 32, b"data", len(data)) + data)
            result = subprocess.run([str(cli), "decode", "--input", str(path), "--remove-dc"],
                                    capture_output=True, text=True, check=False, timeout=10)
            assert result.returncode == 1 and not result.stdout
            assert error in result.stderr, result.stderr


def check_receive(cli):
    for automatic, seconds in [(True, 5), (False, 3)]:
        command = [str(cli), "receive", "--frequency-hz", "406050000",
                   "--gain-index", "8", "--seconds", str(seconds), "--json"]
        if automatic:
            command.append("--agc")
        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=45)
        assert result.returncode in (0, 2), result.stderr
        output = json.loads(result.stdout)
        assert result.returncode == (0 if output["frames"] else 2)
        assert output["sampleRateHz"] == 921600 and output["biasTee"] is False
        assert output["automaticGain"] == automatic
        if not automatic:
            assert output["gainChanges"] == 0 and output["finalGainIndex"] == 8
        assert output["dspOffsetHz"] == -70000
        assert output["tunerRequestedFrequencyHz"] == output["requestedFrequencyHz"] + 70000
        assert math.isclose(output["actualFrequencyHz"] + output["mixerHz"],
                            output["requestedFrequencyHz"], rel_tol=0, abs_tol=.01)
        assert math.isclose(output["dspCenterFrequencyHz"],
                            output["actualFrequencyHz"] + output["mixerHz"], rel_tol=0, abs_tol=.000001)
        assert output["bytes"] == output["samples"] * 2
        assert output["blocks"] * 6400 + output["pendingBytes"] // 2 == output["samples"]
        assert output["pendingBytes"] % 2 == 0 and output["dspSamples"] == output["samples"]
        assert output["elapsedSeconds"] >= seconds
        assert abs(output["samples"] - output["sampleRateHz"] * output["elapsedSeconds"]) <= 12800, output
        worker = output["worker"]
        assert worker["acceptedBlocks"] == output["blocks"] + (output["pendingBytes"] > 0)
        assert worker["processedBlocks"] == worker["acceptedBlocks"]
        assert worker["queueFullCount"] == worker["discontinuities"] == worker["missingSamples"] == 0
        assert len(output["tablesSha256"]) == 64 and output["dspDrainSeconds"] >= 0
        for frame in output["frames"]:
            check_corrections(frame)
            assert 0 <= frame["timeSeconds"] <= output["samples"] / output["sampleRateHz"]
        print(f"Real RTL receive: {output['dspSamples']} DSP samples in {output['elapsedSeconds']:.6f}s, "
              f"AGC={automatic}, {output['gainChanges']} gain changes, {len(output['frames'])} frames, "
              f"drain={output['dspDrainSeconds']:.6f}s; sample accounting and reopen verified")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", required=True, type=Path)
    parser.add_argument("--sample", type=Path)
    parser.add_argument("--devices", action="store_true")
    parser.add_argument("--receive", action="store_true",
                        help="Opt-in hardware test: receive 5s with AGC, then reopen for 3s manual gain")
    parser.add_argument("--block-samples", type=int)
    parser.add_argument("--worker-queue", type=int)
    args = parser.parse_args()
    if args.devices:
        check_devices(args.cli)
    elif args.receive:
        check_receive(args.cli)
    elif args.sample:
        check_sample(args.cli, args.sample, args.block_samples, args.worker_queue)
    else:
        check_invalid_options(args.cli)
