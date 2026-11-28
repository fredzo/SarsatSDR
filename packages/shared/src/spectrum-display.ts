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

import type { SpectrumEvent } from "./protocol";

export const waterfallColors = [[0, 0, 0], [25, 9, 65], [29, 100, 215], [109, 182, 232],
  [255, 228, 67], [255, 144, 30], [231, 43, 48]] as const;
export const spectrumColors = {
  panel: "#000", background: "#001000", border: "#335555", separator: "#003333",
  fill: ["#e72b30", "#e72b30", "#ff901e", "#ffe443", "#6ea6f2", "#2052c800"],
  fillStops: [0, .25, .48, .64, .82, 1],
  grid: "#335555", labels: "#99baba", trace: "#00ffff",
};
export const candidateColors = ["#800040", "#ff8080", "#008000", "#ff0000", "#ff901e",
  "#ffe443", "#00ffff", "#6ea6f2", "#c080ff", "#ffffff"] as const;
export const waterfallBins = 1024, waterfallRows = 281, waterfallLineMs = 100;
export const waterfallVisibleRows = (speed: number) => 70 / speed;

export const detectionSegments = (detections: number, maximum: number) =>
  Math.min(10, Math.max(0, Math.ceil(detections * 10 / maximum)));

const shadesPerStop = 64;
const lastStop = waterfallColors.length - 1;
const waterfallPalette = Array.from({ length: lastStop * shadesPerStop + 1 }, (_, index) => {
  const position = index / shadesPerStop;
  const lower = Math.floor(position), fraction = position - lower;
  const from = waterfallColors[lower], to = waterfallColors[Math.min(lastStop, lower + 1)];
  return from.map((value, channel) => Math.round(value + fraction * (to[channel] - value)));
});

export class WaterfallBuffer {
  readonly levels = new Float32Array(waterfallBins * waterfallRows).fill(-240);
  readonly pixels = new Uint8Array(waterfallBins * waterfallRows * 4);
  head = 0;
  private base = 27;
  private range = 11;
  private calibration = 0;
  private automatic = false;
  private noiseFloor: number | null = null;
  private time: number | null = null;

  get noiseFloorDb() { return this.noiseFloor; }

  constructor() {
    for (let n = 3; n < this.pixels.length; n += 4) this.pixels[n] = 255;
  }

  private colorRow(row: number) {
    const offset = row * waterfallBins;
    for (let n = 0; n < waterfallBins; ++n) {
      const level = this.levels[offset + n];
      const position = this.automatic && this.noiseFloor !== null ? (level - this.noiseFloor) / 3
        : (level + this.calibration + 180) * (100 - this.range) / 600 - this.base / 10;
      const color = !Number.isFinite(level) || level <= -240 ? waterfallColors[0]
        : waterfallPalette[Math.round(Math.max(0, Math.min(lastStop, position)) * shadesPerStop)];
      const pixel = (offset + n) * 4;
      this.pixels[pixel] = color[0];
      this.pixels[pixel + 1] = color[1];
      this.pixels[pixel + 2] = color[2];
    }
  }

  push(values: ArrayLike<number>, timeSeconds = (this.time ?? 0) + .1) {
    const noise = Array.from(values).slice(waterfallBins / 4, waterfallBins * 3 / 4)
      .filter(value => Number.isFinite(value) && value > -240).sort((a, b) => a - b);
    if (noise.length) {
      const measured = noise[Math.floor(noise.length / 4)];
      const elapsed = this.time === null ? 0 : Math.max(0, Math.min(1, timeSeconds - this.time));
      if (this.noiseFloor === null) this.noiseFloor = measured;
      else if (measured < this.noiseFloor) this.noiseFloor += Math.min(1, elapsed / .5) * (measured - this.noiseFloor);
      // Slow upward tracking keeps a short broadband burst above the noise estimate.
      else this.noiseFloor += Math.min(measured - this.noiseFloor, elapsed * .2);
    }
    this.time = timeSeconds;
    const row = this.head;
    this.levels.set(values, row * waterfallBins);
    this.colorRow(row);
    this.head = (row + 1) % waterfallRows;
    return row;
  }

  recolor(base: number, range: number, calibration = 0, automatic = false) {
    this.base = base;
    this.range = range;
    this.calibration = calibration;
    this.automatic = automatic;
    for (let row = 0; row < waterfallRows; ++row) this.colorRow(row);
  }
}

export function averageSpectrum(line: SpectrumEvent, previous: number[], coefficient: number) {
  return line.dbfs.map((value, n) => {
    if (value === null) return -240;
    const level = value + line.displayOffsetDb;
    return previous[n] > -240 ? coefficient * level + (1 - coefficient) * previous[n] : level;
  });
}

export function persistSpectrum(levels: number[], previous: number[], elapsed: number, instantaneous = levels) {
  const release = Math.exp(-Math.max(0, elapsed) / .6);
  return levels.map((level, n) => {
    if (level <= -240 || previous[n] === undefined || previous[n] <= -240) return Math.max(level, instantaneous[n]);
    const target = Math.max(level, instantaneous[n]);
    const held = target + Math.max(0, previous[n] - target) * release;
    return held - target < .5 ? target : held;
  });
}

export const fftMinDb = -150, fftMaxDb = -110;

export function fftOrdinate(level: number, top: number, height: number) {
  return 12 + Math.max(0, Math.min(1, (top - level) / (top - fftMinDb))) * Math.max(0, height - 30);
}
