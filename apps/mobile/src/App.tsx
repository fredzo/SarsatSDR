import { useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, type StyleProp,
  type TextStyle, type ViewStyle } from "react-native";
import { Picker } from "@react-native-picker/picker";
import Slider from "@react-native-community/slider";
import Svg, { Path, Polyline } from "react-native-svg";
import { Activity, Download, Eraser, FileAudio, FileText, FolderOpen, MapPin, MonitorUp, MonitorX,
  Navigation, Play, RadioTower, RefreshCw, Settings as SettingsIcon, Square, Usb, type LucideIcon } from "lucide-react-native";
import { startSchema, playbackConfiguration, type Frame, type Info, type Settings, type SpectrumEvent,
  type Diagnostics, type AcquisitionChannel, type ServerEvent } from "@sarsat/shared/protocol";
import { beaconPosition, googleMapsUrl, wazeUrl } from "@sarsat/shared/beacon-position";
import { Spectrum } from "./Spectrum";
import { BeaconMap } from "./BeaconMap";
import { createTransport } from "./transport";
import type { Transport } from "./transport-types";

type Entry = { id: number; frame: Frame; received: string; source: string; centerHz: number };
const frameMhz = (entry: Entry) => ((entry.centerHz + entry.frame.frequencyOffsetHz) / 1e6).toFixed(6);
const tabs = ["RECEIVER", "Frames", "MAP", "Signal", "Player", "Settings"] as const;
type Tab = typeof tabs[number];
const tabIcons: Record<Tab, LucideIcon> = { RECEIVER: RadioTower, Frames: FileText, MAP: MapPin,
  Signal: Activity, Player: FileAudio, Settings: SettingsIcon };
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
  { key: "fgbMaxErrors", label: "FGB BCH-1 erreurs max", max: 3 },
  { key: "fgbBch2MaxErrors", label: "FGB BCH-2 erreurs max", max: 2 },
  { key: "fgbHeaderErrors", label: "FGB en-tete erreurs max", max: 3 },
  { key: "sgbThreshold", label: "SGB Detection", max: 512 },
  { key: "sgbPhaseGain", label: "SGB PLL Alpha" },
  { key: "sgbFrequencyGain", label: "SGB PLL Beta" },
  { key: "sgbFilter", label: "SGB PLL TC", max: 1 },
  { key: "sgbFeedback", label: "SGB PLL FB" },
  { key: "searchDepth", label: "SGB Search Depth", min: 3, max: 9 },
  { key: "sgbMaxErrors", label: "SGB BCH erreurs max", max: 6 },
];

