import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View, StyleSheet, type LayoutChangeEvent } from "react-native";
import { AlphaType, Canvas, Circle, ColorType, DashPathEffect, Fill, FilterMode, ImageShader, MipmapMode,
  Path, Shader, Skia, Text as SkiaText, matchFont, type SkImage } from "@shopify/react-native-skia";
import type { SpectrumEvent, AcquisitionChannel } from "@sarsat/shared/protocol";
import { candidateColors, averageSpectrum, WaterfallBuffer, waterfallBins as BINS, waterfallRows as ROWS,
  waterfallLineMs, waterfallVisibleRows } from "@sarsat/shared/spectrum-display";
import { DetectionActivity } from "./DetectionActivity";

const font = matchFont({ fontFamily: "monospace", fontSize: 11 });
const waterfallShader = Skia.RuntimeEffect.Make(`
  uniform shader history;
  uniform float head;
  uniform float width;
  uniform float rowHeight;
  uniform float progress;
  half4 main(float2 p) {
    float age = floor(p.y / rowHeight + 1.0 - progress);
    float row = mod(head + ${ROWS - 1}.0 - age, ${ROWS}.0);
    return history.eval(float2(p.x * ${BINS}.0 / width, row + 0.5));
  }
`);

type WaterfallFrame = { image: SkImage; head: number; arrivedAt: number };

function Waterfall({ frame, width, speed, height }: { frame: WaterfallFrame | null; width: number; speed: number; height: number }) {
  const [now, setNow] = useState(() => performance.now());
  const arrivedAt = frame?.arrivedAt ?? -Infinity;
  useEffect(() => {
    let animation = 0;
    const animate = (time: number) => {
      setNow(time);
      if (time - arrivedAt < waterfallLineMs) animation = requestAnimationFrame(animate);
    };
    if (Number.isFinite(arrivedAt)) animation = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(animation); };
  }, [arrivedAt]);

  // Texture, ring head and fractional row must reach Skia in the same commit.
  const progress = Math.max(0, Math.min(1, (now - arrivedAt) / waterfallLineMs));
  return <Canvas style={{ width, height }}>
    {frame && waterfallShader && <Fill><Shader source={waterfallShader} uniforms={{
      head: frame.head, width: Math.max(1, width), rowHeight: height / waterfallVisibleRows(speed), progress,
    }}><ImageShader image={frame.image} tx="clamp" ty="repeat" fit="none"
      sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }} /></Shader></Fill>}
  </Canvas>;
}

