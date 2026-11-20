import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Animated, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, type StyleProp,
  type TextStyle, type ViewStyle } from "react-native";
import { Picker } from "@react-native-picker/picker";
import Slider from "@react-native-community/slider";
import * as Clipboard from "expo-clipboard";
import Svg, { G, Path, Polyline, Text as SvgText } from "react-native-svg";
import { Activity, ChevronLeft, ChevronRight, Download, Eraser, FileAudio, FileSearch, FileText, FlaskConical, FolderOpen, MapPin,
  Navigation, Play, BoomBox, Radio, RadioTower, RefreshCw, Settings as SettingsIcon, Square, Usb, type LucideIcon,
  ArrowBigRight,
  ArrowBigLeft, Copy, ExternalLink, Minus, Plus, Share2, X } from "lucide-react-native";
import { startSchema, playbackConfiguration, type Frame, type Info, type Settings, type SpectrumEvent,
  type Diagnostics, type AcquisitionChannel, type ServerEvent } from "@sarsat/shared/protocol";
import { beaconLocator, beaconPosition, googleMapsUrl, wazeUrl } from "@sarsat/shared/beacon-position";
import { Spectrum } from "./Spectrum";
import { BeaconMap } from "./BeaconMap";
import { createTransport } from "./transport";
import { fitExtraFields, formatFieldFrequencies, frameDetailType, frameSummary } from "./frame-summary";
import type { Transport } from "./transport-types";
import { AcquisitionSpinner, type CountdownStart } from "./AcquisitionSpinner";
import { frameNotification, isFrameFiltered } from "./reception-preferences";
import { useReceptionPreferences } from "./use-reception-preferences";
import { useReceptionAudio } from "./use-reception-audio";
import { createFmAudio } from "./fm-audio";
import { OfficialDecoder } from "./OfficialDecoder";