function Button({ title, onPress, disabled, kind, icon: Icon, backgroundColor }: { title: string; onPress: () => void; disabled?: boolean;
  kind?: "primary" | "stop" | "tab" | "tabActive" | "big"; icon?: LucideIcon; backgroundColor?: string }) {
  const color = kind === "stop" ? "#ff8484" : kind === "tabActive" ? "#00ffff" : kind === "tab" ? "#98a3a3" : "#ffffff";
  return <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled, selected: kind === "tabActive" }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, kind === "primary" && s.primary, kind === "tab" && s.tab, kind === "tabActive" && s.tabActive,
      kind === "big" && s.big, backgroundColor ? { backgroundColor, borderColor: backgroundColor } : undefined,
      pressed && { opacity: .7 }, disabled && { opacity: .45 }]}>
    {Icon && <Icon size={kind === "big" ? 26 : 20} color={color} />}
    <Text style={[s.buttonText, { color }, (kind === "primary" || kind === "tabActive" || kind === "big") && { fontWeight: "600" }]}>{title}</Text>
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
function Badge({ text, tone }: { text: string; tone: "valid" | "invalid" | "corrected" }) {
  return <Text style={[s.badge, s[tone]]}>{text}</Text>;
}
function bchBadges(frame: Frame) {
  return frame.bch.map((bch, n) => {
    const name = frame.generation === 2 ? "BCH" : `BCH${n + 1}`;
    const overLimit = n === 0 && frame.correctionLimit !== undefined &&
      bch.correctedErrors !== null && bch.correctedErrors > frame.correctionLimit;
    const text = !bch.valid ? "FAIL" : overLimit ? `HORS SEUIL · ${bch.correctedErrors} bits`
      : bch.correctedErrors ? `corrige ${bch.correctedErrors} bit${bch.correctedErrors > 1 ? "s" : ""}` : "OK";
    return <Badge key={n} text={`${name} ${text}`} tone={bch.valid && !overLimit ? bch.correctedErrors ? "corrected" : "valid" : "invalid"} />;
  });
}
function headerBadge(frame: Frame) {
  return frame.generation === 1 && frame.headerErrors ?
    <Badge text={`EN-TETE ${frame.headerErrors} bit${frame.headerErrors > 1 ? "s" : ""} ecart`} tone="corrected" /> : null;
}
const Badges = ({ children }: { children: ReactNode }) => <View style={s.badges}>{children}</View>;
function FieldDetails({ frame }: { frame: Frame }) {
  if (!frame.fields?.length) return null;
  const sections = [...new Set(frame.fields.map(field => field.section))];
  return <View style={s.fieldGrid}>{sections.map(section => <View key={section} style={s.fieldSection}>
    <Text style={s.fieldTitle}>{section.toUpperCase()}</Text>
    {frame.fields!.filter(field => field.section === section).map((field, n) =>
      <View key={n} style={s.fieldRow}><Text style={s.fieldName}>{field.name}</Text><Text style={s.fieldValue}>{field.value}</Text></View>)}
  </View>)}</View>;
}
function Trace({ title, trace }: { title: string; trace: NonNullable<Frame["traces"]>["phase"] | undefined }) {
  if (!trace?.values.length) return <Text style={[s.empty, { padding: 25 }]}>{title} : aucune trace recue</Text>;
  const minimum = Math.min(...trace.values), maximum = Math.max(...trace.values);
  const span = Math.max(1e-6, maximum - minimum);
  const points = trace.values.map((value, n) =>
    `${n / Math.max(1, trace.values.length - 1) * 900},${130 - (value - minimum) / span * 115}`).join(" ");
  return <View style={s.trace}><View style={s.traceHeader}><Text style={s.traceText}>{title}</Text>
    <Text style={[s.traceText, { fontSize: 10 }]}>{trace.count} points natifs · pas affiche {trace.stride}</Text></View>
    <Svg width="100%" height={145} viewBox="0 0 900 145" preserveAspectRatio="none" accessibilityLabel={title}>
      <Path d="M0 72 H900 M450 0 V145" stroke="#003333" /><Polyline points={points} fill="none" stroke="#99ec80" strokeWidth={1} />
    </Svg><Text style={[s.traceText, s.mono, { padding: 5, paddingHorizontal: 12, fontSize: 10 }]}>{minimum.toPrecision(4)} … {maximum.toPrecision(4)}</Text></View>;
}
function Signal({ entry }: { entry: Entry | undefined }) {
    return <View style={s.panel}>
      <Text style={s.h2}>Signal <Text style={s.h2Small}>Trame selectionnee dans Frames · derniere recue par defaut</Text></Text>
      {!entry ? <Text style={[s.empty, { paddingVertical: 80 }]}>Aucune trame recue.</Text> : <>
        <Text style={s.detail}>{entry.frame.generation === 1 ? "FGB" : "SGB"} · {entry.source} · Reception : {entry.received}</Text>
        <Text selectable style={[s.mono, s.code]}>{entry.frame.correctedHex}</Text>
        <Text style={s.detail}>{frameMhz(entry)} MHz · t = {entry.frame.timeSeconds.toFixed(6)} s · Δf = {entry.frame.frequencyOffsetHz.toFixed(3)} Hz</Text>
        <Badges>{bchBadges(entry.frame)}{headerBadge(entry.frame)}</Badges>
        <Trace title="Recovered phase / PLL error" trace={entry.frame.traces?.phase} />
        <Trace title="Recovered I" trace={entry.frame.traces?.i} /><Trace title="Recovered Q" trace={entry.frame.traces?.q} />
      </>}
    </View>;
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
  const [tab, setTab] = useState<Tab>("RECEIVER");
  const [status, setStatus] = useState<Info["status"]>("idle");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [line, setLine] = useState<SpectrumEvent | null>(null);
  const [channels, setChannels] = useState<AcquisitionChannel[]>([]);
  const [sgbDetections, setSgbDetections] = useState(0);
  const previousSgbCandidates = useRef(0);
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
    if (parsed.devices.length === 1) setDevice(`${parsed.devices[0].bus}:${parsed.devices[0].address}`);
  }
  useEffect(() => {
    let active = true;
    const handle = (message: ServerEvent) => {
      if (!active) return;
      try {
        if (message.type === "status") {
          setStatus(message.status);
          if (message.status === "idle") { setChannels([]); setSgbDetections(0); }
        }
        else if (message.type === "error") setError(message.message);
        else if (message.type === "session") {
          frameSource.label = message.label ?? (message.source === "rtl" ? "RTL-SDR" : "WAV I/Q");
          frameSource.centerHz = message.centerHz;
          previousSgbCandidates.current = 0;
          setSgbDetections(0);
          setSession(message); setLine(null); setChannels([]); setMetrics(null); setEpoch(value => value + 1);
        } else if (message.type === "spectrum") setLine(message);
        else if (message.type === "acquisition") setChannels(message.channels);
        else if (message.type === "metrics") {
          const candidates = message.diagnostics.sgbCandidates;
          setSgbDetections(Math.max(0, candidates - previousSgbCandidates.current));
          previousSgbCandidates.current = candidates;
          setMetrics(message);
        }
        else if (message.type === "complete") { setChannels([]); setSgbDetections(0); setMetrics(previous => ({
          ...(previous ?? {}), samples: message.result.dspSamples ?? previous?.samples ?? 0,
          diagnostics: message.result.diagnostics,
        })); }
        else if (message.type === "frame") {
          if (!frameSource.label) throw new Error("Trame recue avant identification de sa source");
          const entry = { id: ++frameSource.sequence, frame: message.frame, received: new Date().toISOString(),
            source: frameSource.label, centerHz: frameSource.centerHz };
          setEntries(values => [...values.slice(-199), entry]);
        }
      } catch (reason) { setError(`Evenement UI invalide : ${reason instanceof Error ? reason.message : String(reason)}`); }
    };
    const created = createTransport({ event: handle, connection: (value, reason) => {
      if (!active) return;
      setConnected(value);
      if (!value) { setChannels([]); setSgbDetections(0); if (reason) setError(reason); }
    } });
    setTransport(created);
    void refresh(created).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; created.close(); };
  }, []);

  const busy = status !== "idle";
  const sampleProfile = info?.sampleProfiles[sample];
  const playback = info && sampleProfile ? playbackConfiguration(info.settings, sampleProfile) : null;
  const playerSettings = useSampleProfile ? playback?.settings : settings;
  const displayedSettings = tab === "Player" ? playerSettings : settings;
  function start(source: "rtl" | "sample") {
    setError("");
    if (source === "sample" && useSampleProfile && !playback) {
      setError("Aucun profil valide pour cette capture. Choisir le mode manuel pour utiliser Settings.");
      return;
    }
    const location = device.split(":").map(Number);
    const parsed = startSchema.safeParse({ type: "start", source, centerHz: Math.round(center * 1e6),
      gainIndex: gain, agc, sample, removeDc, noisePrerollMs: preroll, settings,
      ...(source === "sample" && useSampleProfile ? playback : {}),
      ...(device ? { bus: location[0], address: location[1] } : {}) });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(" · ")); return; }
    transport?.send(parsed.data);
  }
  function stop() { transport?.send({ type: "stop" }); }
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
  const activeFrame = entries.find(entry => entry.id === selected) ?? entries.at(-1);
  const located = activeFrame && beaconPosition(activeFrame.frame) ? activeFrame
    : [...entries].reverse().find(entry => beaconPosition(entry.frame));
  const position = located ? beaconPosition(located.frame) : null;
  const elapsed = session && metrics ? Math.max(0, metrics.samples / session.sampleRateHz - (session.noisePrerollMs ?? 0) / 1000) : 0;
  const d = metrics?.diagnostics;
  const decoderLocked = busy || !displayedSettings || (tab === "Player" && useSampleProfile);
  const duration = session?.durationSeconds ?? 1;

  return <View style={s.main}>
    <View style={s.titlebar}><View style={s.brand}><RadioTower size={28} color="#3fe6e6" /><Text style={s.brandStrong}>SarsatSDR</Text>
      <Text style={s.brandSpan}>COSPAS-SARSAT · 406 MHz · FGB / SGB</Text></View>
      <View style={s.row}>{connected ? <MonitorUp size={20} color="#ffffff" /> : <MonitorX size={20} color="#ff8484" />}
        <Led tone={connected ? "green" : undefined} /><Text style={s.connection}>
        {connected ? Platform.OS === "web" ? "LOCAL CONNECTED" : "MOTEUR EMBARQUE" : "OFFLINE"} · C++20 DSP · RTL-SDR</Text></View></View>
    {!!error && <View accessibilityRole="alert" style={s.error}><Text style={s.errorText}><Text style={{ fontWeight: "bold" }}>ERREUR </Text>{error}</Text>
      <Pressable accessibilityLabel="Fermer erreur" onPress={() => setError("")}><Text style={[s.errorText, { fontSize: 22 }]}>×</Text></Pressable></View>}
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
      <View style={s.toolbar}>
        <NumberField label="Centre · MHz" value={center} onChange={setCenter} disabled={busy} big />
        <View style={[s.fieldset, decoderLocked && { opacity: .6 }]}><Text style={s.legend}>DECODERS</Text><View style={s.row}>
          <Check label="FGB" value={displayedSettings?.fgb ?? false} disabled={decoderLocked} onChange={value => change("fgb", value)} />
          <Check label="SGB" value={displayedSettings?.sgb ?? false} disabled={decoderLocked} onChange={value => change("sgb", value)} />
          <Check label="Normal PRN" value={displayedSettings?.normalPrn ?? false} disabled={decoderLocked} onChange={value => change("normalPrn", value)} />
          <Check label="Self Test PRN" value={displayedSettings?.testPrn ?? false} disabled={decoderLocked} onChange={value => change("testPrn", value)} />
        </View></View>
        <View style={s.row}><Button kind="primary" icon={Play} title="RECEVOIR" disabled={busy || !connected || !settings || !info?.devices.length} onPress={() => start("rtl")} />
          <Button kind="stop" icon={Square} title="STOP" disabled={!busy || status === "stopping"} onPress={stop} /></View>
      </View>
      <View style={s.readouts}>
        <Readout label="ETAT RECEPTEUR">{status.toUpperCase()}</Readout>
        <Readout label="SOURCE">{session ? session.source === "rtl" ? "RTL-SDR · USB" : "WAV I/Q" : "—"}</Readout>
        <Readout label="TAUX I/Q">{session ? `${(session.sampleRateHz / 1000).toFixed(1)} kS/s` : "—"}</Readout>
        <Readout label="ECHANTILLONS TRAITES">{metrics ? metrics.samples.toLocaleString("fr-FR") : "—"}</Readout>
        <Readout label="TEMPS SOURCE">{elapsed.toFixed(1)} s</Readout>
        <Readout label="TRAMES EN MEMOIRE">{entries.length} / 200</Readout>
      </View>

      {(tab === "RECEIVER" || tab === "Player") && <View>
        {tab === "Player" && <View style={s.panel}><Text style={s.h2}>Player <Text style={s.h2Small}>Lecture native des captures de regression</Text></Text>
          <View style={s.row}>
            <Select label="Capture WAV" disabled={busy} value={sample} onChange={setSample}
              items={(info?.samples ?? []).map(name => ({ label: name, value: name }))} />
            {transport?.pickFile && <Button icon={FolderOpen} title="OUVRIR WAV…" disabled={busy} onPress={() => { void pick(); }} />}
            <Check label="Profil valide de la capture" value={useSampleProfile} disabled={busy} onChange={setUseSampleProfile} />
            <Check label="Retrait DC explicite" value={useSampleProfile ? playback?.removeDc ?? false : removeDc}
              disabled={busy || useSampleProfile} onChange={setRemoveDc} />
            <NumberField label="Prechauffage · ms" disabled={busy || useSampleProfile}
              value={useSampleProfile ? playback?.noisePrerollMs ?? 0 : preroll} onChange={setPreroll} />
            <Button kind="primary" icon={Play} title="LIRE" disabled={busy || !connected || !settings} onPress={() => start("sample")} />
            <Button icon={Square} title="STOP" disabled={!busy} onPress={stop} />
          </View>
          <View accessibilityLabel="Progression capture" style={s.progress}>
            <View style={[s.progressBar, { width: `${Math.min(100, Math.min(elapsed, duration) / duration * 100)}%` }]} /></View>
          {useSampleProfile ? playback ? <Text style={s.p}>Profil capture actif : {playback.settings.fgb ? "FGB" : ""}{playback.settings.fgb && playback.settings.sgb ? " + " : ""}{playback.settings.sgb ? "SGB" : ""}.
            {playback.settings.fgb && ` OverPeak ${playback.settings.fgbOverPeakDb} dB ; moyenne ${playback.settings.fgbAverage} ; RunTime ${playback.settings.fgbRuntimeMs} ms ; Alpha ${playback.settings.fgbAlpha} ; Beta ${playback.settings.fgbBeta} ; Zeta ${playback.settings.fgbZeta} ; BCH-1 maximum ${playback.settings.fgbMaxErrors} erreurs ; BCH-2 maximum ${playback.settings.fgbBch2MaxErrors} erreurs ; en-tete maximum ${playback.settings.fgbHeaderErrors} erreurs.`}
            {" "}Defauts natifs et adaptations validees du fichier ; reglages radio Settings inchanges.</Text>
            : info ? <Text style={[s.p, { color: "#ff8484" }]}>Aucun profil valide pour cette capture. Selectionner le mode manuel.</Text>
            : <Text style={s.p}>Chargement des profils de capture...</Text>
            : <Text style={s.p}>Mode manuel : parametres DSP de Settings, retrait DC et prechauffage ci-dessus.</Text>}
          <Text style={s.p}>Lecture temps reel ; arret puis relance depuis debut. Pas encore d'enregistrement ni de recherche temporelle.</Text></View>}
        <Spectrum line={line} channels={channels} centerHz={session?.centerHz ?? center * 1e6}
          epoch={epoch} floor={base} range={range} average={average} speed={waterfallSpeed}
          sgbDetections={sgbDetections}
          automatic={waterfallAutomatic} calibrationDb={session?.source === "rtl" ? calibrationDb : 0} relative={session?.source === "sample"} />
        <View style={s.displayControls}>
          <Range label="FFT Average" value={average} min={.01} max={.99} step={.01} onChange={setAverage} digits={2} />
          <Check label="WF Auto" value={waterfallAutomatic} onChange={setWaterfallAutomatic} />
          <Range label="WF Base" value={base} min={0} max={100} step={1} onChange={setBase} disabled={waterfallAutomatic} />
          <Range label="WF Range" value={range} min={0} max={100} step={1} onChange={setRange} disabled={waterfallAutomatic} />
          <Range label="WF Vitesse · x" value={waterfallSpeed} min={.25} max={4} step={.25}
            onChange={setWaterfallSpeed} digits={2} />
        </View>
        <View style={s.metrics}>
          <Metric title="FGB ACQUISITION" rows={[["Peak / mean", `${d?.fgbMaxPeakDb.toFixed(2) ?? "—"} dB`],
            ["Candidats", String(d?.fgbCandidates ?? "—")], ["Sync votes", `${d?.fgbMaxSyncVotes ?? "—"} / 16`]]} />
          <Metric title="SGB ACQUISITION" rows={[["Detection max.", d?.sgbMaxDetectionLevel.toFixed(2) ?? "—"],
            ["Candidats", String(d?.sgbCandidates ?? "—")], ["Rejets qualite / BCH", d ? `${d.sgbQualityRejections} / ${d.sgbBchRejections}` : "—"]]} />
          <Metric title="RF FRONTEND" rows={[["Preset actif", String(metrics?.gainIndex ?? "—")],
            ["I ecretes", String(metrics?.clippedSamples ?? "—")],
            ["Full BW", line?.fullBandwidthDbm == null ? "—" : `${(line.fullBandwidthDbm + calibrationDb).toFixed(1)} dBm`],
            ["Calibration RTL", `${calibrationDb.toFixed(1)} dB`]]} />
        </View>
      </View>}

      {tab === "Frames" && <View style={s.panel}><View style={s.row}>
        <Text style={[s.h2, { flex: 1, marginBottom: 0 }]}>Frames <Text style={s.h2Small}>Trames natives · brut et corrige</Text></Text>
        <Button icon={Eraser} title="EFFACER" onPress={() => { setEntries([]); setSelected(null); }} />
        <Button icon={Download} title="EXPORT JSON" disabled={!entries.length} onPress={exportJson} /></View>
        {!entries.length ? <View style={{ paddingVertical: 80, alignItems: "center" }}><Text style={s.emptyStrong}>Aucune trame recue</Text>
          <Text style={s.empty}>Demarrer reception RTL-SDR ou lecture d'une capture I/Q.</Text>
          <Text style={[s.empty, { fontSize: 11 }]}>Aucune trame de demonstration n'est generee.</Text></View>
          : <ScrollView horizontal style={{ marginTop: 18 }}><View>
            <View style={[s.tr, s.th]}>{["Temps source", "Source", "Gen.", "Mode", "Frequence · MHz", "Δf · Hz", "BCH", "Trame corrigee"].map((name, n) =>
              <Text key={name} style={[s.thText, { width: columns[n] }]}>{name}</Text>)}</View>
            {[...entries].reverse().map(entry => <Pressable key={entry.id} onPress={() => setSelected(entry.id)}
              style={[s.tr, activeFrame?.id === entry.id && { backgroundColor: "#004444" }]}>
              <Text style={[s.td, s.link, { width: columns[0] }]}>{entry.frame.timeSeconds.toFixed(3)} s</Text>
              <Text style={[s.td, { width: columns[1] }]} numberOfLines={1}>{entry.source}</Text>
              <Text style={[s.td, { width: columns[2] }]}>{entry.frame.generation === 1 ? "FGB" : "SGB"}</Text>
              <View style={[s.cell, { width: columns[3] }]}><Text style={s.td}>{entry.frame.mode === "self_test" ? "SELF TEST" : "NORMAL"}</Text>{headerBadge(entry.frame)}</View>
              <Text style={[s.td, s.mono, { width: columns[4] }]}>{frameMhz(entry)}</Text>
              <Text style={[s.td, s.mono, { width: columns[5] }]}>{entry.frame.frequencyOffsetHz.toFixed(1)}</Text>
              <View style={[s.cell, { width: columns[6] }]}><Badges>{bchBadges(entry.frame)}</Badges></View>
              <Text style={[s.td, s.mono, { width: columns[7] }]}>{entry.frame.correctedHex}</Text></Pressable>)}
          </View></ScrollView>}
        {activeFrame && <View style={s.frameDetail}><Text style={s.h3}>TRAME SELECTIONNEE</Text>
          <Text style={s.detail}>Source : {activeFrame.source} · Reception : {activeFrame.received}</Text>
          <Text style={s.detail}>Frequence : <Text style={[s.mono, { fontWeight: "bold" }]}>{frameMhz(activeFrame)} MHz</Text> · Δf = {activeFrame.frame.frequencyOffsetHz.toFixed(1)} Hz · t = {activeFrame.frame.timeSeconds.toFixed(3)} s</Text>
          {activeFrame.frame.correctionLimit !== undefined && <Text style={s.detail}>Limite de correction {activeFrame.frame.generation === 1 ? "BCH-1 FGB" : "BCH SGB"} appliquee : {activeFrame.frame.correctionLimit}
            {activeFrame.frame.bch.length > 1 && activeFrame.frame.bch2Limit !== undefined ? ` · BCH-2 FGB : ${activeFrame.frame.bch2Limit}` : ""}</Text>}
          <Badges>{bchBadges(activeFrame.frame)}{headerBadge(activeFrame.frame)}</Badges>
          <Text style={s.detail}>Brut</Text><Text selectable style={[s.mono, s.code]}>{activeFrame.frame.rawHex}</Text>
          <Text style={s.detail}>Corrige</Text><Text selectable style={[s.mono, s.code]}>{activeFrame.frame.correctedHex}</Text>
          <View style={s.row}><Button icon={Activity} title="OUVRIR SIGNAL" onPress={() => setTab("Signal")} /></View>
          <FieldDetails frame={activeFrame.frame} /></View>}
      </View>}

      {tab === "MAP" && <View style={[s.panel, { minHeight: 520 }]}>
        <Text style={s.h2}>MAP <Text style={s.h2Small}>Position balise · selection Frames ou derniere trame localisee</Text></Text>
        {!located || !position ? <View style={{ paddingVertical: 80, alignItems: "center" }}><Text style={s.emptyStrong}>Aucune position balise</Text>
          <Text style={s.empty}>Aucune trame recue ne contient de position decodee.</Text></View> : <>
          <Text style={s.p}>{located.frame.generation === 1 ? "FGB" : "SGB"} · {located.frame.correctedHex} · t = {located.frame.timeSeconds.toFixed(3)} s ·
            <Text style={[s.mono, { fontWeight: "bold" }]}> {position.lat.toFixed(6)}, {position.lon.toFixed(6)}</Text></Text>
          <View style={{ height: 460 }}><BeaconMap lat={position.lat} lon={position.lon} /></View>
          <View style={[s.row, { marginTop: 12 }]}>
            <View style={{ flex: 1 }}><Button kind="big" icon={MapPin} backgroundColor="#4285F4" title="GOOGLE MAPS" onPress={() => { void Linking.openURL(googleMapsUrl(position.lat, position.lon)); }} /></View>
            <View style={{ flex: 1 }}><Button kind="big" icon={Navigation} backgroundColor="#0DACE5" title="WAZE" onPress={() => { void Linking.openURL(wazeUrl(position.lat, position.lon)); }} /></View>
          </View></>}
      </View>}

      {tab === "Signal" && <Signal entry={activeFrame} />}

      {tab === "Settings" && <View style={s.panel}><Text style={s.h2}>Settings <Text style={s.h2Small}>Appliques au prochain demarrage</Text></Text>
        <View style={s.fieldset}><Text style={s.legend}>RTL-SDR · 921600 echantillons complexes/s · Bias-T OFF</Text>
          <View style={s.settingsGrid}>
            <Select label="Cle USB" value={device} onChange={setDevice} disabled={busy || !settings}
              items={[{ label: info?.devices.length ? "Choisir une cle" : "Aucune cle detectee", value: "" },
                ...(info?.devices ?? []).map(value => ({ value: `${value.bus}:${value.address}`,
                  label: `${value.vendorId.toString(16).padStart(4, "0")}:${value.productId.toString(16).padStart(4, "0")} · bus ${value.bus}, adresse ${value.address}` }))]} />
            <NumberField style={s.setting} label="Preset initial explicite · 0–11" value={gain} disabled={busy} onChange={setGain} />
            <View style={s.setting}><Check label="FE_AGC" value={agc} disabled={busy} onChange={setAgc} /></View>
            <NumberField style={s.setting} label="Calibration RTL · dB" value={calibrationDb} onChange={setCalibrationDb} />
            {numericSettings.map(field => <NumberField key={field.key} style={s.setting} label={field.label} disabled={busy || !settings}
              value={settings?.[field.key]} onChange={value => change(field.key, Math.min(field.max ?? Infinity, Math.max(field.min ?? 0, value)))} />)}
            <Select label="PRN alignment" value={String(settings?.prnAlignment ?? 2)} disabled={busy || !settings}
              onChange={value => change("prnAlignment", Number(value))}
              items={[{ label: "Early", value: "0" }, { label: "Norm", value: "1" }, { label: "Late", value: "2" }]} />
            <View style={s.setting}><Check label="SGB Quality Check" value={settings?.qualityCheck ?? true} disabled={busy || !settings} onChange={value => change("qualityCheck", value)} /></View>
            <View style={s.setting}><Check label="Afficher BCH invalides / hors seuil" value={settings?.showBchFailures ?? false} disabled={busy || !settings} onChange={value => change("showBchFailures", value)} /></View>
          </View></View>
        <View style={s.row}>
          <Button icon={Usb} title="ACTUALISER USB" disabled={busy} onPress={() => { void refresh().catch(reason => setError(String(reason))); }} />
          <Button icon={RefreshCw} title="DEFAUTS MOTEUR NATIF" disabled={busy || !info} onPress={() => info && setSettings(info.settings)} /></View>
        <Text style={s.p}>Defauts DSP lus depuis API C. Gain initial 8 : choix explicite de cette UI.
          Search Depth : {((settings?.searchDepth ?? 9) * 1.2 / 9).toFixed(1)} kHz de part et d'autre.
          Reglages utilises en reception RTL-SDR et en lecture WAV manuelle ; le profil capture du player reste independant.
          Reglages DSP geles pendant session ; arreter avant modification. Pas de sauvegarde INI.</Text>
        <Text style={s.p}>Calibration RTL : correction additive de l'affichage FFT et Full BW, sans effet sur le decodeur.
          Avec une source RF connue, entrer niveau connu moins niveau affiche. Valeur initiale 0 dB ; ajuster pour chaque cle.
          Sans mesure etalon, les dBm restent estimes. Les WAV n'ont pas de puissance RF connue et restent relatifs.
          WF Auto suit lentement le bruit ; le desactiver pour retrouver Base/Range manuels.</Text>
      </View>}
    </ScrollView>
    <View style={s.statusbar}><View style={s.row}><Led tone={connected ? "green" : undefined} /><Text style={s.status}>{transport?.label ?? "—"}</Text></View>
      <Text style={s.status}>FFT reduite 1024 bins · 10 Hz · Waterfall {(7 / waterfallSpeed).toFixed(2)} s</Text><Text style={s.status}>DSP natif C++20</Text></View>
    <ScrollView horizontal style={s.nav} contentContainerStyle={s.navContent}>
      {tabs.map(name => <Button key={name} kind={tab === name ? "tabActive" : "tab"} onPress={() => setTab(name)}
        icon={tabIcons[name]} title={name === "Frames" ? `${name} (${entries.length})` : name} />)}</ScrollView>
  </View>;
}

