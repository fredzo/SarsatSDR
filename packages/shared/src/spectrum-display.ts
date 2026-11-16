import type { SpectrumEvent } from "./protocol";

export const waterfallColors = [[0, 0, 0], [89, 0, 159], [0, 105, 201], [1, 217, 63],
  [240, 236, 0], [255, 139, 0], [219, 43, 40]] as const;
export const candidateColors = ["#800040", "#ff8080", "#008000", "#ff0000"] as const;
export const waterfallBins = 1024, waterfallRows = 281, waterfallLineMs = 100;
export const waterfallVisibleRows = (speed: number) => 70 / speed;

export class WaterfallBuffer {
  readonly levels = new Float32Array(waterfallBins * waterfallRows).fill(-240);
  readonly pixels = new Uint8Array(waterfallBins * waterfallRows * 4);
  head = 0;
  private base = 27;
  private range = 11;

  constructor() {
    for (let n = 3; n < this.pixels.length; n += 4) this.pixels[n] = 255;
  }

  private colorRow(row: number) {
    const offset = row * waterfallBins;
    for (let n = 0; n < waterfallBins; ++n) {
      const color = waterfallColors[waterfallIndex(this.levels[offset + n], this.base, this.range)];
      const pixel = (offset + n) * 4;
      this.pixels[pixel] = color[0];
      this.pixels[pixel + 1] = color[1];
      this.pixels[pixel + 2] = color[2];
    }
  }

  push(values: ArrayLike<number>) {
    const row = this.head;
    this.levels.set(values, row * waterfallBins);
    this.colorRow(row);
    this.head = (row + 1) % waterfallRows;
    return row;
  }

  recolor(base: number, range: number) {
    this.base = base;
    this.range = range;
    for (let row = 0; row < waterfallRows; ++row) this.colorRow(row);
  }
}

function roundEven(value: number) {
  const lower = Math.floor(value), fraction = value - lower;
  return fraction === .5 ? lower + (lower % 2 === 0 ? 0 : 1) : Math.round(value);
}

export function waterfallIndex(level: number, base: number, range: number) {
  // Two round-to-even operations precede the seven-color lookup.
  return Math.max(0, Math.min(6, roundEven((roundEven(level) + 180) * (100 - range) / 600 - base / 10)));
}

export function averageSpectrum(line: SpectrumEvent, previous: number[], coefficient: number) {
  return line.dbfs.map((value, n) => {
    if (value === null) return -240;
    const level = value + line.displayOffsetDb;
    return previous.length ? coefficient * level + (1 - coefficient) * previous[n] : level;
  });
}
