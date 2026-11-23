import { test } from "node:test";
import assert from "node:assert/strict";
import { averageSpectrum, persistSpectrum, fftMaxDb, fftOrdinate, WaterfallBuffer, waterfallBins, waterfallRows } from "@sarsat/shared/spectrum-display";
import { nativeEventSchema, type SpectrumEvent } from "@sarsat/shared/protocol";

test("Waterfall interpolates fractional levels instead of snapping to seven colors", () => {
  const buffer = new WaterfallBuffer();
  buffer.recolor(0, 0);
  buffer.push(Array.from({ length: waterfallBins }, (_, n) => -180 + n / 2));
  const blue = (n: number) => buffer.pixels[n * 4 + 2];
  assert.ok(blue(0) < blue(1) && blue(1) < blue(2) && blue(2) < blue(12));
  assert.deepEqual([...buffer.pixels.subarray(48, 52)], [25, 9, 65, 255]);
});

test("Display applies native display offset before averaging, without coloring unavailable frequencies", () => {
  const line: SpectrumEvent = { type: "spectrum", timeSeconds: .1, startHz: 406000000,
    binWidthHz: 97.65625, displayOffsetDb: -80, fullBandwidthDbm: null, dbfs: Array<number | null>(1024).fill(-60) };
  line.dbfs[0] = null;
  const first = averageSpectrum(line, [], .5);
  assert.equal(first[1], -140);
  const next = averageSpectrum(line, Array<number>(1024).fill(-150), .9);
  assert.equal(next[1], -141);
  assert.equal(next[0], -240);
});

test("FFT clips strong and calibrated peaks at -110 dB without moving quieter ordinates", () => {
  const height = 230, ceiling = fftOrdinate(-110, fftMaxDb, height);
  for (const peak of [-110, -104, -60, -52])
    assert.equal(fftOrdinate(peak, fftMaxDb, height), ceiling);
  assert.ok(fftOrdinate(-130, fftMaxDb, height) > ceiling);
  assert.ok(fftOrdinate(-150, fftMaxDb, height) > fftOrdinate(-130, fftMaxDb, height));
});

test("FFT attacks immediately, then returns near noise in about three seconds regardless of update cadence", () => {
  const peak = persistSpectrum([-104, -131], [-130, -132], .1);
  assert.deepEqual(peak, [-104, -131]);
  assert.equal(persistSpectrum([-133, -240], peak, .1)[1], -240);
  assert.equal(persistSpectrum([-130], [-140], .1, [-100])[0], -100, "Averaging must not hide a new burst");
  for (const step of [.05, .1, .2]) {
    let trace = [-90];
    for (let n = 0; n < Math.round(1 / step); n++) trace = persistSpectrum([-140], trace, step);
    assert.ok(trace[0] > -138 && trace[0] < -130, "Peak remains visible after one second");
    for (let n = 0; n < Math.round(1 / step); n++) trace = persistSpectrum([-140], trace, step);
    assert.ok(trace[0] > -139.5, "Release now lasts longer than two seconds");
    for (let n = 0; n < Math.round(1 / step); n++) trace = persistSpectrum([-140], trace, step);
    assert.ok(trace[0] <= -139.5, "Peak has returned to noise after three seconds");
    assert.ok(trace[0] >= -140, "Release never overshoots below noise");
  }
  assert.deepEqual(persistSpectrum([-140], [-100], 0), [-100]);
  assert.deepEqual(persistSpectrum([-140], [-100], 5), [-140]);
  const line: SpectrumEvent = { type: "spectrum", timeSeconds: 0, startHz: 406000000,
    binWidthHz: 97.65625, displayOffsetDb: -80, fullBandwidthDbm: null, dbfs: Array(1024).fill(-60) };
  let averaged = averageSpectrum(line, [], .5), trace = averaged;
  line.dbfs.fill(-10);
  averaged = averageSpectrum(line, averaged, .5);
  trace = persistSpectrum(averaged, trace, .1, averageSpectrum(line, [], 1));
  assert.equal(trace[0], -90, "Real display pipeline attacks in one spectrum update");
  line.dbfs.fill(-60);
  for (let n = 0; n < 30; n++) {
    averaged = averageSpectrum(line, averaged, .5);
    trace = persistSpectrum(averaged, trace, .1, averageSpectrum(line, [], 1));
  }
  assert.ok(trace[0] <= -139.5, "Averaged display pipeline returns to noise within three seconds");
});

