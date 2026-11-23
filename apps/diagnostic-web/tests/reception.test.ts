import { test } from "node:test";
import assert from "node:assert/strict";
import type { Frame } from "@sarsat/shared/protocol";
import { frameNotification, isFrameFiltered, receptionPreferencesSchema } from "../../mobile/src/reception-preferences";
import { FgbCountdown } from "../../mobile/src/fgb-countdown";
import { appPreferencesSchema } from "../../mobile/src/app-preferences";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { settingsSchema } from "@sarsat/shared/protocol";

const frame = (generation: 1 | 2, beaconType: string, valid = true): Frame => ({
  generation, beaconType, mode: "normal", timeSeconds: 0, frequencyOffsetHz: 0,
  rawHex: "A".repeat(36), correctedHex: "A".repeat(36),
  bch: generation === 1 ? [{ valid: true, correctedErrors: 0 }, { valid, correctedErrors: valid ? 0 : null }]
    : [{ valid, correctedErrors: valid ? 0 : null }],
});

test("Saved app preferences round-trip all receiver, decoder, display and player settings", () => {
  const executable = fileURLToPath(new URL(`../../../build/cospas-cli${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
  const settings = settingsSchema.parse(JSON.parse(execFileSync(executable, ["settings", "--json"], { encoding: "utf8" })));
  const saved = appPreferencesSchema.parse({ settings: { ...settings, fgbOverPeakDb: 17, fgbMaxCandidates: 10, sgbThreshold: 80 },
    center: 145.825, gain: 5, agc: false, device: "1:2", calibrationDb: -3.5,
    sample: "fgb.wav", useSampleProfile: false, removeDc: true, preroll: 2000,
    base: 30, range: 20, waterfallAutomatic: false, average: .8, waterfallSpeed: 2 });
  assert.deepEqual(appPreferencesSchema.parse(JSON.parse(JSON.stringify(saved))), saved);
  assert.ok(saved.settings);
  const { fgbMaxCandidates: _limit, ...legacySettings } = saved.settings;
  const migrated = appPreferencesSchema.parse({ ...saved, settings: legacySettings });
  assert.equal(migrated.settings?.fgbMaxCandidates, 4);
  assert.equal(migrated.settings?.fgbOverPeakDb, 17);
  assert.equal("device" in saved, false, "Legacy USB addresses must not survive loading or saving");
  for (const invalid of [{ center: 99 }, { gain: 12 }, { average: 0 }, { waterfallSpeed: 5 },
    { settings: { ...settings, fgbMaxErrors: 4 } }, { settings: { ...settings, fgbMaxCandidates: 11 } }])
    assert.equal(appPreferencesSchema.safeParse({ ...saved, ...invalid }).success, false);
});

test("Frame notification checks every BCH and prioritizes active display filters", () => {
  const preferences = receptionPreferencesSchema.parse({ filterInvalid: false, filterOrbitographic: false });
  assert.equal(frameNotification(frame(1, "EPIRB"), preferences), "ok");
  assert.equal(frameNotification(frame(1, "EPIRB", false), preferences), "ko");
  assert.equal(frameNotification(frame(2, "ELT", false), preferences), "ko");
  assert.equal(frameNotification(frame(1, "EPIRB", false), { ...preferences, filterInvalid: true }), "filtered");
  assert.equal(frameNotification(frame(2, "SYSTM", false), { ...preferences, filterOrbitographic: true }), "filtered");
  assert.equal(frameNotification(frame(1, "ORB"), { ...preferences, notifications: false, filterOrbitographic: true }), null);
});

test("Display filters are reversible, combine with OR and keep source frames unchanged", () => {
  const stored = [frame(1, "EPIRB"), frame(1, "EPIRB", false), frame(1, "ORB"), frame(2, "SYSTM"), frame(2, "PLB")];
  const original = JSON.stringify(stored);
  const preferences = receptionPreferencesSchema.parse({ filterInvalid: false, filterOrbitographic: false });
  const visible = (filterInvalid: boolean, filterOrbitographic: boolean) => stored.filter(item =>
    !isFrameFiltered(item, { ...preferences, filterInvalid, filterOrbitographic }));
  assert.equal(visible(true, false).length, 4);
  assert.deepEqual(visible(false, true).map(item => item.beaconType), ["EPIRB", "EPIRB", "PLB"]);
  assert.deepEqual(visible(true, true).map(item => item.beaconType), ["EPIRB", "PLB"]);
  assert.equal(visible(false, false).length, stored.length);
  assert.equal(JSON.stringify(stored), original);
});

test("Over-limit FGB corrections use the KO notification and display filter", () => {
  const preferences = receptionPreferencesSchema.parse({ filterInvalid: false, filterOrbitographic: false });
  const overLimit = { ...frame(1, "EPIRB"), correctionLimit: 2,
    bch: [{ valid: true, correctedErrors: 3 }] };
  assert.equal(frameNotification(overLimit, preferences), "ko");
  assert.equal(isFrameFiltered(overLimit, preferences), false);
  assert.equal(frameNotification(overLimit, { ...preferences, filterInvalid: true }), "filtered");
});

test("Countdown beeps once at 5/4/3/2/1 and counts up after expiry without auto reload", () => {
  const countdown = new FgbCountdown();
  countdown.start(1000, 50);
  assert.deepEqual(countdown.tick(1000, 50, false), { remaining: 50, elapsed: null, beep: null });
  assert.deepEqual(countdown.tick(45999, 50, false), { remaining: 6, elapsed: null, beep: null });
  for (const remaining of [5, 4, 3, 2, 1]) {
    const time = 51000 - remaining * 1000;
    assert.deepEqual(countdown.tick(time, 50, false), { remaining, elapsed: null, beep: remaining === 1 ? "counth" : "countl" });
    assert.deepEqual(countdown.tick(time + 500, 50, false), { remaining, elapsed: null, beep: null });
  }
  assert.deepEqual(countdown.tick(51000, 50, false), { remaining: null, elapsed: 0, beep: null });
  assert.deepEqual(countdown.tick(70000, 50, true), { remaining: null, elapsed: 19, beep: null });
});

test("Countdown restarts, stops and reloads without timer drift or catch-up beep bursts", () => {
  const countdown = new FgbCountdown();
  countdown.start(0, 50);
  countdown.start(48000, 50);
  assert.deepEqual(countdown.tick(49000, 50, true), { remaining: 49, elapsed: null, beep: null });
  assert.deepEqual(countdown.tick(98000, 50, true), { remaining: 50, elapsed: null, beep: null });
  assert.deepEqual(countdown.tick(249200, 50, true), { remaining: 49, elapsed: null, beep: null });
  countdown.stop();
  assert.deepEqual(countdown.tick(250000, 50, true), { remaining: null, elapsed: null, beep: null });
  countdown.start(0, 3);
  assert.deepEqual(countdown.tick(0, 3, true), { remaining: 3, elapsed: null, beep: "countl" });
  assert.deepEqual(countdown.tick(2000, 3, true), { remaining: 1, elapsed: null, beep: "counth" });
  assert.deepEqual(countdown.tick(3000, 3, true), { remaining: 3, elapsed: null, beep: "countl" });
});

test("Elapsed counter starts at zero and wraps from 999 to 0", () => {
  const countdown = new FgbCountdown();
  countdown.countUp(1000);
  assert.deepEqual(countdown.tick(1000, 50, true), { remaining: null, elapsed: 0, beep: null });
  assert.equal(countdown.tick(1999, 50, true).elapsed, 0);
  assert.equal(countdown.tick(2000, 50, true).elapsed, 1);
  assert.equal(countdown.tick(1000999, 50, true).elapsed, 999);
  assert.equal(countdown.tick(1001000, 50, true).elapsed, 0);
});

test("Reset counts up and suspends auto reload until the next FGB countdown", () => {
  const countdown = new FgbCountdown();
  countdown.start(0, 50);
  countdown.countUp(46000);
  assert.deepEqual(countdown.tick(46000, 50, true), { remaining: null, elapsed: 0, beep: null });
  assert.deepEqual(countdown.tick(55000, 50, true), { remaining: null, elapsed: 9, beep: null });
  countdown.start(56000, 50);
  assert.equal(countdown.tick(56000, 50, true).remaining, 50);
  assert.equal(countdown.tick(106000, 50, true).remaining, 50);
});
