import { useEffect, useRef, useState } from "react";
import type { SpectrumEvent, AcquisitionChannel } from "@sarsat/shared/protocol";
import { candidateColors, averageSpectrum, WaterfallBuffer, waterfallBins as BINS, waterfallRows as ROWS,
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

export function Spectrum({ line, channels, centerHz, epoch, floor, range, average, speed, automatic, calibrationDb, relative, sgbDetections, fgbDetections, compact = false, height }: {
  line: SpectrumEvent | null; epoch: number; floor: number; range: number; average: number;
  channels: AcquisitionChannel[]; centerHz: number; speed: number; automatic: boolean; calibrationDb: number; relative: boolean;
  sgbDetections: number; fgbDetections: number;
  compact?: boolean; height?: number;
}) {
  const fft = useRef<HTMLCanvasElement>(null);
  const waterfall = useRef<HTMLCanvasElement>(null);
  const previous = useRef<number[]>([]);
  const latest = useRef<SpectrumEvent | null>(null);
  const markerLevels = useRef(new Map<number, { frequency: number; raw: number; level: number }>());
  const renderer = useRef<{ push: (values: Float32Array, timeSeconds: number) => void; draw: () => void } | null>(null);
  const options = useRef({ floor, range, speed, calibrationDb, automatic });
  options.current = { floor, range, speed, calibrationDb, automatic };
  const [error, setError] = useState("");
  const [noiseFloor, setNoiseFloor] = useState<number | null>(null);

  useEffect(() => {
    previous.current = [];
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
        uniform int head;
        uniform float visibleRows;
        uniform float progress;
        in vec2 uv; out vec4 color;
        void main() {
          int age = int(floor((1.0 - uv.y) * visibleRows + 1.0 - progress));
          int row = (head + ${ROWS - 1} - age) % ${ROWS};
          color = texelFetch(history, ivec2(int(min(${BINS - 1}.0, uv.x * ${BINS}.0)), row), 0);
        }`);
      program = gl.createProgram();
      if (!program) throw new Error("Could not allocate waterfall program");
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "WebGL link failed");
      texture = gl.createTexture();
      if (!texture) throw new Error("Could not allocate waterfall texture");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
        gl.uniform1i(headUniform, history.head);
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
      ctx.fillStyle = "#001000"; ctx.fillRect(0, 0, width, height);
      ctx.font = "11px monospace";
      const ordinate = (level: number) => 12 + Math.max(0, Math.min(80, -70 - level)) / 80 * (height - 30);
      ctx.setLineDash([3, 3]);
      for (let db = -150; db <= -70; db += 5) {
        const y = ordinate(db);
        ctx.strokeStyle = "#335555"; ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(width - 8, y); ctx.stroke();
        ctx.fillStyle = "#99baba"; ctx.fillText(String(db), 4, y + 4);
      }
      for (let n = 0; n <= 10; n++) {
        const x = 40 + n / 10 * (width - 48);
        ctx.strokeStyle = "#335555";
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height - 19); ctx.stroke();
        ctx.fillStyle = "#99baba";
        if (!compact || n % 5 === 0)
          ctx.fillText((406 + n / 100).toFixed(3), Math.max(40, Math.min(width - 49, x - 20)), height - 4);
      }
      ctx.setLineDash([]);
      if (previous.current.length) {
        ctx.strokeStyle = "#00ffff"; ctx.lineWidth = 1;
        ctx.beginPath();
        previous.current.forEach((value, n) => {
          const x = 40 + (n + .5) / 1024 * (width - 48);
          const y = ordinate(value <= -240 ? value : value + calibrationDb);
          if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        for (const channel of channels) {
          const frequency = centerHz + channel.frequencyOffsetHz;
          const held = markerLevels.current.get(channel.channel)?.level;
          if (held === undefined) continue;
          const level = held + calibrationDb;
          if (frequency < 406000000 || frequency > 406100000 || level < -150 || level > -70) continue;
          ctx.fillStyle = candidateColors[channel.channel];
          ctx.beginPath();
          ctx.arc(40 + (frequency - 406000000) / 100000 * (width - 48), ordinate(level), 5, 0, 2 * Math.PI);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = "#99baba"; ctx.fillText("Waiting for an I/Q stream", 55, 30);
      }
    };
    if (line && line !== latest.current) {
      latest.current = line;
      previous.current = averageSpectrum(line, previous.current, average);
      renderer.current?.push(new Float32Array(previous.current), line.timeSeconds);
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
  return <section style={{ margin: compact ? 0 : "0 18px", height: compact ? height : undefined, display: "flex", flexDirection: "column", background: "#000", border: "1px solid #335555", borderRadius: 3, overflow: "hidden" }}
    aria-label="Spectrum and waterfall 406 to 406.100 MHz">
    <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr auto 1fr", gap: compact ? 4 : 0, alignItems: "center", justifyItems: compact ? "center" : undefined, padding: compact ? "5px 4px" : "9px 12px", font: `10px ${mono}`, background: "#001000", color: "#00ffff" }}>
      <span>FFT <b style={{ marginLeft: 10 }}>406.000 — 406.100 MHz</b></span>
      <div style={{ display: "flex" }}>
        <DetectionActivity generation="FGB" detections={fgbDetections} />
        <DetectionActivity generation="SGB" detections={sgbDetections} />
      </div>
      <span style={{ textAlign: "right" }}>{relative ? "Relative level · WAV" : `Estimated dBm · offset ${calibrationDb.toFixed(1)} dB`}</span></div>
    <canvas ref={fft} style={{ display: "block", width: "100%", height: compact ? Math.max(70, ((height ?? 400) - 80) * .52) : 230, flexShrink: 0 }} aria-label="Measured FFT spectrum" />
    <div style={{ display: "flex", flex: compact ? 1 : undefined, minHeight: 0, borderTop: "1px solid #003333" }}>
      <span style={{ width: 40, padding: "8px 3px", boxSizing: "border-box", color: "#99baba", font: `9px ${mono}`,
        display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <span>0 s</span><span>−{Number((7 / speed).toFixed(2))}s</span></span>
      <canvas ref={waterfall} style={{ display: "block", width: "calc(100% - 48px)", height: compact ? "100%" : 180, minHeight: 0 }}
        aria-label={`GPU waterfall, ${(7 / speed).toFixed(2)} seconds of history`} />
    </div>
    {error && <p role="alert" style={{ background: "#330f0f", color: "#ff8484", padding: 12, margin: 0 }}>{error}</p>}
    {!compact && <><div style={{ display: "flex", justifyContent: "space-between", font: `10px ${mono}`, color: "#99baba", padding: "6px 9px 6px 40px" }}>
      <span>406.000 MHz</span><span>406.050 MHz</span><span>406.100 MHz</span></div>
    <div style={{ padding: "6px 12px", color: "#ffffff", fontSize: 10 }}>
      {automatic ? `WF Auto · noise ${noiseFloor === null ? "—" : (noiseFloor + calibrationDb).toFixed(1)} ${relative ? "relative dB" : "dBm"} · 3 dB/color`
        : "Manual WF · higher Base = darker background; higher Range = lower contrast"}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "8px 12px", background: "#001000", color: "#ffffff", fontSize: 10 }} aria-label="Active FGB channels">
      <span>Active FGB trials · before BCH validation:</span>
      {channels.length ? channels.map(channel => <span key={channel.channel} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
        data-channel={channel.channel} data-frequency-hz={centerHz + channel.frequencyOffsetHz}>
        <i style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: candidateColors[channel.channel] }} />
        {channel.channel + 1} · {((centerHz + channel.frequencyOffsetHz) / 1e6).toFixed(6)} MHz
      </span>) : <span>none</span>}
    </div></>}
  </section>;
}