test("Manual calibration recolors existing history without coloring missing bins", () => {
  const buffer = new WaterfallBuffer();
  const levels = Array<number>(waterfallBins).fill(-140);
  levels[0] = -240;
  buffer.push(levels);
  const red = buffer.pixels[4];
  buffer.recolor(27, 11, 7);
  assert.deepEqual([...buffer.pixels.subarray(0, 4)], [0, 0, 0, 255]);
  assert.ok(buffer.pixels[4] > red);
  assert.equal(buffer.head, 1);
  assert.equal(buffer.levels[1], -140);
  buffer.recolor(27, 11, 100);
  assert.deepEqual([...buffer.pixels.subarray(waterfallBins * 4, waterfallBins * 4 + 4)], [0, 0, 0, 255]);
});

test("Automatic waterfall keeps quiet noise dark and does not track a broadband frame away", () => {
  const buffer = new WaterfallBuffer();
  buffer.recolor(27, 11, 0, true);
  const noise = Array.from({ length: waterfallBins }, (_, n) => -141 + n % 3);
  buffer.push(noise, .1);
  const floor = buffer.noiseFloorDb!;
  assert.deepEqual([...buffer.pixels.subarray(0, 4)], [0, 0, 0, 255]);
  assert.ok(buffer.pixels[10] > buffer.pixels[2], "Auto mode also shades intermediate levels");
  const burst = noise.map(value => value + 18);
  for (let n = 2; n <= 8; ++n) buffer.push(burst, n / 10);
  assert.ok(buffer.noiseFloorDb! - floor <= .15, "A short broadband burst must not become the estimated noise floor");
  assert.deepEqual([...buffer.pixels.subarray(waterfallBins * 4, waterfallBins * 4 + 4)], [231, 43, 48, 255]);
  buffer.push(noise, .9);
  buffer.recolor(27, 11, 0, true);
  const before = buffer.pixels.slice();
  buffer.recolor(27, 11, 20, true);
  assert.ok(buffer.pixels.every((value, n) => value === before[n]), "RF calibration must not change relative automatic contrast");
  buffer.recolor(27, 11);
  assert.notDeepEqual(buffer.pixels.subarray(0, 4), before.subarray(0, 4), "Manual mode restores absolute colors");
});

test("Waterfall updates one ring row at a time and wraps without losing older lines", () => {
  const buffer = new WaterfallBuffer();
  const blue = Array<number>(waterfallBins).fill(-140);
  const orange = Array<number>(waterfallBins).fill(-130);
  const untouched = buffer.pixels.slice(waterfallBins * 4);
  assert.equal(buffer.push(blue), 0);
  const first = buffer.pixels.slice(0, 4);
  assert.deepEqual(buffer.pixels.subarray(waterfallBins * 4), untouched);
  for (let n = 1; n < waterfallRows; ++n) buffer.push(orange);
  assert.equal(buffer.head, 0);
  assert.equal(buffer.push(orange), 0);
  assert.equal(buffer.head, 1);
  assert.notDeepEqual(buffer.pixels.subarray(0, 4), first);
  assert.deepEqual(buffer.pixels.subarray(0, 4), buffer.pixels.subarray(waterfallBins * 4, waterfallBins * 4 + 4));
});

test("Waterfall recolors stored history without resetting chronology or painting missing rows", () => {
  const buffer = new WaterfallBuffer();
  buffer.push(Array<number>(waterfallBins).fill(-140));
  buffer.push(Array<number>(waterfallBins).fill(-160));
  const levels = buffer.levels.slice();
  buffer.recolor(0, 0);
  assert.equal(buffer.head, 2);
  assert.deepEqual(buffer.levels, levels);
  assert.deepEqual([...buffer.pixels.subarray(0, 4)], [231, 43, 48, 255]);
  assert.deepEqual([...buffer.pixels.subarray(waterfallBins * 8, waterfallBins * 8 + 4)], [0, 0, 0, 255]);
});

test("Acquisition telemetry accepts ten FGB candidates and rejects extra channels, duplicates and invalid levels", () => {
  const channel = { channel: 0, frequencyOffsetHz: -24975, levelDbfs: -50 };
  assert.equal(nativeEventSchema.safeParse({ type: "acquisition", channels: [channel] }).success, true);
  const simultaneous = Array.from({ length: 10 }, (_, n) =>
    ({ ...channel, channel: n, frequencyOffsetHz: -27000 + 6000 * n }));
  assert.equal(nativeEventSchema.safeParse({ type: "acquisition", channels: simultaneous }).success, true);
  for (const channels of [[channel, channel], [{ ...channel, channel: 10 }],
    [{ ...channel, levelDbfs: Infinity }], [...simultaneous, channel]])
    assert.equal(nativeEventSchema.safeParse({ type: "acquisition", channels }).success, false);
  assert.equal(nativeEventSchema.safeParse({ type: "fmAudio", channel: 9, pcm: "AAA=" }).success, true);
  assert.equal(nativeEventSchema.safeParse({ type: "fmAudio", channel: 10, pcm: "AAA=" }).success, false);
});
