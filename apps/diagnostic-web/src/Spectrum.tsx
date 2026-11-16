import { useEffect, useRef, useState } from "react";
import type { SpectrumEvent, AcquisitionChannel } from "@sarsat/shared/protocol";
import { waterfallColors, candidateColors, waterfallIndex, averageSpectrum } from "@sarsat/shared/spectrum-display";

function shader(gl: WebGL2RenderingContext, type: number, source: string) {
  const result = gl.createShader(type);
  if (!result) throw new Error("Allocation shader waterfall impossible");
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(result);
    gl.deleteShader(result);
    throw new Error(`Shader waterfall : ${message}`);
  }
  return result;
}

export function Spectrum({ line, channels, centerHz, epoch, floor, range, average }: {
  line: SpectrumEvent | null; epoch: number; floor: number; range: number; average: number;
  channels: AcquisitionChannel[]; centerHz: number;
}) {
  const fft = useRef<HTMLCanvasElement>(null);
  const waterfall = useRef<HTMLCanvasElement>(null);
  const previous = useRef<number[]>([]);
  const latest = useRef<SpectrumEvent | null>(null);
  const markerLevels = useRef(new Map<number, { frequency: number; raw: number; level: number }>());
  const renderer = useRef<{ push: (values: Float32Array) => void; draw: () => void } | null>(null);
  const options = useRef({ floor, range });
  options.current = { floor, range };
  const [error, setError] = useState("");

  useEffect(() => {
    previous.current = [];
    latest.current = null;
    markerLevels.current.clear();
    const canvas = waterfall.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) { setError("WebGL2 indisponible : waterfall non affiche."); return; }
    let program: WebGLProgram | null = null;
    let texture: WebGLTexture | null = null;
    let head = 0;
    const history = new Float32Array(1024 * 70).fill(-240);
    const indices = new Uint8Array(1024 * 70);
    let appliedFloor = floor, appliedRange = range;
    try {
      const vertex = shader(gl, gl.VERTEX_SHADER, `#version 300 es
        out vec2 uv;
        void main() {
          vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
          uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
        }`);
      const fragment = shader(gl, gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        uniform highp usampler2D history;
        uniform int head;
        in vec2 uv; out vec4 color;
        const vec3 palette[7] = vec3[7](${waterfallColors.map(c => `vec3(${c.map(v => (v / 255).toFixed(9)).join(",")})`).join(",")});
        void main() {
          int row = (head + 69 - int(min(69.0, floor((1.0 - uv.y) * 70.0)))) % 70;
          int level = int(texelFetch(history, ivec2(int(min(1023.0, uv.x * 1024.0)), row), 0).r);
          color = vec4(palette[level], 1.0);
        }`);
      program = gl.createProgram();
      if (!program) throw new Error("Allocation programme waterfall impossible");
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "WebGL link failed");
      texture = gl.createTexture();
      if (!texture) throw new Error("Allocation texture waterfall impossible");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 1024, 70, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, indices);
      const activeProgram = program;
      const draw = () => {
        if (appliedFloor !== options.current.floor || appliedRange !== options.current.range) {
          appliedFloor = options.current.floor; appliedRange = options.current.range;
          for (let n = 0; n < history.length; ++n)
            indices[n] = waterfallIndex(history[n], appliedFloor, appliedRange);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, 70, gl.RED_INTEGER, gl.UNSIGNED_BYTE, indices);
        }
        const width = Math.max(1, Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2)));
        const height = Math.max(1, Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2)));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(activeProgram);
        gl.uniform1i(gl.getUniformLocation(activeProgram, "history"), 0);
        gl.uniform1i(gl.getUniformLocation(activeProgram, "head"), head);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      renderer.current = { draw, push(values) {
        history.set(values, head * 1024);
        const row = indices.subarray(head * 1024, (head + 1) * 1024);
        for (let n = 0; n < row.length; ++n) row[n] = waterfallIndex(values[n], appliedFloor, appliedRange);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, head, 1024, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, row);
        head = (head + 1) % 70;
        draw();
      } };
      draw();
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    const observer = new ResizeObserver(() => renderer.current?.draw());
    observer.observe(canvas);
    return () => {
      observer.disconnect(); renderer.current = null;
      if (texture) gl.deleteTexture(texture);
      if (program) gl.deleteProgram(program);
    };
  }, [epoch]);

  useEffect(() => { renderer.current?.draw(); }, [floor, range]);
  useEffect(() => {
    const canvas = fft.current;
    if (!canvas) return;
    const draw = () => {
      const ratio = Math.min(devicePixelRatio, 2);
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) { setError("Canvas 2D indisponible : spectre non affiche."); return; }
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
        ctx.fillText((406 + n / 100).toFixed(3), Math.max(40, Math.min(width - 49, x - 20)), height - 4);
      }
      ctx.setLineDash([]);
      if (previous.current.length) {
        ctx.strokeStyle = "#00ffff"; ctx.lineWidth = 1;
        ctx.beginPath();
        previous.current.forEach((value, n) => {
          const x = 40 + (n + .5) / 1024 * (width - 48);
          const y = ordinate(value);
          if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        for (const channel of channels) {
          const frequency = centerHz + channel.frequencyOffsetHz;
          const level = markerLevels.current.get(channel.channel)?.level;
          if (level === undefined || frequency < 406000000 || frequency > 406100000 || level < -150 || level > -70) continue;
          ctx.fillStyle = candidateColors[channel.channel];
          ctx.beginPath();
          ctx.arc(40 + (frequency - 406000000) / 100000 * (width - 48), ordinate(level), 5, 0, 2 * Math.PI);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = "#99baba"; ctx.fillText("En attente d'un flux I/Q reel", 55, 30);
      }
    };
    if (line && line !== latest.current) {
      latest.current = line;
      previous.current = averageSpectrum(line, previous.current, average);
      renderer.current?.push(new Float32Array(previous.current));
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
  }, [line, channels, centerHz, average, epoch]);

  return <section className="scope" aria-label="Spectre et waterfall 406 a 406,100 MHz">
    <div className="scope-title"><span>FFT <b>406.000 — 406.100 MHz</b></span><span>Niveau relatif · non calibree en dBm</span></div>
    <canvas ref={fft} className="fft" aria-label="Spectre FFT mesure" />
    <div className="waterfall-wrap"><span className="time-axis">0 s<br /><br /><br />−7 s</span>
      <canvas ref={waterfall} className="waterfall" aria-label="Waterfall GPU, historique de sept secondes" />
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="scope-foot"><span>406.000 MHz</span><span>406.050 MHz</span><span>406.100 MHz</span></div>
    <div className="candidate-legend" aria-label="Canaux FGB actifs">
      <span>Essais FGB actifs · avant validation BCH :</span>
      {channels.length ? channels.map(channel => <span key={channel.channel}
        data-channel={channel.channel} data-frequency-hz={centerHz + channel.frequencyOffsetHz}>
        <i style={{ backgroundColor: candidateColors[channel.channel] }} />
        {channel.channel + 1} · {((centerHz + channel.frequencyOffsetHz) / 1e6).toFixed(6)} MHz
      </span>) : <span>aucun</span>}
    </div>
  </section>;
}