export function Spectrum({ line, channels, centerHz, epoch, floor, range, average, speed, automatic, calibrationDb, relative, sgbDetections, fgbDetections, compact = false, height }: {
  line: SpectrumEvent | null; epoch: number; floor: number; range: number; average: number;
  channels: AcquisitionChannel[]; centerHz: number; speed: number; automatic: boolean; calibrationDb: number; relative: boolean;
  sgbDetections: number; fgbDetections: number;
  compact?: boolean; height?: number;
}) {
  const fftHeight = compact ? Math.max(70, ((height ?? 400) - 60) * .52) : 230;
  const waterfallHeight = compact ? Math.max(30, (height ?? 400) - fftHeight - 60) : 180;
  const [width, setWidth] = useState(0);
  const [trace, setTrace] = useState<number[]>([]);
  const [frame, setFrame] = useState<WaterfallFrame | null>(null);
  const [error, setError] = useState("");
  const [noiseFloor, setNoiseFloor] = useState<number | null>(null);
  const arrivedAt = useRef(-Infinity);
  const latest = useRef<SpectrumEvent | null>(null);
  const markerLevels = useRef(new Map<number, { frequency: number; raw: number; level: number }>());
  const history = useRef<WaterfallBuffer | null>(null);

  const upload = () => {
    if (!history.current) return;
    try {
      const updated = Skia.Image.MakeImage({ width: BINS, height: ROWS,
        alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 },
        Skia.Data.fromBytes(history.current.pixels), BINS * 4);
      if (!updated) throw new Error("Could not allocate waterfall image");
      setFrame({ image: updated, head: history.current.head, arrivedAt: arrivedAt.current });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    latest.current = null;
    markerLevels.current.clear();
    history.current = new WaterfallBuffer();
    arrivedAt.current = -Infinity;
    setError(!waterfallShader ? "Could not compile waterfall shader" : "");
    setFrame(null);
    setTrace([]);
    setNoiseFloor(null);
  }, [epoch]);
  useEffect(() => { history.current?.recolor(floor, range, calibrationDb, automatic); upload(); }, [floor, range, calibrationDb, automatic, epoch]);

  useEffect(() => {
    if (!line || line === latest.current) return;
    latest.current = line;
    const averaged = averageSpectrum(line, trace, average);
    history.current?.push(averaged, line.timeSeconds);
    setNoiseFloor(history.current?.noiseFloorDb ?? null);
    arrivedAt.current = performance.now();
    setTrace(averaged);
    upload();
  }, [line]);

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

  const plot = width - 48;
  const ordinate = (level: number) => 12 + Math.max(0, Math.min(80, -70 - level)) / 80 * (fftHeight - 30);
  const abscissa = (fraction: number) => 40 + fraction * plot;
  const grid = useMemo(() => {
    const path = Skia.PathBuilder.Make();
    if (width <= 0) return path.detach();
    for (let db = -150; db <= -70; db += 5) { path.moveTo(40, ordinate(db)); path.lineTo(width - 8, ordinate(db)); }
    for (let n = 0; n <= 10; n++) { path.moveTo(abscissa(n / 10), 0); path.lineTo(abscissa(n / 10), fftHeight - 19); }
    return path.detach();
  }, [width, fftHeight]);
  const spectrum = useMemo(() => {
    const path = Skia.PathBuilder.Make();
    trace.forEach((value, n) => {
      const x = abscissa((n + .5) / BINS), y = ordinate(value <= -240 ? value : value + calibrationDb);
      if (n === 0) path.moveTo(x, y); else path.lineTo(x, y);
    });
    return path.detach();
  }, [trace, width, calibrationDb, fftHeight]);

  return <View style={[styles.scope, compact && { marginHorizontal: 0, height }]} accessibilityLabel="Spectrum and waterfall 406 to 406.100 MHz">
    <View style={[styles.title, compact && { flexDirection: "column", gap: 4, paddingVertical: 5, paddingHorizontal: 4 }]}>
      {!compact && <Text style={[styles.titleText, compact && { flex: 0 }]}>FFT  406.000 — 406.100 MHz</Text>}
      <View style={{ flexDirection: "row" }}>
        <DetectionActivity generation="FGB" detections={fgbDetections} />
        <DetectionActivity generation="SGB" detections={sgbDetections} />
      </View>
      {!compact && <Text style={[styles.titleText, { textAlign: "right" }]}>{relative ? "Relative level · WAV" : `Estimated dBm · offset ${calibrationDb.toFixed(1)} dB`}</Text>}</View>
    <View onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
      <Canvas style={{ width: "100%", height: fftHeight, backgroundColor: "#001000" }}>
        <Path path={grid} style="stroke" color="#335555" strokeWidth={1}><DashPathEffect intervals={[3, 3]} /></Path>
        {width > 0 && [-150, -140, -130, -120, -110, -100, -90, -80, -70].map(db =>
          <SkiaText key={db} x={4} y={ordinate(db) + 4} text={String(db)} font={font} color="#99baba" />)}
        {width > 0 && (compact ? [0, 5, 10] : Array.from({ length: 11 }, (_, n) => n)).map(n =>
          <SkiaText key={n} x={Math.max(40, Math.min(width - 49, abscissa(n / 10) - 20))} y={fftHeight - 4}
            text={(406 + n / 100).toFixed(3)} font={font} color="#99baba" />)}
        {trace.length ? <Path path={spectrum} style="stroke" color="#00ffff" strokeWidth={1} />
          : <SkiaText x={55} y={30} text="Waiting for an I/Q stream" font={font} color="#99baba" />}
        {trace.length > 0 && channels.map(channel => {
          const frequency = centerHz + channel.frequencyOffsetHz;
          const held = markerLevels.current.get(channel.channel)?.level;
          if (held === undefined) return null;
          const level = held + calibrationDb;
          if (frequency < 406000000 || frequency > 406100000 || level < -150 || level > -70) return null;
          return <Circle key={channel.channel} cx={abscissa((frequency - 406000000) / 100000)} cy={ordinate(level)} r={5}
            color={candidateColors[channel.channel]} />;
        })}
      </Canvas>
    </View>
    <View style={styles.waterfallWrap}>
      <View style={styles.timeAxis}><Text style={styles.axisText}>0 s</Text>
        <Text style={styles.axisText}>−{Number((7 / speed).toFixed(2))}s</Text></View>
      <Waterfall frame={frame} width={Math.max(0, plot)} speed={speed} height={waterfallHeight} />
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!compact && <><View style={styles.foot}>{["406.000 MHz", "406.050 MHz", "406.100 MHz"].map(text =>
      <Text key={text} style={styles.footText}>{text}</Text>)}</View>
    <Text style={[styles.legendText, { paddingHorizontal: 12, paddingVertical: 6 }]}>
      {automatic ? `WF Auto · noise ${noiseFloor === null ? "—" : (noiseFloor + calibrationDb).toFixed(1)} ${relative ? "relative dB" : "dBm"} · 3 dB/color`
        : "Manual WF · higher Base = darker background; higher Range = lower contrast"}
    </Text>
    <View style={styles.legend} accessibilityLabel="Active FGB channels">
      <Text style={styles.legendText}>Active FGB trials · before BCH validation:</Text>
      {channels.length ? channels.map(channel => <View key={channel.channel} style={styles.legendItem}>
        <View style={[styles.dot, { backgroundColor: candidateColors[channel.channel] }]} />
        <Text style={styles.legendText}>{channel.channel + 1} · {((centerHz + channel.frequencyOffsetHz) / 1e6).toFixed(6)} MHz</Text>
      </View>) : <Text style={styles.legendText}>none</Text>}
    </View></>}
  </View>;
}

const mono = "monospace";
const styles = StyleSheet.create({
  scope: { marginHorizontal: 18, backgroundColor: "#000", borderWidth: 1, borderColor: "#335555", borderRadius: 3, overflow: "hidden" },
  title: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9, paddingHorizontal: 12, backgroundColor: "#001000" },
  titleText: { flex: 1, fontFamily: mono, fontSize: 10, color: "#00ffff" },
  waterfallWrap: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#003333" },
  timeAxis: { width: 40, paddingVertical: 8, paddingHorizontal: 3, justifyContent: "space-between" },
  axisText: { color: "#99baba", fontFamily: mono, fontSize: 9 },
  error: { backgroundColor: "#330f0f", color: "#ff8484", padding: 12 },
  foot: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, paddingRight: 9, paddingLeft: 40 },
  footText: { fontFamily: mono, fontSize: 10, color: "#99baba" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#001000" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { fontSize: 10, color: "#ffffff" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