type Entry = { id: number; frame: Frame; received: string; source: string; centerHz: number };
type Action = { label: string; icon: LucideIcon; run: () => void; kind?: "stop" };
function ActionPopup({ title, actions, close }: { title: string; actions: Action[]; close: () => void }) {
  return <Modal transparent animationType="fade" onRequestClose={close}>
    <View style={s.popupBackdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
      <View style={s.popup} accessibilityViewIsModal>
        <View style={s.popupHeader}><Text style={s.h3}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close popup" onPress={close} hitSlop={8}>
            <X size={20} color="#fff" />
          </Pressable>
        </View>
        {actions.map(({ label, icon, run, kind }) => <Button key={label} title={label} icon={icon} kind={kind} onPress={() => { close(); run(); }} />)}
      </View>
    </View>
  </Modal>;
}
async function copyText(value: string) {
  if (!await Clipboard.setStringAsync(value)) throw new Error("Could not copy to the clipboard");
}
const frameMhz = (entry: Entry) => ((entry.centerHz + entry.frame.frequencyOffsetHz) / 1e6).toFixed(3);
const modeLabel = (mode: Frame["mode"]) => mode === "self_test" ? "Self-test" : "Normal";
function ModeIcon({ mode }: { mode: Frame["mode"] }) {
  const Icon = mode === "self_test" ? FlaskConical : Radio;
  return <View accessibilityRole="image" accessibilityLabel={modeLabel(mode)}>
    <Icon size={16} color={mode === "self_test" ? "#C084FC" : "#60A5FA"} />
  </View>;
}
const receivedTime = (received: string) => {
  const date = new Date(received);
  return `${date.toLocaleDateString("en-GB")} ${date.toLocaleTimeString("en-GB", { hour12: false })}.${received.slice(20, 23)}`;
};
const tabs = ["Detection", "Frames", "Map", "Detail", "Signal", "Receiver", "Player", "Settings"] as const;
type Tab = typeof tabs[number];
const tabIcons: Record<Tab, LucideIcon> = { Detection: RadioTower, Frames: FileText, Map: MapPin,
  Detail: FileSearch, Signal: Activity, Receiver: BoomBox, Player: FileAudio, Settings: SettingsIcon };
const numericSettings: { key: keyof Pick<Settings, "fgbAlpha" | "fgbBeta" | "fgbOverPeakDb" |
  "fgbZeta" | "fgbAverage" | "fgbRuntimeMs" | "fgbMaxErrors" | "fgbBch2MaxErrors" | "fgbHeaderErrors" | "sgbThreshold" | "sgbPhaseGain" |
  "sgbFrequencyGain" | "sgbFilter" | "sgbFeedback" | "sgbMaxErrors" | "searchDepth">;
  label: string; min?: number; max?: number }[] = [
  { key: "fgbOverPeakDb", label: "FGB OverPeak · dB" },
  { key: "fgbAlpha", label: "FGB PLL Alpha" },
  { key: "fgbBeta", label: "FGB PLL Beta" },
  { key: "fgbZeta", label: "FGB PLL Zeta" },
  { key: "fgbAverage", label: "FGB Detection Average", max: 1 },
  { key: "fgbRuntimeMs", label: "FGB RunTime · ms", min: 1 },
  { key: "fgbMaxErrors", label: "FGB BCH-1 max errors", max: 3 },
  { key: "fgbBch2MaxErrors", label: "FGB BCH-2 max errors", max: 2 },
  { key: "fgbHeaderErrors", label: "FGB header max errors", max: 3 },
  { key: "sgbThreshold", label: "SGB Detection", max: 512 },
  { key: "sgbPhaseGain", label: "SGB PLL Alpha" },
  { key: "sgbFrequencyGain", label: "SGB PLL Beta" },
  { key: "sgbFilter", label: "SGB PLL TC", max: 1 },
  { key: "sgbFeedback", label: "SGB PLL FB" },
  { key: "searchDepth", label: "SGB Search Depth", min: 3, max: 9 },
  { key: "sgbMaxErrors", label: "SGB BCH max errors", max: 6 },
];

function Button({ title, onPress, disabled, kind, icon: Icon, backgroundColor, iconOnly }: { title: string; onPress: () => void; disabled?: boolean;
  iconOnly?: boolean;
  kind?: "primary" | "stop"; icon?: LucideIcon; backgroundColor?: string }) {
  const color = kind === "stop" ? "#ff8484" : "#ffffff";
  return <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, kind === "primary" && s.primary,
      iconOnly && s.iconButton, backgroundColor ? { backgroundColor, borderColor: backgroundColor } : undefined,
      pressed && { opacity: .7 }, disabled && { opacity: .45 }]}>
    {Icon && <Icon size={iconOnly ? 26 : 20} color={color} />}
    {!iconOnly && <Text style={[s.buttonText, { color }, kind === "primary" && { fontWeight: "600" }]}>{title}</Text>}
  </Pressable>;
}
function Check({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value, disabled }} disabled={disabled}
    onPress={() => onChange(!value)} style={[s.check, disabled && { opacity: .5 }]}>
    <View style={[s.box, value && s.boxOn]}>{value && <Text style={s.tick}>✓</Text>}</View><Text style={s.small}>{label}</Text>
  </Pressable>;
}
function NumberField({ label, value, onChange, disabled, style, big }: { label: string; value: number | string | undefined;
  onChange: (value: number) => void; disabled?: boolean; style?: StyleProp<ViewStyle>; big?: boolean }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => { if (Number(text) !== Number(value)) setText(value === undefined ? "" : String(value)); }, [value]);
  return <View style={[s.field, style]}><Text style={s.label}>{label}</Text>
    <TextInput accessibilityLabel={label} editable={!disabled} keyboardType="numeric" value={text}
      style={[s.input, big && s.bigInput, disabled && { opacity: .5 }]}
      onChangeText={next => { setText(next); const n = Number(next.replace(",", ".")); if (next !== "" && Number.isFinite(n)) onChange(n); }} /></View>;
}
function Select({ label, value, onChange, items, disabled }: { label: string; value: string; onChange: (value: string) => void;
  items: { label: string; value: string }[]; disabled?: boolean }) {
  return <View style={s.field}><Text style={s.label}>{label}</Text>
    <View style={s.picker}><Picker accessibilityLabel={label} enabled={!disabled} selectedValue={value} onValueChange={next => onChange(String(next))}
      dropdownIconColor="#00ffff" style={{ minWidth: 220, color: "#ffffff", backgroundColor: "#001a1a" }}>
      {items.map(item => <Picker.Item key={item.value} label={item.label} value={item.value} color="#ffffff" style={{ backgroundColor: "#001a1a" }} />)}</Picker></View></View>;
}
function Range({ label, value, min, max, step, onChange, digits = 0, disabled }: { label: string; value: number; min: number; max: number;
  step: number; onChange: (value: number) => void; digits?: number; disabled?: boolean }) {
  return <View style={[s.range, disabled && { opacity: .5 }]}><Text style={s.small}>{label}</Text>
    <Slider accessibilityLabel={label} style={{ width: 160, height: 36 }} minimumValue={min} maximumValue={max} step={step} value={value}
      disabled={disabled} onValueChange={onChange} minimumTrackTintColor="#00ffff" maximumTrackTintColor="#335555" thumbTintColor="#3fe6e6" />
    <Text style={[s.small, s.mono]}>{value.toFixed(digits)}</Text></View>;
}
function Badge({ text, tone, accessibilityLabel }: { text: string; tone: "valid" | "invalid" | "corrected"; accessibilityLabel?: string }) {
  return <Text accessibilityLabel={accessibilityLabel} style={[s.badge, s[tone]]}>{text}</Text>;
}
function bchStatus(frame: Frame, n: number, compact = false) {
    const bch = frame.bch[n];
    const name = frame.generation === 2 ? "BCH" : `BCH${n + 1}`;
    const overLimit = n === 0 && frame.correctionLimit !== undefined &&
      bch.correctedErrors !== null && bch.correctedErrors > frame.correctionLimit;
    const text = !bch.valid ? "FAIL" : overLimit ? `OVER LIMIT · ${bch.correctedErrors} bits`
      : bch.correctedErrors ? `corrected ${bch.correctedErrors} bit${bch.correctedErrors > 1 ? "s" : ""}` : "OK";
    const short = !bch.valid ? "FAIL" : overLimit ? ">LIMIT" : bch.correctedErrors ? `corr. ${bch.correctedErrors}` : "OK";
    const tone = bch.valid && !overLimit ? bch.correctedErrors ? "corrected" : "valid" : "invalid";
    return { text: `${name} ${compact ? short : text}`, accessibilityLabel: `${name} ${text}`, tone } as const;
}
function bchBadges(frame: Frame, compact = false) {
  return frame.bch.map((_, n) => <Badge key={n} {...bchStatus(frame, n, compact)} />);
}
function headerBadge(frame: Frame) {
  return frame.generation === 1 && frame.headerErrors ?
    <Badge text={`HEADER ${frame.headerErrors} bit${frame.headerErrors > 1 ? "s" : ""} mismatch`} tone="corrected" /> : null;
}
const Badges = ({ children }: { children: ReactNode }) => <View style={s.badges}>{children}</View>;
type SignalTrace = NonNullable<Frame["traces"]>["phase"];
type SignalSeries = { trace: SignalTrace; scale: number; offset: number; color: string };
type SignalBits = { start: number; samplesPerBit: number; hex: string; padding?: number };
const minBitWidth = 16;
const TraceContent = memo(function TraceContent({ series, start, end, pixelsPerSample, minimum, maximum, bits }: {
  series: SignalSeries[]; start: number; end: number; pixelsPerSample: number; minimum: number; maximum: number;
  bits?: SignalBits;
}) {
  const span = Math.max(1e-6, maximum - minimum);
  const x = (sample: number) => sample * pixelsPerSample;
  const y = (value: number) => 130 - (value - minimum) / span * 115;
  const samplesPerBit = bits?.samplesPerBit ?? 0;
  const bitWidth = samplesPerBit * pixelsPerSample;
  const labels = bits ? [...bits.hex].flatMap((hex, n) => {
    const skip = n === 0 ? bits.padding ?? 0 : 0;
    const sample = bits.start + Math.max(0, n * 4 - (bits.padding ?? 0)) * samplesPerBit;
    const count = 4 - skip;
    return sample + count * samplesPerBit > start && sample < end ? [{ hex, sample, skip, count }] : [];
  }) : [];
  const mid = y(minimum <= 0 && maximum >= 0 ? 0 : (minimum + maximum) / 2);
  return <>
      <Path d={`M${x(start)} ${mid} H${x(end)}`} stroke="#003333" />
      {series.map(({ trace, scale, offset, color }, n) => {
        const step = trace.stride * scale;
        const from = Math.max(0, Math.floor((start - offset) / step));
        const to = Math.ceil((end - offset) / step) + 1;
        const points = trace.values.slice(from, to).map((value, i) =>
          `${x(offset + (from + i) * step).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
        return points ? <Polyline key={n} points={points} fill="none" stroke={color} strokeWidth={1} /> : null;
      })}
      {labels.map(({ hex, sample, skip, count }) => {
        const left = x(sample), right = left + bitWidth * count, middle = (left + right) / 2;
        return <G key={sample}>
          {Array.from({ length: count }, (_, n) => {
            const center = left + (n + .5) * bitWidth;
            return <SvgText key={n} x={center} y={153} textAnchor="middle" fill="#c6dddd" fontSize={12}>
              {(parseInt(hex, 16) >> (3 - skip - n)) & 1}
            </SvgText>;
          })}
          <Path d={`M${left + 1} 159 H${right - 1}`} stroke="#335555" />
          <SvgText x={middle} y={175} textAnchor="middle" fill="#00ffff" fontSize={12}>{hex}</SvgText>
        </G>;
      })}
  </>;
});
const Trace = memo(function Trace({ title, series, start, end, viewportWidth, pixelsPerSample, translateX, rate, bits }: {
  title: string; series: SignalSeries[]; start: number; end: number; viewportWidth: number; pixelsPerSample: number;
  translateX: ReturnType<typeof Animated.multiply>; rate: number; bits?: SignalBits;
}) {
  const levels = useMemo(() => {
    const values = series.flatMap(({ trace }) => trace.values);
    return values.length ? { minimum: Math.min(...values), maximum: Math.max(...values) } : null;
  }, [series]);
  if (!levels) return <Text style={[s.empty, { padding: 25 }]}>{title}: no trace received</Text>;
  const left = start * pixelsPerSample;
  const width = (end - start) * pixelsPerSample;
  const showBits = bits && bits.samplesPerBit * pixelsPerSample >= minBitWidth - 1e-6;
  const height = showBits ? 195 : 158;
  const tickStep = viewportWidth / 4;
  const firstTick = Math.ceil(left / tickStep);
  const timeLabels = Array.from({ length: Math.floor((left + width) / tickStep) - firstTick + 1 },
    (_, i) => (firstTick + i) * tickStep);
  return <View style={s.trace}><View style={s.traceHeader}><Text style={s.traceText}>{title}</Text>
    <Text style={[s.traceText, { fontSize: 10 }]}>{levels.minimum.toPrecision(4)} … {levels.maximum.toPrecision(4)}</Text></View>
    <View style={{ overflow: "hidden", height }}>
      <Animated.View testID="signal-trace-strip" style={{ position: "absolute", left, width, height, transform: [{ translateX }] }}>
        <Svg width={width} height={height} viewBox={`${left} 0 ${width} ${height}`} accessibilityLabel={title}>
          {timeLabels.map(x => <Path key={x} d={`M${x} 0 V140`} stroke="#003333" />)}
          <TraceContent series={series} start={start} end={end}
            pixelsPerSample={pixelsPerSample} {...levels} bits={showBits ? bits : undefined} />
          {timeLabels.map(x => <SvgText key={x} x={x === 0 ? 3 : x} y={showBits ? 191 : 154}
            textAnchor={x === 0 ? "start" : "middle"} fill="#99baba" fontSize={10}>
            {(x * 1000 / (pixelsPerSample * rate)).toFixed(1)} ms
          </SvgText>)}
        </Svg>
      </Animated.View>
    </View>
  </View>;
});
const maxSignalZoom = 32;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
type SignalWindow = { zoom: number; start: number };
function SignalPlots({ frame, children }: { frame: Frame; children: ReactNode }) {
  const [manualWindow, setWindow] = useState<SignalWindow | null>(null);
  const current = useRef<SignalWindow | null>(null);
  const [position] = useState(() => new Animated.Value(0, { useNativeDriver: Platform.OS === "android" }));
  const animation = useRef(0);
  useEffect(() => () => cancelAnimationFrame(animation.current), []);
  const [width, setWidth] = useState(0);
  const { traces } = frame;
  const fgb = frame.generation === 1;
  // SGB: four PLL updates per I/Q symbol; place each recovered value at its interval's center.
  const duration = traces ? Math.max(traces.phase.count, fgb ? 0 : 4 * Math.max(traces.i.count, traces.q.count)) : 0;
  const bits = useMemo<SignalBits | undefined>(() => {
    if (frame.generation === 1) return frame.fgbBitStartSample === undefined ? undefined :
      { start: frame.fgbBitStartSample, samplesPerBit: 18, hex: frame.rawHex };
    // The first hex digit includes two non-transmitted bits (one marks self-test).
    return { start: 100, samplesPerBit: 2, padding: 2, hex: (parseInt(frame.rawHex[0], 16) & 3).toString(16) + frame.rawHex.slice(1) };
  }, [frame]);
  const phaseSeries = useMemo<SignalSeries[]>(() => traces ? [{ trace: traces.phase, scale: 1, offset: .5, color: "#99ec80" }] : [], [traces]);
  const iqSeries = useMemo<SignalSeries[]>(() => traces ? [
    { trace: traces.i, scale: 4, offset: 2, color: "#99ec80" },
    { trace: traces.q, scale: 4, offset: 2, color: "#ff6060" },
  ] : [], [traces]);
  const initialZoom = bits && width > 0 && duration > 0
    ? clamp(minBitWidth * duration / (width * bits.samplesPerBit), 1, maxSignalZoom) : 1;
  const window = manualWindow ?? { zoom: initialZoom, start: clamp(bits?.start ?? 0, 0, duration - duration / initialZoom) };
  const spanSamples = duration / window.zoom;
  const pixelsPerSample = duration > 0 ? width / spanSamples : 0;
  const translateX = useMemo(() => Animated.multiply(position, -pixelsPerSample), [position, pixelsPerSample]);
  const painted = useRef(window);
  painted.current = window;
  useLayoutEffect(() => { if (!current.current) position.setValue(window.start); }, [position, window.start]);
  const applyZoom = (base: SignalWindow, factor: number, from: number, to: number) => {
    const zoom = clamp(base.zoom * factor, 1, maxSignalZoom);
    const span = duration / zoom;
    const start = clamp(base.start + from * duration / base.zoom - to * span, 0, duration - span);
    const active = current.current ?? painted.current;
    if (zoom === active.zoom && start === active.start) return;
    current.current = { zoom, start };
    if (!animation.current) animation.current = requestAnimationFrame(() => {
      animation.current = 0;
      const next = current.current;
      if (!next) return;
      const previous = painted.current;
      // Move the existing SVG layer; only rebuild its overscan when nearing an edge or changing zoom.
      if (next.zoom !== previous.zoom || Math.abs(next.start - previous.start) >= duration / next.zoom / 2) {
        setWindow(next);
      }
      position.setValue(next.start);
    });
  };
  const gestures = useMemo(() => {
    let origin = 0;
    let baseline: { window: SignalWindow; count: number; center: number; distance: number } | undefined;
    return PanResponder.create({
      onStartShouldSetPanResponder: event => event.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (event, { dx, dy }) => event.nativeEvent.touches.length >= 2 ||
        ((current.current ?? painted.current).zoom > 1 && Math.abs(dx) > Math.max(4, Math.abs(dy))),
      onPanResponderGrant: ({ nativeEvent }) => {
        origin = nativeEvent.pageX - nativeEvent.locationX;
        baseline = undefined;
      },
      onPanResponderMove: ({ nativeEvent: { touches } }) => {
        const [first, second] = touches;
        if (!first || width <= 0) return;
        const count = second ? 2 : 1;
        const center = ((second ? (first.pageX + second.pageX) / 2 : first.pageX) - origin) / width;
        const distance = second ? Math.max(1, Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY)) : 1;
        if (!baseline || baseline.count !== count) baseline = { window: current.current ?? painted.current, count, center, distance };
        applyZoom(baseline.window, distance / baseline.distance, baseline.center, center);
      },
    });
  }, [duration, width]);
  const viewport = { start: Math.max(0, window.start - spanSamples * .6),
    end: Math.min(duration, window.start + spanSamples * 1.6), viewportWidth: width,
    translateX, pixelsPerSample, rate: fgb ? 7200 : 600 };
  const gestureStyle: ViewStyle & { touchAction?: "pan-y" } = {
    ...StyleSheet.absoluteFill,
    ...(Platform.OS === "web" ? { touchAction: "pan-y" } : {}),
  };
  const hasTrace = !!traces?.phase.values.length;
  return <View onLayout={event => setWidth(Math.max(0, event.nativeEvent.layout.width - 2))}>
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      {hasTrace && <View style={s.row}>
        <Button iconOnly icon={Minus} title="Zoom out" disabled={window.zoom === 1} onPress={() => applyZoom(current.current ?? window, .5, .5, .5)} />
        <Button iconOnly icon={Plus} title="Zoom in" disabled={window.zoom === maxSignalZoom} onPress={() => applyZoom(current.current ?? window, 2, .5, .5)} />
      </View>}
    </View>
    {!hasTrace && <Text style={[s.empty, { padding: 25 }]}>No phase trace received.</Text>}
    {hasTrace && width > 0 && <View>
      {!fgb && <Trace title="Recovered I (green) / Q (red)" {...viewport} series={iqSeries} bits={bits} />}
      <Trace title="Recovered phase / PLL error" series={phaseSeries} {...viewport} bits={fgb ? bits : undefined} />
      <View {...gestures.panHandlers} testID="signal-gesture-surface" style={gestureStyle} />
    </View>}
  </View>;
}
function Signal({ entry }: { entry: Entry | undefined }) {
    return <View style={s.panel}>
      <Text style={[s.h2, { marginBottom: 3 }]}>Signal <Text style={s.h2Small}>Current frame · latest received by default</Text></Text>
      {!entry ? <Text style={[s.empty, { paddingVertical: 80 }]}>No frames received.</Text> : <SignalPlots key={entry.id} frame={entry.frame}>
        <Text style={s.detail}>{entry.frame.generation === 1 ? "FGB" : "SGB"} · {entry.source} · Received: {entry.received}</Text>
        <Text selectable style={[s.mono, s.code]}>{entry.frame.correctedHex}</Text>
        <Text style={s.detail}>{frameMhz(entry)} MHz · t = {entry.frame.timeSeconds.toFixed(6)} s · Δf = {entry.frame.frequencyOffsetHz.toFixed(3)} Hz</Text>
        <Badges>{bchBadges(entry.frame)}{headerBadge(entry.frame)}</Badges>
      </SignalPlots>}
    </View>;
}
const FrameTable = memo(function FrameTable({ entries, active, select, compact = false, filtered = false }: {
  entries: Entry[]; active: Entry | undefined; select: (id: number) => void; compact?: boolean; filtered?: boolean;
}) {
  const rows = useRef<ComponentRef<typeof ScrollView>>(null);
  const layouts = useRef(new Map<number, { y: number; height: number }>());
  const viewport = useRef({ y: 0, height: 0 });
  const [glyphWidth, setGlyphWidth] = useState(7);
  const revealSelection = () => {
    const layout = active && layouts.current.get(active.id);
    if (!layout || !viewport.current.height) return;
    const { y, height } = viewport.current;
    const target = layout.y < y ? layout.y :
      layout.y + layout.height > y + height ? layout.y + layout.height - height : y;
    viewport.current.y = Math.max(0, target);
    rows.current?.scrollTo({ y: viewport.current.y, animated: false });
  };
  useEffect(() => {
    const ids = new Set(entries.map(entry => entry.id));
    for (const id of layouts.current.keys()) if (!ids.has(id)) layouts.current.delete(id);
    revealSelection();
  }, [active?.id, entries]);
  const headers = ["Received", "Gen.", "Type", "Mode", "MHz", "Locator", "BCH"];
  const tableRows = entries.map(entry => {
    const locator = beaconLocator(entry.frame)?.slice(0, 8) ?? "—";
    const values = ["00:00:00.000", entry.frame.generation === 1 ? "FGB" : "SGB", entry.frame.beaconType, "", frameMhz(entry), locator];
    if (!compact && entry.frame.headerErrors) values[3] = `HEADER ${entry.frame.headerErrors} bits mismatch`;
    return { entry, locator, values, bch: entry.frame.bch.map((_, n) => bchStatus(entry.frame, n, true).text) };
  });
  const widths = headers.map((header, n) => {
    const values = n === headers.length - 1 ? tableRows.flatMap(row => row.bch) : tableRows.map(row => row.values[n]);
    const badgePadding = n === headers.length - 1 || (!compact && n === 3 && entries.some(entry => entry.frame.headerErrors)) ? 12 : 0;
    return Math.ceil(Math.max(header.length, ...values.map(value => value.length)) * glyphWidth + 18 + badgePadding);
  });
  return <View style={s.fill} accessibilityLabel="Received frames">
    <Text aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={s.tableMeasure} onLayout={event => setGlyphWidth(event.nativeEvent.layout.width / 10)}>0000000000</Text>
    {!entries.length ? <View style={s.emptyPane}><Text style={s.emptyStrong}>{filtered ? "All frames are filtered" : "No frames received"}</Text>
      <Text style={s.empty}>{filtered ? "Change display filters in Settings to show stored frames." : "Start the receiver or play an I/Q capture."}</Text></View> :
      <ScrollView horizontal style={s.fill} contentContainerStyle={{ minWidth: "100%" }}>
        <View style={{ minWidth: "100%", flex: 1 }}>
          <View style={[s.tr, s.th]}>{headers.map((name, n) =>
            <Text key={name} style={[s.thText, s.mono, { width: widths[n] }]}>{name}</Text>)}</View>
          <ScrollView ref={rows} style={s.fill} nestedScrollEnabled accessibilityLabel="Frame rows"
            onScroll={event => { viewport.current.y = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}
            onLayout={event => { viewport.current.height = event.nativeEvent.layout.height; revealSelection(); }}
            onContentSizeChange={revealSelection}>
            {[...tableRows].reverse().map(({ entry, locator }) => <Pressable key={entry.id} accessibilityRole="button"
              accessibilityLabel={`Select frame ${entries.indexOf(entry) + 1}`}
              accessibilityHint={`Mode: ${modeLabel(entry.frame.mode)}`}
              accessibilityState={{ selected: active?.id === entry.id }} onPress={() => select(entry.id)}
              onLayout={event => {
                layouts.current.set(entry.id, event.nativeEvent.layout);
                if (active?.id === entry.id) revealSelection();
              }}
              style={[s.tr, active?.id === entry.id && { backgroundColor: "#004444" }]}>
              <Text style={[s.td, s.mono, { width: widths[0] }]}>
                {new Date(entry.received).toLocaleDateString("en-GB")}{"\n"}
                {new Date(entry.received).toLocaleTimeString("en-GB", { hour12: false })}.{entry.received.slice(20, 23)}
              </Text>
              <Text style={[s.td, s.mono, { width: widths[1] }]}>{entry.frame.generation === 1 ? "FGB" : "SGB"}</Text>
              <Text style={[s.td, s.mono, { width: widths[2] }]}>{entry.frame.beaconType}</Text>
              <View style={[s.tableBadges, { width: widths[3], paddingHorizontal: 9 }]}>
                <View style={s.tableModeIcon}><ModeIcon mode={entry.frame.mode} /></View>{!compact && headerBadge(entry.frame)}</View>
              <Text style={[s.td, s.mono, { width: widths[4] }]}>{frameMhz(entry)}</Text>
              <Text style={[s.td, s.mono, { width: widths[5] }]}>{locator}</Text>
              <View style={[s.tableBadges, { width: widths[6] }]}>{bchBadges(entry.frame, true)}</View>
            </Pressable>)}
          </ScrollView>
        </View>
      </ScrollView>}
  </View>;
});
function CompactFrameDetails({ entry }: { entry: Entry }) {
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyError, setCopyError] = useState("");
  const summary = frameSummary(entry.frame);
  const [height, setHeight] = useState(0);
  const [baseHeights, setBaseHeights] = useState<[number, number]>([0, 0]);
  const [fieldHeights, setFieldHeights] = useState<(number | undefined)[]>([]);
  const columns = fitExtraFields(summary.extraFields.map((_, n) => fieldHeights[n]),
    [Math.max(0, height - baseHeights[0]), Math.max(0, height - baseHeights[1])], 3);
  const extra = (index: number) => {
    const field = summary.extraFields[index];
    return <Text style={s.summaryLine}><Text style={s.summaryLabel}>{field.name}: </Text>{formatFieldFrequencies(field.value)}</Text>;
  };
  const recordBase = (column: 0 | 1, value: number) => setBaseHeights(previous =>
    previous[column] === value ? previous : column === 0 ? [value, previous[1]] : [previous[0], value]);
  return <View style={s.summaryColumns} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
    <View style={s.summaryColumn}>
      <View style={s.summaryBase} onLayout={event => recordBase(0, event.nativeEvent.layout.height)}>
        <View style={s.summaryControl}>
          <Text style={s.summaryLine}><Text style={s.summaryLabel}>Mode: </Text>{modeLabel(entry.frame.mode)}</Text>
          <ModeIcon mode={entry.frame.mode} />
        </View>
        <Text style={s.summaryLine}><Text style={s.summaryLabel}>Info: </Text>{formatFieldFrequencies(summary.info[0] ?? "Not available")}</Text>
        {summary.info.slice(1).map((value, n) => <Text key={n} style={s.summaryLine}>{formatFieldFrequencies(value)}</Text>)}
        <View style={s.locationRow}>
          <View style={[s.fill, s.summaryBase]}>
            <Text style={s.summaryLine}><Text style={s.summaryLabel}>Location: </Text>{summary.position?.locator ?? summary.positionStatus ?? "Not available"}</Text>
            <Text style={s.summaryLine}>{summary.country ?? "Country not available"}</Text>
            {summary.position && <>
              <Text style={s.summaryLine}>{summary.position.dms}</Text>
              <Text style={s.summaryLine}>{summary.position.decimal}</Text>
            </>}
          </View>
          {summary.position && <Pressable accessibilityRole="button" accessibilityLabel="Copy coordinates"
            style={({ pressed }) => [s.locationCopy, pressed && { opacity: .7 }]}
            onPress={() => { setCopyError(""); setCopyOpen(true); }}><Copy size={23} color="#3fe6e6" /></Pressable>}
        </View>
        {copyError !== "" && <Text accessibilityRole="alert" style={s.errorText}>{copyError}</Text>}
        {copyOpen && summary.position && <ActionPopup title="Copy coordinates" close={() => setCopyOpen(false)}
          actions={[summary.position.decimal, summary.position.dms, ...(summary.position.locator ? [summary.position.locator] : [])]
            .map(value => ({ label: value, icon: Copy, run: () => { void copyText(value).catch(reason => setCopyError(String(reason))); } }))} />}
        {!!summary.emergency.length && <Text style={s.summaryLine}><Text style={[s.summaryLabel, s.emergencyLabel]}>Emergency: </Text>{formatFieldFrequencies(summary.emergency.join(" · "))}</Text>}
      </View>
      {columns[0].map(index => <View key={index}>{extra(index)}</View>)}
      <View style={s.summaryMeasure} pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {summary.extraFields.map((_, index) => <View key={index} onLayout={event => {
          const value = event.nativeEvent.layout.height;
          setFieldHeights(previous => {
            if (previous[index] === value) return previous;
            const next = [...previous]; next[index] = value; return next;
          });
        }}>{extra(index)}</View>)}
      </View>
    </View>
    <View style={s.summaryColumn}>
      <View style={s.summaryBase} onLayout={event => recordBase(1, event.nativeEvent.layout.height)}>
        <View style={s.summaryControl}><Text style={s.summaryLabel}>Control:</Text>{bchBadges(entry.frame, true)}{headerBadge(entry.frame)}</View>
        <Text style={s.summaryLine}><Text style={s.summaryLabel}>Hex ID: </Text>{summary.hexId ?? "Not available"}</Text>
        {summary.serial && <Text style={s.summaryLine}><Text style={s.summaryLabel}>Serial#: </Text>{summary.serial}</Text>}
        <Text style={s.summaryLine}><Text style={s.summaryLabel}>Main location device: </Text>{formatFieldFrequencies(summary.mainDevice ?? "Not available")}</Text>
        <Text style={s.summaryLine}><Text style={s.summaryLabel}>Aux. location device: </Text>{formatFieldFrequencies(summary.auxDevice ?? "Not available")}</Text>
        {summary.homingDevice && <Text style={s.summaryLine}><Text style={s.summaryLabel}>Homing device: </Text>{summary.homingDevice}</Text>}
      </View>
      {columns[1].map(index => <View key={index}>{extra(index)}</View>)}
    </View>
  </View>;
}
const FrameDetail = memo(function FrameDetail({ entry, compact = false }: { entry: Entry | undefined; compact?: boolean }) {
  const fields = entry?.frame.fields ?? [];
  const sections = [...new Set(fields.map(field => field.section))];
  const content = <>
    {!entry ? <><Text style={s.h3}>CURRENT FRAME</Text><Text style={s.empty}>No frame selected.</Text></> : <>
      <View style={s.frameHeader}>
        <Text style={[s.h3, s.frameHeaderTitle]}>CURRENT FRAME</Text>
        <View style={s.frameHeaderMode}>
          <Text style={s.frameHeaderText}>{entry.frame.generation === 1 ? "FGB" : "SGB"} · </Text>
          <Text style={s.frameHeaderText}>{entry.frame.beaconType} · {frameMhz(entry)} MHz · </Text>
          <ModeIcon mode={entry.frame.mode} />
        </View>
        <Text style={[s.frameHeaderTime, s.mono]}>{receivedTime(entry.received)}</Text>
      </View>
      {compact ? <CompactFrameDetails key={entry.id} entry={entry} /> : <>
      <View style={s.metadataGrid}>
        <View style={s.metadataColumn}>
          <View style={s.summaryControl}>
            <Text style={s.detail}>Mode: {modeLabel(entry.frame.mode)}</Text>
            <ModeIcon mode={entry.frame.mode} />
          </View>
          <Text style={s.detail}>{entry.source}</Text>
          <Text style={[s.detail, s.mono]}>{frameMhz(entry)} MHz · {entry.frame.timeSeconds.toFixed(6)} s</Text>
        </View>
        <View style={s.metadataColumn}>
          <Text style={s.detail}>Received: {entry.received}{"\n"}Δf: {entry.frame.frequencyOffsetHz.toFixed(3)} Hz</Text>
          {entry.frame.correctionLimit !== undefined && <Text style={s.detail}>{entry.frame.generation === 1 ? "BCH-1" : "BCH"} correction limit: {entry.frame.correctionLimit}
            {entry.frame.bch.length > 1 && entry.frame.bch2Limit !== undefined ? ` · BCH-2: ${entry.frame.bch2Limit}` : ""}</Text>}
          {entry.frame.headerErrors !== undefined && <Text style={s.detail}>Header errors: {entry.frame.headerErrors}</Text>}
        </View>
      </View>
      <Badges>{bchBadges(entry.frame)}{headerBadge(entry.frame)}</Badges>
      <Text style={s.detail}>Raw</Text><Text selectable style={[s.mono, s.code]}>{entry.frame.rawHex}</Text>
      <Text style={s.detail}>Corrected</Text><Text selectable style={[s.mono, s.code]}>{entry.frame.correctedHex}</Text>
      <View style={s.fieldSections}>
        {sections.map(section => <View key={section} style={s.fieldSection}>
          <Text style={[s.fieldSectionTitle, section === "Emergency" && s.emergencyLabel]}>{section}</Text>
          {fields.filter(field => field.section === section).map((field, n) =>
            <View key={n} style={s.fullFieldRow}>
              <Text selectable style={[s.fieldName, section === "Emergency" && s.emergencyLabel]}>{field.name}</Text>
              <Text selectable style={s.fieldValue}>{section === "Identification" && field.name === "Type"
                ? frameDetailType(field.value) : formatFieldFrequencies(field.value)}</Text>
            </View>)}
          {(section === "Location" || section === "Encoded GNSS Location") && beaconLocator(entry.frame) &&
            <View style={s.fullFieldRow}><Text style={s.fieldName}>Locator</Text>
              <Text selectable style={s.fieldValue}>{beaconLocator(entry.frame)}</Text></View>}
        </View>)}
      </View>
      </>}
    </>}
  </>;
  return compact ? <View style={s.detailPane} accessibilityLabel="Current frame details">{content}</View> :
    <ScrollView key={entry?.id} style={s.fill} contentContainerStyle={s.fullDetail}
      accessibilityLabel="Current frame details" nestedScrollEnabled>{content}</ScrollView>;
});
const MapPanel = memo(function MapPanel({ entry, compact = false }: { entry: Entry | undefined; compact?: boolean }) {
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [linkError, setLinkError] = useState("");
  const position = entry && beaconPosition(entry.frame);
  async function shareLink(name: string, url: string) {
    if (Platform.OS !== "web") { await Share.share({ title: name, message: url }); return; }
    if (!navigator.share) throw new Error("Sharing is unavailable in this browser. Use Copy URL.");
    await navigator.share({ title: name, url });
  }
  const report = (reason: unknown) => {
    if (!(reason instanceof Error && reason.name === "AbortError")) setLinkError(String(reason));
  };
  const mapLink = (name: string, url: string, Icon: LucideIcon, label = name, color?: string) =>
    <Pressable accessibilityRole="link" accessibilityLabel={name} accessibilityHint="Long press to copy or share the URL"
      style={[s.mapLink, color ? { backgroundColor: color } : undefined]}
      onPress={() => { setLinkError(""); void Linking.openURL(url).catch(report); }}
      onLongPress={() => { setLinkError(""); setLink({ name, url }); }}>
      <Icon size={18} color="#fff" /><Text style={s.mapLinkText}>{label}</Text>
    </Pressable>;
  return <View style={s.mapPane} accessibilityLabel="Beacon map">
    <View style={s.mapHeader}>
      <Text style={[s.h3, { marginBottom: 0 }]}>MAP</Text>
      {entry && position && <Text style={[s.detail, s.mono, { flexShrink: 1, marginTop: 0 }]}>
        {position.lat.toFixed(6)}, {position.lon.toFixed(6)}
        {!compact && ` · ${entry.frame.generation === 1 ? "FGB" : "SGB"} · ${entry.frame.correctedHex} · ${entry.frame.timeSeconds.toFixed(3)} s`}
      </Text>}
    </View>
    {linkError !== "" && <Text accessibilityRole="alert" style={s.errorText}>{linkError}</Text>}
    {link && <ActionPopup title={link.name} close={() => setLink(null)} actions={[
      { label: "Copy URL", icon: Copy, run: () => { void copyText(link.url).catch(report); } },
      { label: "Share URL", icon: Share2, run: () => { void shareLink(link.name, link.url).catch(report); } },
    ]} />}
    {!entry || !position ? <View style={s.emptyPane}><Text style={s.empty}>No decoded beacon position.</Text></View> : <>
      <View style={s.mapContent}>
        <View style={s.fill}><BeaconMap lat={position.lat} lon={position.lon} /></View>
        <View style={s.mapActions}>
          {mapLink("Google Maps", googleMapsUrl(position.lat, position.lon), MapPin, "Google\nMaps")}
          {mapLink("Waze", wazeUrl(position.lat, position.lon), Navigation, "Waze", "#087899")}
        </View>
      </View>
    </>}
  </View>;
});
function OfficialDetail({ entry }: { entry: Entry | undefined }) {
  const [error, setError] = useState("");
  if (!entry) return <Text style={s.empty}>No frame selected.</Text>;
  const url = `https://decoder2.herokuapp.com/decoded/${encodeURIComponent(entry.frame.correctedHex)}`;
  return <>
    <View style={s.row}>
      <Text style={[s.h3, s.fill]}>OFFICIAL COSPAS-SARSAT DECODER</Text>
      <Button title="Open in browser" icon={ExternalLink} onPress={() => {
        void Linking.openURL(url).catch(reason => setError(String(reason)));
      }} />
    </View>
    {error !== "" && <Text accessibilityRole="alert" style={s.errorText}>{error}</Text>}
    <OfficialDecoder url={url} onError={setError} />
  </>;
}
function Readout({ label, children }: { label: string; children: ReactNode }) {
  return <View style={s.readout}><Text style={s.readoutLabel}>{label}</Text><Text style={s.readoutValue} numberOfLines={1}>{children}</Text></View>;
}
function Metric({ title, rows }: { title: string; rows: [string, string][] }) {
  return <View style={s.metric}><Text style={s.h3}>{title}</Text>{rows.map(([name, value]) =>
    <View key={name} style={s.metricRow}><Text style={s.dt}>{name}</Text><Text style={s.dd}>{value}</Text></View>)}</View>;
}
const Led = ({ tone }: { tone?: "green" | "amber" }) =>
  <View style={[s.led, tone === "green" && { backgroundColor: "#00885f" }, tone === "amber" && { backgroundColor: "#ffdd66" }]} />;

export default function App() {
  const [info, setInfo] = useState<Info | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>("Detection");
  const [status, setStatus] = useState<Info["status"]>("idle");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const { preferences: reception, current: receptionRef, ready: preferencesReady, change: changeReception } = useReceptionPreferences(setError);
  const playSound = useReceptionAudio(setError);
  const fmAudio = useRef<ReturnType<typeof createFmAudio> | null>(null);
  const playSoundRef = useRef(playSound);
  playSoundRef.current = playSound;
  const [countdownStart, setCountdownStart] = useState<CountdownStart | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [line, setLine] = useState<SpectrumEvent | null>(null);
  const [channels, setChannels] = useState<AcquisitionChannel[]>([]);
  const [sgbDetections, setSgbDetections] = useState(0);
  const previousSgbCandidates = useRef(0);
  const receiverActionPending = useRef(false);
  const [fgbDetections, setFgbDetections] = useState(0);
  const previousFgbCandidates = useRef(0);
  const [metrics, setMetrics] = useState<{ samples: number; diagnostics: Diagnostics; gainIndex?: number; clippedSamples?: number } | null>(null);
  const [session, setSession] = useState<{ source: "rtl" | "sample"; centerHz: number; sampleRateHz: number; durationSeconds: number | null; noisePrerollMs?: number } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [center, setCenter] = useState(406.05);
  const [gain, setGain] = useState(8);
  const [agc, setAgc] = useState(true);
  const [device, setDevice] = useState("");
  const [sample, setSample] = useState("sgb.wav");
  const [useSampleProfile, setUseSampleProfile] = useState(true);
  const [removeDc, setRemoveDc] = useState(false);
  const [preroll, setPreroll] = useState(0);
  const [base, setBase] = useState(27);
  const [range, setRange] = useState(11);
  const [waterfallAutomatic, setWaterfallAutomatic] = useState(true);
  const [calibrationDb, setCalibrationDb] = useState(0);
  const [average, setAverage] = useState(.5);
  const [waterfallSpeed, setWaterfallSpeed] = useState(1);
  const [transport, setTransport] = useState<Transport | null>(null);
  const [frameSource] = useState({ label: null as string | null, centerHz: 406050000, sequence: 0 });

  async function refresh(target = transport) {
    if (!target) return;
    const parsed = await target.info();
    setInfo(parsed);
    setSettings(previous => previous ?? parsed.settings);
  }
  const devices = info?.devices;
  useEffect(() => {
    if (!devices) return;
    const addresses = devices.map(({ bus, address }) => `${bus}:${address}`);
    setDevice(previous => addresses.length === 1 ? addresses[0] : addresses.includes(previous) ? previous : "");
  }, [devices]);

  useEffect(() => {
    let active = true;
    const fm = createFmAudio(setError);
    fmAudio.current = fm;
    let unwatchDevices: (() => void) | undefined;
    const handle = (message: ServerEvent) => {
      if (!active) return;
      try {
        if (message.type === "status") {
          if (message.status === "stopping" || message.status === "retrying") fm.reset();
          if (message.status === "running" || message.status === "idle") receiverActionPending.current = false;
          setStatus(message.status);
          if (message.status !== "running") setCountdownStart(null);
          if (message.status === "idle") { setChannels([]); setSgbDetections(0); setFgbDetections(0); }
        }
        else if (message.type === "error") { receiverActionPending.current = false; setError(message.message); }
        else if (message.type === "session") {
          fm.reset();
          setCountdownStart(null);
          frameSource.label = message.label ?? (message.source === "rtl" ? "RTL-SDR" : "WAV I/Q");
          frameSource.centerHz = message.centerHz;
          previousSgbCandidates.current = 0;
          previousFgbCandidates.current = 0;
          setSgbDetections(0);
          setFgbDetections(0);
          setSession(message); setLine(null); setChannels([]); setMetrics(null); setEpoch(value => value + 1);
        } else if (message.type === "fmAudio") {
          const prefs = receptionRef.current;
          if (prefs.fgbFm && prefs.fgbFmVolume > 0) fm.write(message.pcm, prefs.fgbFmVolume);
        } else if (message.type === "spectrum") setLine(message);
        else if (message.type === "acquisition") setChannels(message.channels);
        else if (message.type === "metrics") {
          const candidates = message.diagnostics.sgbCandidates;
          setSgbDetections(Math.max(0, candidates - previousSgbCandidates.current));
          previousSgbCandidates.current = candidates;
          const fgbCandidates = message.diagnostics.fgbCandidates;
          setFgbDetections(Math.max(0, fgbCandidates - previousFgbCandidates.current));
          previousFgbCandidates.current = fgbCandidates;
          setMetrics(message);
        }
        else if (message.type === "complete") { setChannels([]); setSgbDetections(0); setFgbDetections(0); setMetrics(previous => ({
          ...(previous ?? {}), samples: message.result.dspSamples ?? previous?.samples ?? 0,
          diagnostics: message.result.diagnostics,
        })); }
        else if (message.type === "frame") {
          if (!frameSource.label) throw new Error("Frame received before its source was identified");
          const entry = { id: ++frameSource.sequence, frame: message.frame, received: new Date().toISOString(),
            source: frameSource.label, centerHz: frameSource.centerHz };
          setEntries(values => [...values.slice(-199), entry]);
          const preferences = receptionRef.current;
          if (!isFrameFiltered(entry.frame, preferences)) {
            setSelected(entry.id);
            if (entry.frame.generation === 1 && preferences.countdown)
              setCountdownStart({ id: entry.id, at: Date.now() });
          }
          const sound = frameNotification(entry.frame, preferences);
          if (sound) playSoundRef.current(sound, preferences.volume);
        }
      } catch (reason) { setError(`Invalid UI event: ${reason instanceof Error ? reason.message : String(reason)}`); }
    };
    const created = createTransport({ event: handle, connection: (value, reason) => {
      if (!active) return;
      setConnected(value);
      if (!value) { fm.reset(); receiverActionPending.current = false; setCountdownStart(null); setChannels([]); setSgbDetections(0); setFgbDetections(0); if (reason) setError(reason); }
    } });
    setTransport(created);
    void refresh(created).then(() => {
      if (!active) return;
      unwatchDevices = created.watchDevices?.(next => setInfo(previous => previous && { ...previous, devices: next }));
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; fmAudio.current = null; fm.close(); unwatchDevices?.(); created.close(); };
  }, []);
  useEffect(() => {
    if (!reception.fgbFm || reception.fgbFmVolume === 0) fmAudio.current?.reset();
    else fmAudio.current?.setVolume(reception.fgbFmVolume);
  }, [reception.fgbFm, reception.fgbFmVolume]);

  const busy = status !== "idle";
  const sampleProfile = info?.sampleProfiles[sample];
  const playback = info && sampleProfile ? playbackConfiguration(info.settings, sampleProfile) : null;
  const playerSettings = useSampleProfile ? playback?.settings : settings;
  const displayedSettings = tab === "Player" ? playerSettings : settings;
  function start(source: "rtl" | "sample") {
    setError("");
    if (source === "sample" && useSampleProfile && !playback) {
      setError("No validated profile for this capture. Select manual mode to use Settings.");
      return;
    }
    const location = device.split(":").map(Number);
    const parsed = startSchema.safeParse({ type: "start", source, centerHz: Math.round(center * 1e6),
      gainIndex: gain, agc, sample, removeDc, noisePrerollMs: preroll, settings, fgbFm: receptionRef.current.fgbFm,
      ...(source === "sample" && useSampleProfile ? playback : {}),
      ...(device ? { bus: location[0], address: location[1] } : {}) });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(" · ")); return; }
    if (parsed.data.fgbFm && parsed.data.settings.fgb) fmAudio.current?.activate();
    transport?.send(parsed.data);
    return true;
  }
  function stop() { transport?.send({ type: "stop" }); }
  function toggleReceiver() {
    if (receiverActionPending.current) return;
    receiverActionPending.current = true;
    if (busy) stop();
    else if (!start("rtl")) receiverActionPending.current = false;
  }
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(old => old ? { ...old, [key]: value } : old);
  }
  async function pick() {
    try {
      const name = await transport?.pickFile?.();
      if (!name) return;
      await refresh();
      setSample(name);
      setUseSampleProfile(false);
    } catch (reason) { setError(String(reason)); }
  }
  function exportJson() {
    const json = JSON.stringify(entries, null, 2);
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "sarsat-decodes.json"; link.click(); URL.revokeObjectURL(url);
    } else void Share.share({ title: "sarsat-decodes.json", message: json });
  }
  const visibleEntries = useMemo(() => entries.filter(entry => !isFrameFiltered(entry.frame, reception)),
    [entries, reception.filterInvalid, reception.filterOrbitographic]);
  const activeFrame = visibleEntries.find(entry => entry.id === selected) ?? visibleEntries.at(-1);
  const elapsed = session && metrics ? Math.max(0, metrics.samples / session.sampleRateHz - (session.noisePrerollMs ?? 0) / 1000) : 0;
  const d = metrics?.diagnostics;
  const decoderLocked = busy || !displayedSettings || (tab === "Player" && useSampleProfile);
  const duration = session?.durationSeconds ?? 1;
  const receiving = connected && status === "running";
  const activeIndex = activeFrame ? visibleEntries.findIndex(entry => entry.id === activeFrame.id) : -1;
  const frameCount = visibleEntries.length === entries.length ? String(entries.length) : `${visibleEntries.length}/${entries.length}`;
  const spectrum = (compact = false) => <Spectrum line={line} channels={channels} centerHz={session?.centerHz ?? center * 1e6}
    epoch={epoch} floor={base} range={range} average={average} speed={waterfallSpeed}
    sgbDetections={sgbDetections} fgbDetections={fgbDetections} compact={compact}
    automatic={waterfallAutomatic} calibrationDb={session?.source === "rtl" ? calibrationDb : 0} relative={session?.source === "sample"} />;
  const frameActions = <View style={[s.row, { padding: 8 }]}>
    <Text style={[s.h3, { flex: 1, marginBottom: 0 }]}>FRAMES ({frameCount})</Text>
    <Button iconOnly icon={Eraser} title="Clear frames" disabled={!entries.length} onPress={() => setConfirmClear(true)} />
    <Button iconOnly icon={Download} title="Export JSON" disabled={!entries.length} onPress={exportJson} />
  </View>;

  return <View style={s.main}>
    {confirmClear && <ActionPopup title="Clear all received frames?" close={() => setConfirmClear(false)} actions={[
      { label: "Cancel", icon: X, run: () => {} },
      { label: "Clear all frames", icon: Eraser, kind: "stop", run: () => { setEntries([]); setSelected(null); } },
    ]} />}
    <View style={s.titlebar}><View style={s.brand}><RadioTower size={28} color="#3fe6e6" /><Text style={s.brandStrong}>SarsatSDR</Text>
      <Text style={s.brandSpan}>COSPAS-SARSAT · 406.000 MHz · FGB / SGB</Text></View>
      <View style={s.row}>
        <View style={s.row}><Led tone={connected ? "green" : undefined} /><Text style={s.connection}>
          {connected ? Platform.OS === "web" ? "CONNECTED" : "ONLINE" : "OFFLINE"} · RTL-SDR</Text></View>
        <View style={s.row}><Led tone={receiving ? "green" : undefined} />
          <Text numberOfLines={1} style={[s.connection, s.receivingLabel]}>{receiving ? "RECEIVING" : status === "retrying" ? "RETRYING" : "STOPPED"}</Text></View>
        <AcquisitionSpinner running={receiving} start={countdownStart} preferences={reception} play={playSound} />
        <Button iconOnly kind={busy ? "stop" : "primary"} icon={busy ? Square : Play}
          backgroundColor={busy ? "#4a1616" : undefined} title={busy ? "Stop reception" : "Start reception"}
          disabled={!connected || !preferencesReady || status === "starting" || status === "stopping" || (!busy && (!settings || !info?.devices.length))}
          onPress={toggleReceiver} />
      </View></View>
    {!!error && <View accessibilityRole="alert" style={s.error}><Text style={s.errorText}><Text style={{ fontWeight: "bold" }}>ERROR </Text>{error}</Text>
      <Pressable accessibilityLabel="Dismiss error" onPress={() => setError("")}><Text style={[s.errorText, { fontSize: 22 }]}>×</Text></Pressable></View>}
    {tab === "Detection" && <View style={s.dashboard}>
      <View style={s.dashboardColumn}>
        <View style={s.dashboardTop} accessibilityLabel="Detection spectrum">{spectrum(true)}</View>
        <View style={s.dashboardBottom}>
          <Text style={[s.h3, { marginBottom: 0, padding: 8 }]}>FRAMES ({frameCount})</Text>
          <FrameTable entries={visibleEntries} active={activeFrame} select={setSelected} filtered={entries.length > 0} compact />
        </View>
      </View>
      <View style={s.dashboardColumn}>
        <View style={s.dashboardTop}><FrameDetail entry={activeFrame} compact /></View>
        <View style={s.dashboardBottom}><MapPanel entry={activeFrame} compact /></View>
      </View>
    </View>}
    {tab === "Frames" && <View style={s.split}>
      <View style={[s.splitColumn, { flex: 2 }]}>{frameActions}<FrameTable entries={visibleEntries} active={activeFrame} select={setSelected} filtered={entries.length > 0} /></View>
      <View style={[s.splitColumn, { flex: 3 }]}><FrameDetail entry={activeFrame} /></View>
    </View>}
    {tab === "Map" && <View style={s.fixedPage}><MapPanel entry={activeFrame} /></View>}
    {tab === "Detail" && <View style={s.fixedPage}><OfficialDetail key={activeFrame?.id} entry={activeFrame} /></View>}
    {(tab === "Receiver" || tab === "Player" || tab === "Signal" || tab === "Settings") &&
    <ScrollView style={s.fill} contentContainerStyle={{ paddingBottom: 12 }}>
        {tab === "Player" && <View style={s.panel}><Text style={s.h2}>Player <Text style={s.h2Small}>Native I/Q capture playback</Text></Text>
          <View style={s.row}>
            <Select label="WAV capture" disabled={busy} value={sample} onChange={setSample}
              items={(info?.samples ?? []).map(name => ({ label: name, value: name }))} />
            {transport?.pickFile && <Button icon={FolderOpen} title="OPEN WAV…" disabled={busy} onPress={() => { void pick(); }} />}
            <Check label="Validated capture profile" value={useSampleProfile} disabled={busy} onChange={setUseSampleProfile} />
            <Check label="Explicit DC removal" value={useSampleProfile ? playback?.removeDc ?? false : removeDc}
              disabled={busy || useSampleProfile} onChange={setRemoveDc} />
            <NumberField label="Noise preroll · ms" disabled={busy || useSampleProfile}
              value={useSampleProfile ? playback?.noisePrerollMs ?? 0 : preroll} onChange={setPreroll} />
            <Button kind="primary" icon={Play} title="PLAY" disabled={busy || !connected || !settings || !preferencesReady} onPress={() => start("sample")} />
            <Button icon={Square} title="STOP" disabled={!busy} onPress={stop} />
          </View>
          <View accessibilityLabel="Capture progress" style={s.progress}>
            <View style={[s.progressBar, { width: `${Math.min(100, Math.min(elapsed, duration) / duration * 100)}%` }]} /></View>
          {useSampleProfile ? playback ? <Text style={s.p}>Active profile: {playback.settings.fgb ? "FGB" : ""}{playback.settings.fgb && playback.settings.sgb ? " + " : ""}{playback.settings.sgb ? "SGB" : ""}.
            {playback.settings.fgb && ` OverPeak ${playback.settings.fgbOverPeakDb} dB; average ${playback.settings.fgbAverage}; RunTime ${playback.settings.fgbRuntimeMs} ms; Alpha ${playback.settings.fgbAlpha}; Beta ${playback.settings.fgbBeta}; Zeta ${playback.settings.fgbZeta}; max BCH-1 errors ${playback.settings.fgbMaxErrors}; max BCH-2 errors ${playback.settings.fgbBch2MaxErrors}; max header errors ${playback.settings.fgbHeaderErrors}.`}
            </Text>
            : info ? <Text style={[s.p, { color: "#ff8484" }]}>No validated profile. Select manual mode.</Text>
            : <Text style={s.p}>Loading capture profiles...</Text>
            : <Text style={s.p}>Manual mode: DSP settings from Settings, DC removal and noise preroll above.</Text>}
          </View>}
      {(tab === "Receiver" || tab === "Player") && spectrum()}
      {tab === "Receiver" && <>
        <View style={s.displayControls}>
          <Range label="FFT Average" value={average} min={.01} max={.99} step={.01} onChange={setAverage} digits={2} />
          <Check label="WF Auto" value={waterfallAutomatic} onChange={setWaterfallAutomatic} />
          <Range label="WF Base" value={base} min={0} max={100} step={1} onChange={setBase} disabled={waterfallAutomatic} />
          <Range label="WF Range" value={range} min={0} max={100} step={1} onChange={setRange} disabled={waterfallAutomatic} />
          <Range label={`WF Duration: ${(7 / waterfallSpeed).toFixed(1)} s · Speed`} value={waterfallSpeed} min={.25} max={4} step={.25}
            onChange={setWaterfallSpeed} digits={2} />
        </View>
        <View style={s.toolbar}>
        <NumberField label="Center · MHz" value={Number(center).toFixed(3)} onChange={setCenter} disabled={busy} big />
        <View style={[s.fieldset, decoderLocked && { opacity: .6 }]}><Text style={s.legend}>DECODERS</Text><View style={s.row}>
          <Check label="FGB" value={displayedSettings?.fgb ?? false} disabled={decoderLocked} onChange={value => change("fgb", value)} />
          <Check label="SGB" value={displayedSettings?.sgb ?? false} disabled={decoderLocked} onChange={value => change("sgb", value)} />
          <Check label="Normal PRN" value={displayedSettings?.normalPrn ?? false} disabled={decoderLocked} onChange={value => change("normalPrn", value)} />
          <Check label="Self Test PRN" value={displayedSettings?.testPrn ?? false} disabled={decoderLocked} onChange={value => change("testPrn", value)} />
        </View></View>
      </View>
      <View style={s.readouts}>
        <Readout label="RECEIVER STATUS">{status.toUpperCase()}</Readout>
        <Readout label="SOURCE">{session ? session.source === "rtl" ? "RTL-SDR · USB" : "WAV I/Q" : "—"}</Readout>
        <Readout label="I/Q RATE">{session ? `${(session.sampleRateHz / 1000).toFixed(1)} kS/s` : "—"}</Readout>
        <Readout label="PROCESSED SAMPLES">{metrics ? metrics.samples.toLocaleString("en-US") : "—"}</Readout>
        <Readout label="SOURCE TIME">{elapsed.toFixed(1)} s</Readout>
        <Readout label="STORED FRAMES">{entries.length} / 200</Readout>
      </View>
        <View style={s.metrics}>
          <Metric title="FGB ACQUISITION" rows={[["Peak / mean", `${d?.fgbMaxPeakDb.toFixed(2) ?? "—"} dB`],
            ["Candidates", String(d?.fgbCandidates ?? "—")], ["Sync votes", `${d?.fgbMaxSyncVotes ?? "—"} / 16`]]} />
          <Metric title="SGB ACQUISITION" rows={[["Max detection", d?.sgbMaxDetectionLevel.toFixed(2) ?? "—"],
            ["Candidates", String(d?.sgbCandidates ?? "—")], ["Quality / BCH rejects", d ? `${d.sgbQualityRejections} / ${d.sgbBchRejections}` : "—"]]} />
          <Metric title="RF FRONTEND" rows={[["Active preset", String(metrics?.gainIndex ?? "—")],
            ["Clipped I samples", String(metrics?.clippedSamples ?? "—")],
            ["Full BW", line?.fullBandwidthDbm == null ? "—" : `${(line.fullBandwidthDbm + calibrationDb).toFixed(1)} dBm`],
            ["RTL calibration", `${calibrationDb.toFixed(1)} dB`]]} />
        </View>
      </>}

      {tab === "Signal" && <Signal entry={activeFrame} />}

      {tab === "Settings" && <View style={s.panel}><Text style={s.h2}>Settings</Text>
        <View style={s.fieldset}><Text style={s.legend}>RECEPTION · APPLIED IMMEDIATELY · SAVED ON THIS DEVICE</Text>
          <View style={s.settingsGrid}>
            <Check label="Frame audio notifications" value={reception.notifications} disabled={!preferencesReady}
              onChange={value => changeReception("notifications", value)} />
            <Range label="Notification volume · %" value={Math.round(reception.volume * 100)} min={0} max={100} step={1}
              disabled={!preferencesReady} onChange={value => changeReception("volume", value / 100)} />
            <Check label="FGB FM audio (next start)" value={reception.fgbFm} disabled={!preferencesReady}
              onChange={value => changeReception("fgbFm", value)} />
            <Range label="FGB FM volume · %" value={Math.round(reception.fgbFmVolume * 100)} min={0} max={100} step={1}
              disabled={!preferencesReady || !reception.fgbFm} onChange={value => changeReception("fgbFmVolume", value / 100)} />
            <Check label="Filter invalid frames" value={reception.filterInvalid} disabled={!preferencesReady}
              onChange={value => changeReception("filterInvalid", value)} />
            <Check label="Filter system frames" value={reception.filterOrbitographic} disabled={!preferencesReady}
              onChange={value => changeReception("filterOrbitographic", value)} />
            <Check label="FGB countdown" value={reception.countdown} disabled={!preferencesReady}
              onChange={value => changeReception("countdown", value)} />
            <NumberField label="Countdown duration · seconds" value={reception.countdownSeconds} disabled={!preferencesReady}
              onChange={value => changeReception("countdownSeconds", value)} />
            <Check label="Countdown beep" value={reception.countdownBeep} disabled={!preferencesReady}
              onChange={value => changeReception("countdownBeep", value)} />
            <Check label="Auto reload countdown" value={reception.autoReloadCountdown} disabled={!preferencesReady}
              onChange={value => changeReception("autoReloadCountdown", value)} />
          </View>
          <Text style={s.p}>Filters hide frames only; all received frames remain stored (latest 200) and included in JSON exports.
            System frame filtering covers FGB ORB and SGB SYSTM.
            The counter counts up at acquisition start and after countdown expiry without auto reload.
            Each unfiltered FGB starts a countdown. Long press the spinner to count up from zero until the next unfiltered FGB.
            Beeps at 5, 4, 3, 2 and 1 seconds use notification volume, independently of frame audio notifications.
            Duration: 1–3600 seconds; changes apply to the next countdown.</Text>
        </View>
        <Text style={s.p}>Receiver and DSP settings below apply on next start.</Text>
        <View style={s.fieldset}><Text style={s.legend}>RTL-SDR · 921600 complex samples/s · Bias-T OFF</Text>
          <View style={s.settingsGrid}>
            <Select label="USB device" value={device} onChange={setDevice} disabled={busy || !settings}
              items={[{ label: info?.devices.length ? "Select a device" : "No device detected", value: "" },
                ...(info?.devices ?? []).map(value => ({ value: `${value.bus}:${value.address}`,
                  label: `${value.vendorId.toString(16).padStart(4, "0")}:${value.productId.toString(16).padStart(4, "0")} · bus ${value.bus}, address ${value.address}` }))]} />
            <NumberField style={s.setting} label="Initial gain preset · 0–11" value={gain} disabled={busy} onChange={setGain} />
            <View style={s.setting}><Check label="FE_AGC" value={agc} disabled={busy} onChange={setAgc} /></View>
            <NumberField style={s.setting} label="RTL calibration · dB" value={calibrationDb} onChange={setCalibrationDb} />
            {numericSettings.map(field => <NumberField key={field.key} style={s.setting} label={field.label} disabled={busy || !settings}
              value={settings?.[field.key]} onChange={value => change(field.key, Math.min(field.max ?? Infinity, Math.max(field.min ?? 0, value)))} />)}
            <Select label="PRN alignment" value={String(settings?.prnAlignment ?? 2)} disabled={busy || !settings}
              onChange={value => change("prnAlignment", Number(value))}
              items={[{ label: "Early", value: "0" }, { label: "Norm", value: "1" }, { label: "Late", value: "2" }]} />
            <View style={s.setting}><Check label="SGB Quality Check" value={settings?.qualityCheck ?? true} disabled={busy || !settings} onChange={value => change("qualityCheck", value)} /></View>
            <View style={s.setting}><Check label="Show invalid / over-limit SGB BCH" value={settings?.showBchFailures ?? false} disabled={busy || !settings} onChange={value => change("showBchFailures", value)} /></View>
          </View></View>
        <View style={s.row}>
          <Button icon={Usb} title="REFRESH USB" disabled={busy} onPress={() => { void refresh().catch(reason => setError(String(reason))); }} />
          <Button icon={RefreshCw} title="NATIVE DEFAULTS" disabled={busy || !info} onPress={() => info && setSettings(info.settings)} /></View>
        <Text style={s.p}>DSP defaults are read from the C API. Initial gain preset: 8.
          Search Depth: ±{((settings?.searchDepth ?? 9) * 1.2 / 9).toFixed(3)} kHz.
          Settings apply to RTL-SDR reception and manual WAV playback; validated capture profiles are independent.
          Stop the session before changing DSP settings. Receiver and DSP settings are not saved yet.</Text>
        <Text style={s.p}>RTL calibration adds an offset to FFT and Full BW without changing decoding.
          With a known RF source, enter known level minus displayed level. Default: 0 dB; adjust for each device.
          Without a calibrated source, dBm values are estimates. WAV levels remain relative.
          WF Auto follows the noise floor slowly; disable it to use manual Base/Range.</Text>
      </View>}
    </ScrollView>}
    <View style={s.nav}>
      {tabs.map(name => {
        const Icon = tabIcons[name];
        const arrow = (direction: -1 | 1) => <Pressable key={direction} accessibilityRole="button"
          accessibilityLabel={direction === -1 ? "Previous frame" : "Next frame"}
          disabled={activeIndex < 0 || activeIndex + direction < 0 || activeIndex + direction >= visibleEntries.length}
          onPress={() => setSelected(visibleEntries[activeIndex + direction].id)}
          style={[s.navArrow, (activeIndex < 0 || activeIndex + direction < 0 || activeIndex + direction >= visibleEntries.length) && { opacity: .3 }]}>
          {direction === -1 ? <ArrowBigLeft size={22} color="#00ffff" /> : <ArrowBigRight size={22} color="#00ffff" />}
        </Pressable>;
        return <View key={name} style={[s.navItem, name === "Frames" && { flex: 1.8 }]}>
          {name === "Frames" && arrow(-1)}
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === name }}
            accessibilityLabel={name === "Frames" ? `Frames (${activeIndex + 1}/${visibleEntries.length})` : name}
            onPress={() => setTab(name)} style={[s.navTab, tab === name && s.navSelected]}>
            <Icon size={22} color={tab === name ? "#00ffff" : "#98a3a3"} />
            <Text style={[s.navLabel, tab === name && { color: "#00ffff" }]} numberOfLines={1}>
              {name === "Frames" ? `Frames (${activeIndex + 1}/${visibleEntries.length})` : name}</Text>
          </Pressable>
          {name === "Frames" && arrow(1)}
        </View>;
      })}
    </View>
  </View>;
}

