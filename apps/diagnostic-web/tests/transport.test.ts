import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { argumentsFor, Session } from "../session.js";
import { nativeEventSchema, settingsSchema, startSchema, playbackProfilesSchema, playbackConfiguration,
  type Frame, type ServerEvent } from "@sarsat/shared/protocol";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const executable = resolve(root, "build", process.platform === "win32" ? "cospas-cli.exe" : "cospas-cli");
const execute = promisify(execFile);
async function defaults() {
  const result = await execute(executable, ["settings", "--json"]);
  return settingsSchema.parse(JSON.parse(result.stdout));
}

test("UI command validation preserves native defaults and constrains sample access", async () => {
  const settings = await defaults();
  const command = startSchema.parse({ type: "start", source: "sample", centerHz: 406050000,
    gainIndex: 8, agc: true, sample: "sgb.wav", removeDc: false, noisePrerollMs: 0, settings });
  const args = argumentsFor(command, ["sgb.wav"], root);
  assert.ok(args.includes("--events") && args.includes("--control-stdin"));
  assert.equal(args.includes("--remove-dc"), false);
  assert.equal(args[args.indexOf("--sgb-threshold") + 1], String(settings.sgbThreshold));
  assert.throws(() => argumentsFor({ ...command, sample: "..\\outside\\unexpected.exe" }, ["sgb.wav"], root));
  assert.equal(startSchema.safeParse({ ...command, settings: { ...settings, fgb: false, sgb: false } }).success, false);
  assert.equal(startSchema.safeParse({ ...command, centerHz: 407000000 }).success, false);
  assert.equal(startSchema.safeParse({ ...command, bus: 1 }).success, false);
  assert.equal(startSchema.safeParse({ ...command, settings: { ...settings, sgbThreshold: 513 } }).success, false);
  assert.equal(startSchema.safeParse({ ...command, settings: { ...settings, sgbThreshold: 0 } }).success, true);
  const tuned = { ...settings, fgbZeta: .03, fgbAverage: .15, fgbRuntimeMs: 575,   fgbMaxErrors: 1, fgbHeaderErrors: 2, fgbBch2MaxErrors: 1,
    sgbFilter: .25, sgbFrequencyGain: 1.75, sgbFeedback: 3, sgbMaxErrors: 2, searchDepth: 5 };
  for (const source of ["sample", "rtl"] as const) {
    const mapped = argumentsFor(startSchema.parse({ ...command, source, settings: tuned }), ["sgb.wav"], root);
    for (const [option, expected] of [
      ["--fgb-zeta", ".03"], ["--fgb-average", ".15"], ["--fgb-max-errors", "1"],
      ["--fgb-runtime-ms", "575"], ["--fgb-header-errors", "2"], ["--fgb-bch2-max-errors", "1"],
      ["--sgb-filter", ".25"], ["--sgb-frequency-gain", "1.75"], ["--sgb-max-errors", "2"],
      ["--sgb-feedback", "3"],
      ["--search-depth", "5"],
    ]) {
      assert.ok(mapped.includes(option), option);
      assert.equal(Number(mapped[mapped.indexOf(option) + 1]), Number(expected), option);
    }
  }
  for (const invalid of [{ fgbZeta: -1 }, { fgbAverage: 1.01 }, { fgbMaxErrors: 4 },
    { fgbRuntimeMs: 0 }, { fgbRuntimeMs: -1 }, { fgbRuntimeMs: 550.5 },
    { sgbFilter: -0.01 }, { sgbFrequencyGain: -1 }, { sgbFeedback: -1 }, { sgbFeedback: Infinity },
    { sgbMaxErrors: 7 }, { searchDepth: 2 },
    { searchDepth: 10 }, { searchDepth: 3.5 }, { fgbMaxErrors: 1.5 }, { fgbHeaderErrors: 4 }, { fgbHeaderErrors: 1.5 }, { fgbBch2MaxErrors: 3 }])
    assert.equal(startSchema.safeParse({ ...command, settings: { ...settings, ...invalid } }).success, false);
});

test("Configured BCH limit suppresses corrected frames unless explicitly requested", { timeout: 15000 }, async () => {
  const settings = { ...await defaults(), fgb: false, sgbMaxErrors: 0 };
  for (const showBchFailures of [false, true]) {
    const events: ServerEvent[] = [];
    await new Promise<void>((complete, fail) => {
      const session = new Session(executable, root, ["sgb.wav"], event => {
        events.push(event);
        if (event.type === "status" && event.status === "idle") {
          clearTimeout(timer);
          complete();
        }
      });
      const timer = setTimeout(() => { session.stop(); fail(new Error("Native playback timed out")); }, 6000);
      session.start(startSchema.parse({ type: "start", source: "sample", centerHz: 406050000,
        gainIndex: 8, agc: false, sample: "sgb.wav", removeDc: false, noisePrerollMs: 0,
        settings: { ...settings, showBchFailures } }));
    });
    assert.deepEqual(events.filter(event => event.type === "error"), []);
    assert.ok(events.some(event => event.type === "complete"));
    const frames = events.filter(event => event.type === "frame");
    if (showBchFailures) {
      assert.equal(frames.length, 1);
      assert.equal(frames[0].frame.correctionLimit, 0);
      assert.equal(frames[0].frame.bch[0].valid, true);
      assert.equal(frames[0].frame.bch[0].correctedErrors, 1);
    } else {
      assert.equal(frames.length, 0);
      assert.ok(events.some(event => event.type === "complete" && event.result.diagnostics.sgbBchRejections > 0));
    }
  }
});