const columns = [100, 140, 50, 170, 120, 80, 260, 300];
const mono = Platform.select({ web: "Consolas,monospace", default: "monospace" });
const s = StyleSheet.create({
  main: { flex: 1, backgroundColor: "#001000" },
  titlebar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#002222", paddingVertical: 15, paddingHorizontal: 20 },
  brand: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center", flexShrink: 1 },
  brandStrong: { fontSize: 20, letterSpacing: 1, color: "#3fe6e6", fontWeight: "700" },
  brandSpan: { fontSize: 10, letterSpacing: 1.3, color: "#99baba" },
  connection: { fontSize: 10, color: "#ffffff", letterSpacing: .5 },
  nav: { flexGrow: 0, flexShrink: 0, backgroundColor: "#000000", borderTopWidth: 1, borderTopColor: "#003333" },
  navContent: { flexGrow: 1, justifyContent: "space-around", gap: 4, paddingHorizontal: 12, paddingVertical: 7 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  button: { flexDirection: "row", gap: 8, borderWidth: 1, borderColor: "#335555", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: "#003333", minHeight: 48, justifyContent: "center", alignItems: "center" },
  buttonText: { color: "#ffffff", fontSize: 13 },
  primary: { backgroundColor: "#00885f", borderColor: "#00885f" },
  tab: { backgroundColor: "#000000", borderColor: "#000000", borderRadius: 0, borderBottomWidth: 2 },
  tabActive: { backgroundColor: "#002222", borderColor: "#002222", borderBottomColor: "#00ffff", borderRadius: 0, borderBottomWidth: 2 },
  big: { minHeight: 52 },
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
  panel: { margin: 15, marginHorizontal: 18, backgroundColor: "#001a1a", borderWidth: 1, borderColor: "#003333", borderRadius: 12, padding: 17, minHeight: 200 },
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
  cell: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", paddingHorizontal: 4 },
  link: { color: "#00ffff", textDecorationLine: "underline" },
  mono: { fontFamily: mono },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginVertical: 4 },
  badge: { borderWidth: 1, paddingVertical: 2, paddingHorizontal: 5, borderRadius: 2, fontFamily: mono, fontSize: 10, overflow: "hidden" },
  valid: { color: "#00ff00", backgroundColor: "#003000", borderColor: "#00885f" },
  invalid: { color: "#ff8484", backgroundColor: "#330f0f", borderColor: "#883333" },
  corrected: { color: "#ffdd66", backgroundColor: "#332600", borderColor: "#998500" },
  frameDetail: { paddingTop: 22, marginTop: 15, borderTopWidth: 1, borderTopColor: "#335555", gap: 4 },
  detail: { fontSize: 11, color: "#99baba", marginTop: 4 },
  code: { fontSize: 12, color: "#ffffff" },
  fieldGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 15 },
  fieldSection: { flexGrow: 1, flexBasis: 300, borderWidth: 1, borderColor: "#335555", paddingVertical: 8, paddingHorizontal: 12 },
  fieldTitle: { fontSize: 11, letterSpacing: .9, color: "#00ffff", fontWeight: "bold", marginBottom: 6 },
  fieldRow: { flexDirection: "row", gap: 10, paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: "#003333" },
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
