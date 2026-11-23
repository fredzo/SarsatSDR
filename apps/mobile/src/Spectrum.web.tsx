import { useEffect, useRef, useState } from "react";
import type { SpectrumEvent, AcquisitionChannel } from "@sarsat/shared/protocol";
import { candidateColors, averageSpectrum, WaterfallBuffer, waterfallBins as BINS, waterfallRows as ROWS,
  persistSpectrum, fftMinDb, fftMaxDb, fftOrdinate, spectrumColors as colors,
  waterfallLineMs, waterfallVisibleRows } from "@sarsat/shared/spectrum-display";
import { DetectionActivity } from "./DetectionActivity";

function shader(gl: WebGL2RenderingContext, type: number, source: string) {
  const result = gl.createShader(type);
  if (!result) throw new Error("Could not allocate waterfall shader");
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(result);
    gl.deleteShader(result);
    throw new Error(`Waterfall shader: ${message}`);
  }
  return result;
}

export function Spectrum({ line, channels, centerHz, epoch, floor, range, average, speed, automatic, calibrationDb, relative, sgbDetections, fgbDetections, compact = false }: {
  line: SpectrumEvent | null; epoch: number; floor: number; range: number; average: number;
  channels: AcquisitionChannel[]; centerHz: number; speed: number; automatic: boolean; calibrationDb: number; relative: boolean;
  sgbDetections: number; fgbDetections: number;
  compact?: boolean;
}) {
  const startHz = line?.startHz ?? centerHz - 50000;
  const bandwidthHz = line ? line.binWidthHz * line.dbfs.length : 100000;
  const frequencyLabel = (fraction: number) => ((startHz + fraction * bandwidthHz) / 1e6).toFixed(3);
  const fft = useRef<HTMLCanvasElement>(null);
  const waterfall = useRef<HTMLCanvasElement>(null);
  const previous = useRef<number[]>([]);
  const averagedTrace = useRef<number[]>([]);
  const latest = useRef<SpectrumEvent | null>(null);
  const markerLevels = useRef(new Map<number, { frequency: number; raw: number; level: number }>());
  const renderer = useRef<{ push: (values: Float32Array, timeSeconds: number) => void; draw: () => void } | null>(null);
  const options = useRef({ floor, range, speed, calibrationDb, automatic });
  options.current = { floor, range, speed, calibrationDb, automatic };
  const [error, setError] = useState("");
  const [noiseFloor, setNoiseFloor] = useState<number | null>(null);

  useEffect(() => {
    previous.current = [];
    averagedTrace.current = [];
    latest.current = null;
    markerLevels.current.clear();
    setNoiseFloor(null);
    const canvas = waterfall.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) { setError("WebGL2 unavailable: waterfall cannot be displayed."); return; }
    let program: WebGLProgram | null = null;
    let texture: WebGLTexture | null = null;
    const history = new WaterfallBuffer();
    history.recolor(floor, range, calibrationDb, automatic);
    let arrivedAt = -Infinity, animation = 0;
    let appliedFloor = floor, appliedRange = range, appliedCalibration = calibrationDb, appliedAutomatic = automatic;
    try {
      const vertex = shader(gl, gl.VERTEX_SHADER, `#version 300 es
        out vec2 uv;
        void main() {
          vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
          uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
        }`);
      const fragment = shader(gl, gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        uniform sampler2D history;
        uniform float head;
        uniform float visibleRows;
        uniform float progress;
        in vec2 uv; out vec4 color;
        void main() {
          float age = clamp((1.0 - uv.y) * visibleRows + 0.5 - progress, 0.0, ${ROWS - 1}.0);
          color = texture(history, vec2(uv.x, (head - 0.5 - age) / ${ROWS}.0));
        }`);
      program = gl.createProgram();
      if (!program) throw new Error("Could not allocate waterfall program");
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "WebGL link failed");
      texture = gl.createTexture();
      if (!texture) throw new Error("Could not allocate waterfall texture");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, BINS, ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, history.pixels);
      const activeProgram = program;
      const historyUniform = gl.getUniformLocation(activeProgram, "history");
      const headUniform = gl.getUniformLocation(activeProgram, "head");
      const rowsUniform = gl.getUniformLocation(activeProgram, "visibleRows");
      const progressUniform = gl.getUniformLocation(activeProgram, "progress");
      const draw = () => {
        if (appliedFloor !== options.current.floor || appliedRange !== options.current.range ||
            appliedCalibration !== options.current.calibrationDb || appliedAutomatic !== options.current.automatic) {
          appliedFloor = options.current.floor; appliedRange = options.current.range;
          appliedCalibration = options.current.calibrationDb; appliedAutomatic = options.current.automatic;
          history.recolor(appliedFloor, appliedRange, appliedCalibration, appliedAutomatic);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BINS, ROWS, gl.RGBA, gl.UNSIGNED_BYTE, history.pixels);
        }
        const width = Math.max(1, Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2)));
        const height = Math.max(1, Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2)));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(activeProgram);
        gl.uniform1i(historyUniform, 0);
        gl.uniform1f(headUniform, history.head);
        gl.uniform1f(rowsUniform, waterfallVisibleRows(options.current.speed));
        gl.uniform1f(progressUniform, Math.min(1, (performance.now() - arrivedAt) / waterfallLineMs));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      const animate = () => {
        draw();
        animation = performance.now() - arrivedAt < waterfallLineMs ? requestAnimationFrame(animate) : 0;
      };
      renderer.current = { draw, push(values, timeSeconds) {
        const row = history.push(values, timeSeconds);
        setNoiseFloor(history.noiseFloorDb);
        const pixels = history.pixels.subarray(row * BINS * 4, (row + 1) * BINS * 4);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, BINS, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        arrivedAt = performance.now();
        if (!animation) animation = requestAnimationFrame(animate);
      } };
      draw();
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    const observer = new ResizeObserver(() => renderer.current?.draw());
    observer.observe(canvas);
    return () => {
      observer.disconnect(); renderer.current = null;
      cancelAnimationFrame(animation);
      if (texture) gl.deleteTexture(texture);
      if (program) gl.deleteProgram(program);
    };
  }, [epoch]);

  useEffect(() => { renderer.current?.draw(); }, [floor, range, speed, calibrationDb, automatic]);
  useEffect(() => {
    const canvas = fft.current;
    if (!canvas) return;
    const draw = () => {
      const ratio = Math.min(devicePixelRatio, 2);
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) { setError("Canvas 2D unavailable: spectrum cannot be displayed."); return; }
      ctx.scale(ratio, ratio);
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (width <= 48 || height <= 30) return;
      ctx.font = "11px monospace";
      const top = fftMaxDb;
      const ordinate = (level: number) => fftOrdinate(level, top, height);
      const abscissa = (fraction: number) => 40 + fraction * (width - 48);
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, width, height);
      const trace = new Path2D();
      if (previous.current.length) {
        previous.current.forEach((value, n) => {
          const x = abscissa((n + .5) / BINS);
          const y = ordinate(value <= -240 ? value : value + calibrationDb);
          if (n === 0) trace.moveTo(x, y); else trace.lineTo(x, y);
        });
        const bottom = ordinate(fftMinDb);
        const area = new Path2D(trace);
        area.lineTo(abscissa((previous.current.length - .5) / BINS), bottom);
        area.lineTo(abscissa(.5 / BINS), bottom);
        area.closePath();
        const fill = ctx.createLinearGradient(0, ordinate(top), 0, bottom);
        colors.fill.forEach((color, n) => fill.addColorStop(colors.fillStops[n], color));
        ctx.fillStyle = fill;
        ctx.fill(area);
      }
      ctx.strokeStyle = colors.grid;
      ctx.fillStyle = colors.labels;
      ctx.setLineDash([3, 3]);
      const labelStep = compact && top - fftMinDb > 50 ? 20 : 10;
      for (let db = top; db >= fftMinDb; db -= 5) {
        const y = ordinate(db);
        ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(width - 8, y); ctx.stroke();
        if ((top - db) % labelStep === 0) ctx.fillText(String(db), 4, y + 4);
      }
      for (let n = 0; n <= 10; n++) {
        const x = abscissa(n / 10);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height - 19); ctx.stroke();
        if (!compact || n % 5 === 0)
          ctx.fillText(frequencyLabel(n / 10), Math.max(40, Math.min(width - 49, x - 20)), height - 4);
      }
      ctx.setLineDash([]);
      if (previous.current.length) {
        ctx.strokeStyle = colors.trace;
        ctx.stroke(trace);
        for (const channel of channels) {
          const frequency = centerHz + channel.frequencyOffsetHz;
          const held = markerLevels.current.get(channel.channel)?.level;
          if (held === undefined) continue;
          const level = held + calibrationDb;
          if (frequency < startHz || frequency > startHz + bandwidthHz || level < fftMinDb) continue;
          ctx.fillStyle = candidateColors[channel.channel];
          ctx.beginPath();
          ctx.arc(abscissa((frequency - startHz) / bandwidthHz), ordinate(level), 5, 0, 2 * Math.PI);
          ctx.fill();
        }
      } else {
        ctx.fillText("Waiting for an I/Q stream", 55, 30);
      }
    };
    if (line && line !== latest.current) {
      const elapsed = latest.current ? line.timeSeconds - latest.current.timeSeconds : 0;
      latest.current = line;
      averagedTrace.current = averageSpectrum(line, averagedTrace.current, average);
      previous.current = persistSpectrum(averagedTrace.current, previous.current, elapsed, averageSpectrum(line, [], 1));
      renderer.current?.push(new Float32Array(averagedTrace.current), line.timeSeconds);
    }
    // Hold the acquisition ordinate even if RTL AGC changes during the trial.
    if (line) {
      for (const slot of markerLevels.current.keys())
        if (!channels.some(channel => channel.channel === slot)) markerLevels.current.delete(slot);
      for (const channel of channels) {
        const held = markerLevels.current.get(channel.channel);
        if (!held || held.frequency !== channel.frequencyOffsetHz || held.raw !== channel.levelDbfs)
          markerLevels.current.set(channel.channel, { frequency: channel.frequencyOffsetHz,
            raw: channel.levelDbfs, level: channel.levelDbfs + line.displayOffsetDb });
      }
    }
    draw();
    const observer = new ResizeObserver(draw); observer.observe(canvas);
    return () => observer.disconnect();
  }, [line, channels, centerHz, average, calibrationDb, epoch, compact]);

  const mono = "Consolas,monospace";
  return <section style={{ margin: compact ? 0 : "0 18px", flex: compact ? 1 : undefined, minHeight: 0, display: "flex", flexDirection: "column", background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: 3, overflow: "hidden" }}
    aria-label={`Spectrum and waterfall ${frequencyLabel(0)} to ${frequencyLabel(1)} MHz`}>
    <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr auto 1fr", gap: compact ? 4 : 0, alignItems: "center", justifyItems: compact ? "center" : undefined, padding: compact ? "5px 4px" : "9px 12px", font: `10px ${mono}`, background: colors.background, color: colors.trace }}>
      {!compact && <span>FFT <b style={{ marginLeft: 10 }}>{frequencyLabel(0)} — {frequencyLabel(1)} MHz</b></span>}
      <div style={{ display: "flex" }}>
        <DetectionActivity generation="FGB" detections={fgbDetections} />
        <DetectionActivity generation="SGB" detections={sgbDetections} />
      </div>
      {!compact && <span style={{ textAlign: "right" }}>{relative ? "Relative level · WAV" : `Estimated dBm · offset ${calibrationDb.toFixed(1)} dB`}</span>}</div>
    <div style={{ position: "relative", flex: compact ? 64 : "0 0 230px", minHeight: 0 }}>
      <canvas ref={fft} style={{ display: "block", position: "absolute", width: "100%", height: "100%" }} aria-label="Measured FFT spectrum" />
    </div>
    <div style={{ display: "flex", flex: compact ? 36 : undefined, minHeight: 0, borderTop: `1px solid ${colors.separator}`, background: "#000" }}>
      <span style={{ width: 40, padding: "8px 3px", boxSizing: "border-box", color: colors.labels, font: `9px ${mono}`,
        display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <span>0 s</span><span>−{Number((7 / speed).toFixed(2))}s</span></span>
      <canvas ref={waterfall} style={{ display: "block", width: "calc(100% - 48px)", height: compact ? "100%" : 180, minHeight: 0 }}
        aria-label={`GPU waterfall, ${(7 / speed).toFixed(2)} seconds of history`} />
    </div>
    {error && <p role="alert" style={{ background: "#330f0f", color: "#ff8484", padding: 12, margin: 0 }}>{error}</p>}
    {!compact && <><div style={{ display: "flex", justifyContent: "space-between", font: `10px ${mono}`, color: colors.labels, padding: "6px 9px 6px 40px" }}>
      {[0, .5, 1].map(f => <span key={f}>{frequencyLabel(f)} MHz</span>)}</div>
    <div style={{ padding: "6px 12px", color: "#ffffff", fontSize: 10 }}>
      {automatic ? `WF Auto · noise ${noiseFloor === null ? "—" : (noiseFloor + calibrationDb).toFixed(1)} ${relative ? "relative dB" : "dBm"} · 18 dB color span`
        : "Manual WF · higher Base = darker background; higher Range = lower contrast"}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "8px 12px", background: colors.background, color: "#ffffff", fontSize: 10 }} aria-label="Active FGB channels">
      <span>Active FGB trials · before BCH validation:</span>
      {channels.length ? channels.map(channel => <span key={channel.channel} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
        data-channel={channel.channel} data-frequency-hz={centerHz + channel.frequencyOffsetHz}>
        <i style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: candidateColors[channel.channel] }} />
        {channel.channel + 1} · {((centerHz + channel.frequencyOffsetHz) / 1e6).toFixed(3)} MHz
      </span>) : <span>none</span>}
    </div></>}
  </section>;
}