test("FGB BCH-1 limit 2 rejects the degraded capture that the spec default of three corrections decodes", async () => {
  const settings = await defaults();
  const profiles = playbackProfilesSchema.parse(JSON.parse(
    await readFile(resolve(root, "samples", "playback-profiles.json"), "utf8")));
  const sample = "fgb-cnes.wav";
  const playback = playbackConfiguration(settings, profiles[sample]);
  const command = startSchema.parse({ type: "start", source: "sample", centerHz: 406050000,
    gainIndex: 8, agc: false, sample, ...playback });
  const args = (fgbMaxErrors: number) => [...argumentsFor({
    ...command, settings: { ...command.settings, fgbMaxErrors },
  }, [sample], root).filter(arg => !["--events", "--control-stdin", "--realtime"].includes(arg)), "--json"];
  const [capture, strict] = await Promise.allSettled([
    execute(executable, args(settings.fgbMaxErrors)),
    execute(executable, args(2)),
  ]);
  assert.ok(capture.status === "fulfilled");
  const decoded = nativeEventSchema.parse({ type: "complete", result: JSON.parse(capture.value.stdout) });
  assert.ok(decoded.type === "complete");
  assert.equal(decoded.result.frames.length, 1);
  assert.equal(decoded.result.frames[0].bch[0].valid, true);
  assert.equal(decoded.result.frames[0].bch[0].correctedErrors, 3);
  assert.ok(strict.status === "rejected");
  assert.equal(strict.reason.code, 2);
  const rejected = nativeEventSchema.parse({ type: "complete", result: JSON.parse(strict.reason.stdout) });
  assert.ok(rejected.type === "complete");
  assert.deepEqual(rejected.result.frames, []);
});

test("Native JSONL supplies real spectra, decoded sample bits and bounded ENG traces", async () => {
  const result = await execute(executable, ["decode", "--input", resolve(root, "samples", "sgb.wav"),
    "--sgb-only", "--events"], { maxBuffer: 8 * 1024 * 1024, timeout: 15000 });
  const events = result.stdout.trim().split(/\r?\n/).map(line => nativeEventSchema.parse(JSON.parse(line)));
  assert.equal(events[0].type, "session");
  assert.equal(events.at(-1)?.type, "complete");
  assert.ok(events.some(event => event.type === "acquisition"));
  assert.ok(events.every(event => event.type !== "acquisition" || event.channels.length === 0),
    "SGB-only decoding must not fabricate FGB candidate markers");
  const spectra = events.filter(event => event.type === "spectrum");
  assert.ok(spectra.length > 10);
  for (let n = 0; n < spectra.length; n++) {
    assert.ok(Math.abs(spectra[n].timeSeconds - (n + 1) / 10) < 1e-6);
    assert.equal(spectra[n].dbfs.length, 1024);
    assert.equal(spectra[n].fullBandwidthDbm, null, "A WAV without tuner gain must not claim RF power");
    assert.ok(spectra[n].dbfs.some(value => value !== null && value > -100));
  }
  const expected = [...(await readFile(resolve(root, "samples", "sgb.md"), "utf8"))
    .matchAll(/^```([0-9A-F]{63})```/gm)].map(match => match[1]);
  const frames = events.filter(event => event.type === "frame");
  assert.ok(frames.length > 0 && expected.length > 0);
  assert.deepEqual(frames.map(event => event.frame.correctedHex).sort(), expected.sort());
  for (const { frame } of frames) {
    assert.ok(frame.traces);
    for (const trace of Object.values(frame.traces)) {
      assert.ok(trace.count > 0 && trace.values.length <= 1024);
      assert.equal(trace.values.length, Math.ceil(trace.count / trace.stride));
    }
    assert.ok(frame.bch.every(field => field.valid));
    assert.ok(frame.fields?.some(field => field.section === "Encoded GNSS Location"));
  }
});

