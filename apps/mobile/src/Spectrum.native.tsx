import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View, StyleSheet, type LayoutChangeEvent } from "react-native";
import { AlphaType, Canvas, Circle, ColorType, DashPathEffect, Fill, FilterMode, ImageShader, LinearGradient, MipmapMode,
  Path, Shader, Skia, Text as SkiaText, matchFont, vec, type SkImage } from "@shopify/react-native-skia";
import type { SpectrumEvent, AcquisitionChannel } from "@sarsat/shared/protocol";
import { candidateColors, averageSpectrum, WaterfallBuffer, waterfallBins as BINS, waterfallRows as ROWS,
  persistSpectrum, fftMinDb, fftMaxDb, fftOrdinate, spectrumColors as colors,
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
    float age = clamp(p.y / rowHeight + 0.5 - progress, 0.0, ${ROWS - 1}.0);
    return history.eval(float2(p.x * ${BINS}.0 / width, head - 0.5 - age));
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
      sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }} /></Shader></Fill>}
  </Canvas>;
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
  const [fftSize, setFftSize] = useState({ width: 0, height: 0 });
  const [compactWaterfallHeight, setCompactWaterfallHeight] = useState(0);
  const { width } = fftSize;
  const fftHeight = compact ? fftSize.height : 230;
  const waterfallHeight = compact ? compactWaterfallHeight : 180;
  const [trace, setTrace] = useState<number[]>([]);
  const [frame, setFrame] = useState<WaterfallFrame | null>(null);
  const [error, setError] = useState("");
  const [noiseFloor, setNoiseFloor] = useState<number | null>(null);
  const arrivedAt = useRef(-Infinity);
  const latest = useRef<SpectrumEvent | null>(null);
  const averagedTrace = useRef<number[]>([]);
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
    averagedTrace.current = [];
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
    const elapsed = latest.current ? line.timeSeconds - latest.current.timeSeconds : 0;
    latest.current = line;
    const averaged = averageSpectrum(line, averagedTrace.current, average);
    averagedTrace.current = averaged;
    history.current?.push(averaged, line.timeSeconds);
    setNoiseFloor(history.current?.noiseFloorDb ?? null);
    arrivedAt.current = performance.now();
    setTrace(previous => persistSpectrum(averaged, previous, elapsed, averageSpectrum(line, [], 1)));
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
  const top = fftMaxDb;
  const ordinate = (level: number) => fftOrdinate(level, top, fftHeight);
  const abscissa = (fraction: number) => 40 + fraction * plot;
  const labelStep = compact && top - fftMinDb > 50 ? 20 : 10;
  const levels = Array.from({ length: Math.floor((top - fftMinDb) / labelStep) + 1 },
    (_, n) => top - n * labelStep);
  const grid = useMemo(() => {
    const path = Skia.PathBuilder.Make();
    if (width <= 0) return path.detach();
    for (let db = top; db >= fftMinDb; db -= 5) { path.moveTo(40, ordinate(db)); path.lineTo(width - 8, ordinate(db)); }
    for (let n = 0; n <= 10; n++) { path.moveTo(abscissa(n / 10), 0); path.lineTo(abscissa(n / 10), fftHeight - 19); }
    return path.detach();
  }, [width, fftHeight, top]);
  const spectrum = useMemo(() => {
    const path = Skia.PathBuilder.Make();
    const area = Skia.PathBuilder.Make();
    trace.forEach((value, n) => {
      const x = abscissa((n + .5) / BINS), y = ordinate(value <= -240 ? value : value + calibrationDb);
      if (n === 0) {
        path.moveTo(x, y);
        area.moveTo(x, y);
      } else {
        path.lineTo(x, y);
        area.lineTo(x, y);
      }
    });
    const bottom = ordinate(fftMinDb);
    if (trace.length) {
      area.lineTo(abscissa((trace.length - .5) / BINS), bottom);
      area.lineTo(abscissa(.5 / BINS), bottom);
      area.close();
    }
    return { stroke: path.detach(), area: area.detach() };
  }, [trace, width, calibrationDb, fftHeight, top]);

  return <View style={[styles.scope, compact && styles.compactScope]} accessibilityLabel={`Spectrum and waterfall ${frequencyLabel(0)} to ${frequencyLabel(1)} MHz`}>
    <View style={[styles.title, compact && { flexDirection: "column", gap: 4, paddingVertical: 5, paddingHorizontal: 4 }]}>
      {!compact && <Text style={[styles.titleText, compact && { flex: 0 }]}>FFT  {frequencyLabel(0)} — {frequencyLabel(1)} MHz</Text>}
      <View style={{ flexDirection: "row" }}>
        <DetectionActivity generation="FGB" detections={fgbDetections} />
        <DetectionActivity generation="SGB" detections={sgbDetections} />
      </View>
      {!compact && <Text style={[styles.titleText, { textAlign: "right" }]}>{relative ? "Relative level · WAV" : `Estimated dBm · offset ${calibrationDb.toFixed(1)} dB`}</Text>}</View>
    <View style={compact ? styles.compactFft : undefined} onLayout={(event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setFftSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    }}>
      <Canvas style={{ width: "100%", height: compact ? "100%" : fftHeight, backgroundColor: colors.background }}>
        {!!trace.length && fftHeight > 30 && <Path path={spectrum.area}>
          <LinearGradient start={vec(0, ordinate(top))} end={vec(0, ordinate(fftMinDb))}
            colors={colors.fill} positions={colors.fillStops} />
        </Path>}
        <Path path={grid} style="stroke" color={colors.grid} strokeWidth={1}><DashPathEffect intervals={[3, 3]} /></Path>
        {width > 0 && levels.map(db =>
          <SkiaText key={db} x={4} y={ordinate(db) + 4} text={String(db)} font={font} color={colors.labels} />)}
        {width > 0 && (compact ? [0, 5, 10] : Array.from({ length: 11 }, (_, n) => n)).map(n =>
          <SkiaText key={n} x={Math.max(40, Math.min(width - 49, abscissa(n / 10) - 20))} y={fftHeight - 4}
            text={frequencyLabel(n / 10)} font={font} color={colors.labels} />)}
        {trace.length ? <Path path={spectrum.stroke} style="stroke" color={colors.trace} strokeWidth={1} />
          : <SkiaText x={55} y={30} text="Waiting for an I/Q stream" font={font} color={colors.labels} />}
        {trace.length > 0 && channels.map(channel => {
          const frequency = centerHz + channel.frequencyOffsetHz;
          const held = markerLevels.current.get(channel.channel)?.level;
          if (held === undefined) return null;
          const level = held + calibrationDb;
          if (frequency < startHz || frequency > startHz + bandwidthHz || level < fftMinDb) return null;
          return <Circle key={channel.channel} cx={abscissa((frequency - startHz) / bandwidthHz)} cy={ordinate(level)} r={5}
            color={candidateColors[channel.channel]} />;
        })}
      </Canvas>
    </View>
    <View style={[styles.waterfallWrap, compact && styles.compactWaterfall]} onLayout={compact ? event => {
      setCompactWaterfallHeight(Math.max(0, event.nativeEvent.layout.height - 1));
    } : undefined}>
      <View style={styles.timeAxis}><Text style={styles.axisText}>0 s</Text>
        <Text style={styles.axisText}>−{Number((7 / speed).toFixed(2))}s</Text></View>
      <Waterfall frame={frame} width={Math.max(0, plot)} speed={speed} height={waterfallHeight} />
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!compact && <><View style={styles.foot}>{[0, .5, 1].map(f => `${frequencyLabel(f)} MHz`).map(text =>
      <Text key={text} style={styles.footText}>{text}</Text>)}</View>
    <Text style={[styles.legendText, { paddingHorizontal: 12, paddingVertical: 6 }]}>
      {automatic ? `WF Auto · noise ${noiseFloor === null ? "—" : (noiseFloor + calibrationDb).toFixed(1)} ${relative ? "relative dB" : "dBm"} · 18 dB color span`
        : "Manual WF · higher Base = darker background; higher Range = lower contrast"}
    </Text>
    <View style={styles.legend} accessibilityLabel="Active FGB channels">
      <Text style={styles.legendText}>Active FGB trials · before BCH validation:</Text>
      {channels.length ? channels.map(channel => <View key={channel.channel} style={styles.legendItem}>
        <View style={[styles.dot, { backgroundColor: candidateColors[channel.channel] }]} />
        <Text style={styles.legendText}>{channel.channel + 1} · {((centerHz + channel.frequencyOffsetHz) / 1e6).toFixed(3)} MHz</Text>
      </View>) : <Text style={styles.legendText}>none</Text>}
    </View></>}
  </View>;
}

const mono = "monospace";
const styles = StyleSheet.create({
  scope: { marginHorizontal: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: 3, overflow: "hidden" },
  compactScope: { flex: 1, minHeight: 0, marginHorizontal: 0 },
  compactFft: { flex: 64, minHeight: 0, overflow: "hidden" },
  compactWaterfall: { flex: 36, minHeight: 0, overflow: "hidden" },
  title: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9, paddingHorizontal: 12, backgroundColor: colors.background },
  titleText: { flex: 1, fontFamily: mono, fontSize: 10, color: colors.trace },
  waterfallWrap: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.separator, backgroundColor: "#000" },
  timeAxis: { width: 40, paddingVertical: 8, paddingHorizontal: 3, justifyContent: "space-between" },
  axisText: { color: colors.labels, fontFamily: mono, fontSize: 9 },
  error: { backgroundColor: "#330f0f", color: "#ff8484", padding: 12 },
  foot: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, paddingRight: 9, paddingLeft: 40 },
  footText: { fontFamily: mono, fontSize: 10, color: colors.labels },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.background },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { fontSize: 10, color: "#ffffff" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
