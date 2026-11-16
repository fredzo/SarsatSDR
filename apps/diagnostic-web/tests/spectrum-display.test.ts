import { test } from "node:test";
import assert from "node:assert/strict";
import { averageSpectrum, waterfallIndex, WaterfallBuffer, waterfallBins, waterfallRows } from "@sarsat/shared/spectrum-display";
import { nativeEventSchema, type SpectrumEvent } from "@sarsat/shared/protocol";

test("Waterfall uses discrete thresholds and round-to-even", () => {
  for (const [level, expected] of [[-200, 0], [-159, 0], [-158, 1], [-152, 1],
    [-151, 2], [-145, 2], [-144, 3], [-138, 4], [-131, 5], [-124, 6], [0, 6]])
    assert.equal(waterfallIndex(level, 27, 11), expected, String(level));
  assert.equal(waterfallIndex(-149.5, 5, 0), 4);
  assert.equal(waterfallIndex(-148.5, 5, 0), 5);
  assert.equal(waterfallIndex(-150, 15, 0), 4);
  assert.equal(waterfallIndex(0, 27, 100), 0);
});

test("Display applies native display offset before averaging, without coloring unavailable frequencies", () => {
  const line: SpectrumEvent = { type: "spectrum", timeSeconds: .1, startHz: 406000000,
    binWidthHz: 97.65625, displayOffsetDb: -80, dbfs: Array<number | null>(1024).fill(-60) };
  line.dbfs[0] = null;
  const first = averageSpectrum(line, [], .5);
  assert.equal(first[1], -140);
  const next = averageSpectrum(line, Array<number>(1024).fill(-150), .9);
  assert.equal(next[1], -141);
  assert.equal(waterfallIndex(next[0], 27, 11), 0);
});

test("Waterfall updates one ring row at a time and wraps without losing older lines", () => {
  const buffer = new WaterfallBuffer();
  const green = Array<number>(waterfallBins).fill(-140);
  const orange = Array<number>(waterfallBins).fill(-130);
  const untouched = buffer.pixels.slice(waterfallBins * 4);
  assert.equal(buffer.push(green), 0);
  assert.deepEqual([...buffer.pixels.subarray(0, 4)], [1, 217, 63, 255]);
  assert.deepEqual(buffer.pixels.subarray(waterfallBins * 4), untouched);
  for (let n = 1; n < waterfallRows; ++n) buffer.push(orange);
  assert.equal(buffer.head, 0);
  assert.equal(buffer.push(orange), 0);
  assert.equal(buffer.head, 1);
  assert.deepEqual([...buffer.pixels.subarray(0, 4)], [255, 139, 0, 255]);
  assert.deepEqual([...buffer.pixels.subarray(waterfallBins * 4, waterfallBins * 4 + 4)], [255, 139, 0, 255]);
});

test("Waterfall recolors stored history without resetting chronology or painting missing rows", () => {
  const buffer = new WaterfallBuffer();
  buffer.push(Array<number>(waterfallBins).fill(-140));
  buffer.push(Array<number>(waterfallBins).fill(-160));
  const levels = buffer.levels.slice();
  buffer.recolor(0, 11);
  assert.equal(buffer.head, 2);
  assert.deepEqual(buffer.levels, levels);
  assert.deepEqual([...buffer.pixels.subarray(0, 4)], [219, 43, 40, 255]);
  assert.deepEqual([...buffer.pixels.subarray(waterfallBins * 8, waterfallBins * 8 + 4)], [0, 0, 0, 255]);
});

test("Acquisition telemetry rejects invented extra channels, duplicates and invalid levels", () => {
  const channel = { channel: 0, frequencyOffsetHz: -24975, levelDbfs: -50 };
  assert.equal(nativeEventSchema.safeParse({ type: "acquisition", channels: [channel] }).success, true);
  for (const channels of [[channel, channel], [{ ...channel, channel: 4 }],
    [{ ...channel, levelDbfs: Infinity }], Array(5).fill(channel)])
    assert.equal(nativeEventSchema.safeParse({ type: "acquisition", channels }).success, false);
});