test("FGB engineering output is reduced without altering protected bits", async () => {
  const result = await execute(executable, ["decode", "--input", resolve(root, "samples", "fgb.wav"),
    "--fgb-only", "--fgb-over-peak", "15", "--noise-preroll-ms", "2000", "--events"],
  { maxBuffer: 8 * 1024 * 1024, timeout: 15000 });
  const events = result.stdout.trim().split(/\r?\n/).map(line => nativeEventSchema.parse(JSON.parse(line)));
  const frames = events.filter(event => event.type === "frame");
  assert.ok(frames.length > 0);
  const frame = frames[0].frame;
  const markerIndex = events.findIndex(event => event.type === "acquisition" &&
    event.channels.some(channel => Math.abs(channel.frequencyOffsetHz - frame.frequencyOffsetHz) < 1));
  assert.ok(markerIndex >= 0 && markerIndex < events.findIndex(event => event.type === "frame"),
    "A native FGB candidate must be visible before BCH/frame output");
  const marker = events[markerIndex];
  assert.ok(marker.type === "acquisition");
  const selected = marker.channels.find(channel => Math.abs(channel.frequencyOffsetHz - frame.frequencyOffsetHz) < 1);
  assert.ok(selected && Number.isFinite(selected.levelDbfs));
  assert.ok(events.slice(markerIndex + 1).some(event => event.type === "acquisition" &&
    !event.channels.some(channel => channel.channel === selected.channel)),
  "Marker must disappear when the native trial ends, not remain as frame history");
  const documentation = await readFile(resolve(root, "samples", "fgb.md"), "utf8");
  for (const { frame } of frames) {
    assert.ok(documentation.includes(frame.correctedHex.slice(6)));
    assert.equal(frame.headerErrors, 0);
    assert.ok(frame.fields?.some(field => field.name === "Hex ID"));
    const trace = frame.traces?.phase;
    assert.ok(trace && trace.count > 1024 && trace.stride > 1);
    assert.equal(trace.values.length, Math.ceil(trace.count / trace.stride));
    assert.ok(trace.values.length <= 1024);
  }
});

test("Transport stop drains native process and permits a new player session", { timeout: 15000 }, async () => {
  const settings = await defaults();
  const command = startSchema.parse({ type: "start", source: "sample", centerHz: 406050000,
    gainIndex: 8, agc: false, sample: "sgb.wav", removeDc: false, noisePrerollMs: 0, settings });
  for (let pass = 0; pass < 2; pass++) {
    const events: ServerEvent[] = [];
    await new Promise<void>((complete, fail) => {
      const timer = setTimeout(() => { session.stop(); fail(new Error("Native stop timed out")); }, 6000);
      const session = new Session(executable, root, ["sgb.wav"], event => {
        events.push(event);
        if (event.type === "spectrum") session.stop();
        if (event.type === "status" && event.status === "idle") {
          clearTimeout(timer);
          complete();
        }
      });

      session.start(command);
    });
    assert.deepEqual(events.filter(event => event.type === "error"), []);
    assert.ok(events.some(event => event.type === "complete"));
    assert.ok(events.some(event => event.type === "status" && event.status === "stopping"));
    assert.ok(events.some(event => event.type === "session" && event.label === "sgb.wav"));
  }
});

test("Player profiles decode all nine captures through the real-time GUI transport", { timeout: 240000 }, async t => {
  const settings = await defaults();
  const originalSettings = { ...settings };
  const profiles = playbackProfilesSchema.parse(JSON.parse(
    await readFile(resolve(root, "samples", "playback-profiles.json"), "utf8")));
  const samples = (await readdir(resolve(root, "samples"))).filter(name => name.endsWith(".wav")).sort();
  assert.deepEqual(Object.keys(profiles).sort(), samples);
  for (const sample of samples) await t.test(sample, { timeout: 90000 }, async () => {
    const command = startSchema.parse({ type: "start", source: "sample", centerHz: 406050000,
      gainIndex: 8, agc: false, sample, ...playbackConfiguration(settings, profiles[sample]) });
    const batchArgs = argumentsFor(command, samples, root)
      .filter(arg => !["--events", "--control-stdin", "--realtime"].includes(arg));
    const batch = await execute(executable, [...batchArgs, "--json"], { timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
    const baseline = nativeEventSchema.parse({ type: "complete", result: JSON.parse(batch.stdout) });
    assert.ok(baseline.type === "complete");
    assert.ok(baseline.result.frames.length > 0);
    const frames: Frame[] = [], errors: string[] = [];
    let completed = false;
    await new Promise<void>((complete, fail) => {
      const session = new Session(executable, root, samples, event => {
        if (event.type === "frame") frames.push(event.frame);
        if (event.type === "error") errors.push(event.message);
        if (event.type === "complete") completed = true;
        if (event.type === "status" && event.status === "idle") {
          clearTimeout(timer);
          complete();
        }
      });
      const timer = setTimeout(() => { session.stop(); fail(new Error(`${sample}: playback timed out`)); }, 80000);
      session.start(command);
    });
    assert.deepEqual(errors, [], sample);
    assert.equal(completed, true);
    const distinct = (values: Frame[]) => [...new Set(values.map(frame =>
      `${frame.generation}:${frame.mode}:${frame.correctedHex}`))].sort();
    assert.deepEqual(distinct(frames), distinct(baseline.result.frames), sample);
    assert.ok(frames.every(frame => frame.bch[0].valid));
  });
  assert.deepEqual(settings, originalSettings, "Profiles must not modify radio defaults");
});