const mono = Platform.select({ web: "Consolas,monospace", default: "monospace" });
const s = StyleSheet.create({
  popupBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", alignItems: "center" },
  popup: { minWidth: 250, maxWidth: "90%", gap: 8, padding: 16, borderRadius: 10, borderWidth: 1,
    borderColor: "#335555", backgroundColor: "#002222" },
  popupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  main: { flex: 1, backgroundColor: "#001000" },
  titlebar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#002222", minHeight: 58, paddingVertical: 5, paddingHorizontal: 20 },
  brand: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center", flexShrink: 1 },
  brandStrong: { fontSize: 20, letterSpacing: 1, color: "#3fe6e6", fontWeight: "700" },
  brandSpan: { fontSize: 10, letterSpacing: 1.3, color: "#99baba" },
  connection: { fontSize: 10, color: "#ffffff", letterSpacing: .5 },
  receivingLabel: { width: 74, flexShrink: 0 },
  fill: { flex: 1, minHeight: 0, minWidth: 0 },
  dashboard: { flex: 1, minHeight: 0, flexDirection: "row", padding: 6, gap: 6 },
  dashboardColumn: { flex: 1, minWidth: 0, minHeight: 0, gap: 6 },
  dashboardTop: { flex: 1.08, minHeight: 0, overflow: "hidden", borderWidth: 1, borderColor: "#003333", borderRadius: 8 },
  dashboardBottom: { flex: 1, minHeight: 0, overflow: "hidden", borderWidth: 1, borderColor: "#003333", borderRadius: 8 },
  split: { flex: 1, minHeight: 0, flexDirection: "row", padding: 8, gap: 8 },
  splitColumn: { flex: 1, minWidth: 0, minHeight: 0, borderWidth: 1, borderColor: "#003333", borderRadius: 8, overflow: "hidden" },
  fixedPage: { flex: 1, minHeight: 0, padding: 8 },
  detailPane: { flex: 1, minHeight: 0, padding: 10, backgroundColor: "#001a1a", overflow: "hidden" },
  fullDetail: { padding: 10, backgroundColor: "#001a1a" },
  frameHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  frameHeaderTitle: { flex: 1, marginBottom: 0 },
  frameHeaderTime: { flex: 1.1, textAlign: "right", fontSize: 10, color: "#ffffff" },
  frameHeaderMode: { flex: 1.4, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center" },
  frameHeaderText: { fontSize: 10, color: "#ffffff" },
  summaryColumns: { flex: 1, minHeight: 0, flexDirection: "row", gap: 12 },
  summaryColumn: { flex: 1, minWidth: 0, gap: 3 },
  summaryBase: { gap: 3 },
  locationRow: { flexDirection: "row", alignItems: "stretch", gap: 6 },
  locationCopy: { width: 44, minHeight: 44, justifyContent: "center", alignItems: "center", borderWidth: 1,
    borderColor: "#335555", borderRadius: 6, backgroundColor: "#002222" },
  summaryControl: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  summaryMeasure: { position: "absolute", left: 0, right: 0, top: 0, opacity: 0 },
  summaryLine: { fontSize: 11, lineHeight: 15, color: "#ffffff" },
  summaryLabel: { fontSize: 11, color: "#00ffff", fontWeight: "bold" },
  emergencyLabel: { color: "#ff4444" },
  metadataGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metadataColumn: { flexBasis: 250, flexGrow: 1, minWidth: 0 },
  fieldSections: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 10, marginTop: 12 },
  fieldSection: { flexBasis: 300, flexGrow: 1, minWidth: 0, borderWidth: 1, borderColor: "#003333", padding: 8 },
  fieldSectionTitle: { fontSize: 11, fontWeight: "bold", color: "#00ffff", marginBottom: 6 },
  fullFieldRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: "#003333" },
  mapPane: { flex: 1, minHeight: 0, padding: 10, backgroundColor: "#001a1a" },
  mapHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  mapContent: { flex: 1, minHeight: 0, flexDirection: "row", gap: 8 },
  mapActions: { width: 64, gap: 6 },
  emptyPane: { flex: 1, padding: 12, alignItems: "center", justifyContent: "center", gap: 8 },
  mapLink: { minHeight: 72, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 8, backgroundColor: "#245cad" },
  mapLinkText: { fontSize: 10, color: "#fff", textAlign: "center" },
  nav: { flexDirection: "row", flexShrink: 0, backgroundColor: "#001a1a", borderTopWidth: 1, borderTopColor: "#335555", paddingVertical: 5, paddingHorizontal: 4, gap: 2 },
  navItem: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" },
  navTab: { flex: 1, minWidth: 0, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 12 },
  navSelected: { backgroundColor: "#004444" },
  navLabel: { fontSize: 10, color: "#98a3a3" },
  navArrow: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  button: { flexDirection: "row", gap: 8, borderWidth: 1, borderColor: "#335555", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: "#003333", minHeight: 48, justifyContent: "center", alignItems: "center" },
  buttonText: { color: "#ffffff", fontSize: 13 },
  iconButton: { width: 48, height: 48, minHeight: 48, borderRadius: 8, paddingHorizontal: 0, paddingVertical: 0 },
  primary: { backgroundColor: "#00885f", borderColor: "#00885f" },
  check: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 40 },
  box: { width: 20, height: 20, borderWidth: 1, borderColor: "#557777", borderRadius: 3, backgroundColor: "#001a1a", alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: "#00885f", borderColor: "#00885f" },
  tick: { color: "#fff", fontSize: 14, lineHeight: 16 },
  small: { fontSize: 12, color: "#ffffff" },
  field: { gap: 5 },
  label: { fontSize: 11, fontWeight: "bold", color: "#00ffff" },
  input: { borderWidth: 1, borderColor: "#335555", borderRadius: 6, backgroundColor: "#001a1a", color: "#ffffff", paddingVertical: 6, paddingHorizontal: 8, minWidth: 118, fontSize: 14 },
  bigInput: { fontFamily: mono, fontSize: 20, color: "#00ffff", width: 170 },
  picker: { borderWidth: 1, borderColor: "#335555", backgroundColor: "#001a1a", borderRadius: 2 },
  range: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 14, alignItems: "center", padding: 15, paddingHorizontal: 18, backgroundColor: "#001a1a", borderBottomWidth: 1, borderBottomColor: "#003333" },
  fieldset: { borderWidth: 1, borderColor: "#335555", borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "#001a1a" },
  legend: { fontSize: 10, color: "#99baba", letterSpacing: 1, marginBottom: 2 },
  readouts: { flexDirection: "row", flexWrap: "wrap", gap: 1, backgroundColor: "#003333", margin: 15, marginHorizontal: 18, borderWidth: 1, borderColor: "#003333", borderRadius: 3, overflow: "hidden" },
  readout: { flexGrow: 1, flexBasis: 150, backgroundColor: "#001a1a", paddingVertical: 11, paddingHorizontal: 13 },
  readoutLabel: { color: "#99baba", fontSize: 9, letterSpacing: .8, marginBottom: 8 },
  readoutValue: { fontFamily: mono, fontSize: 14, color: "#ffffff" },
  displayControls: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-around", gap: 12, paddingVertical: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "#003333" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 13, paddingVertical: 15, paddingHorizontal: 18 },
  metric: { flexGrow: 1, flexBasis: 260, backgroundColor: "#001a1a", borderWidth: 1, borderColor: "#003333", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 15 },
  metricRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  h3: { fontSize: 10, letterSpacing: 1, marginBottom: 12, color: "#00ffff", fontWeight: "bold" },
  dt: { color: "#99baba", fontSize: 12 },
  dd: { fontFamily: mono, fontSize: 12, color: "#ffffff" },
  panel: { margin: 15, marginHorizontal: 18, backgroundColor: "#001a1a", borderWidth: 1, borderColor: "#003333", borderRadius: 12, padding: 17 },
  h2: { fontSize: 12, letterSpacing: 1, marginBottom: 18, color: "#00ffff", fontWeight: "bold" },
  h2Small: { fontSize: 11, fontWeight: "normal", letterSpacing: 0, color: "#99baba" },
  p: { fontSize: 11, color: "#99baba", lineHeight: 19, marginTop: 8 },
  progress: { height: 7, backgroundColor: "#003333", borderRadius: 3, marginTop: 10, overflow: "hidden" },
  progressBar: { height: 7, backgroundColor: "#00ffff" },
  empty: { color: "#99baba", textAlign: "center", fontSize: 13 },
  emptyStrong: { fontSize: 18, color: "#00ffff" },
  tr: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#003333" },
  th: { backgroundColor: "#003333", borderBottomColor: "#335555" },
  thText: { color: "#99baba", fontSize: 11, paddingVertical: 11, paddingHorizontal: 9 },
  td: { fontSize: 11, paddingVertical: 10, paddingHorizontal: 9, color: "#ffffff" },
  tableMeasure: { position: "absolute", opacity: 0, fontFamily: mono, fontSize: 11 },
  tableBadges: { alignItems: "flex-start", gap: 2, paddingHorizontal: 9 },
  tableModeIcon: { paddingVertical: 10 },
  cell: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", paddingHorizontal: 4 },
  link: { color: "#00ffff", textDecorationLine: "underline" },
  mono: { fontFamily: mono },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginVertical: 4 },
  badge: { borderWidth: 1, paddingVertical: 2, paddingHorizontal: 5, borderRadius: 2, fontFamily: mono, fontSize: 10, overflow: "hidden" },
  valid: { color: "#00ff00", backgroundColor: "#003000", borderColor: "#00885f" },
  invalid: { color: "#ff8484", backgroundColor: "#330f0f", borderColor: "#883333" },
  corrected: { color: "#ffdd66", backgroundColor: "#332600", borderColor: "#998500" },
  detail: { fontSize: 11, color: "#99baba", marginTop: 4 },
  code: { fontSize: 12, color: "#ffffff" },
  fieldName: { flexBasis: "45%", color: "#99baba", fontSize: 12 },
  fieldValue: { flex: 1, fontSize: 12, color: "#ffffff" },
  trace: { backgroundColor: "#001000", borderWidth: 1, borderColor: "#335555", marginVertical: 15 },
  traceHeader: { paddingVertical: 9, paddingHorizontal: 12, backgroundColor: "#002222", flexDirection: "row", justifyContent: "space-between" },
  traceText: { color: "#99baba", fontSize: 11 },
  settingsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 20, paddingVertical: 16 },
  setting: { flexBasis: 260, flexGrow: 1 },
  statusbar: { borderTopWidth: 1, borderTopColor: "#003333", backgroundColor: "#003333", flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 10, paddingVertical: 9, paddingHorizontal: 18 },
  status: { fontSize: 10, color: "#99baba" },
  led: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#555555" },
  error: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#330f0f", borderBottomWidth: 1, borderBottomColor: "#883333", paddingVertical: 12, paddingHorizontal: 18 },
  errorText: { color: "#ff8484", fontSize: 12, flexShrink: 1 },
});
