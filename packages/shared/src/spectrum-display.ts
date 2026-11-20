import type { SpectrumEvent } from "./protocol";

export const waterfallColors = [[0, 0, 0], [25, 9, 65], [29, 100, 215], [109, 182, 232],
  [255, 228, 67], [255, 144, 30], [231, 43, 48]] as const;
export const spectrumColors = {
  panel: "#000", background: "#001000", border: "#335555", separator: "#003333",
  fill: ["#e72b30", "#e72b30", "#ff901e", "#ffe443", "#6ea6f2", "#2052c800"],
  fillStops: [0, .25, .48, .64, .82, 1],
  grid: "#335555", labels: "#99baba", trace: "#00ffff",
};
export const candidateColors = ["#800040", "#ff8080", "#008000", "#ff0000"] as const;
export const waterfallBins = 1024, waterfallRows = 281, waterfallLineMs = 100;
export const waterfallVisibleRows = (speed: number) => 70 / speed;

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

export function persistSpectrum(levels: number[], previous: number[], elapsed: number) {
  const drop = Math.max(0, elapsed) * 30;
  return levels.map((level, n) => level > -240 && previous[n] > -240
    ? Math.max(level, previous[n] - drop) : level);
}

export const fftMinDb = -150;

export function fftTopDb(trace: number[], calibrationDb: number) {
  const peak = trace.reduce((max, level) => level > -240 ? Math.max(max, level + calibrationDb) : max, -110);
  return Math.ceil(peak / 5) * 5;
}

export function fftOrdinate(level: number, top: number, height: number) {
  return 12 + Math.max(0, Math.min(1, (top - level) / (top - fftMinDb))) * Math.max(0, height - 30);
}
