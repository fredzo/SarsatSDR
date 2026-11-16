import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Spectrum } from "./Spectrum";
import { BeaconMap } from "./BeaconMap";
import { infoSchema, serverEventSchema, startSchema, playbackConfiguration, type Frame, type Info,
  type Settings, type SpectrumEvent, type Diagnostics, type AcquisitionChannel } from "@sarsat/shared/protocol";
import "./style.css";

type Entry = { id: number; frame: Frame; received: string; source: string; centerHz: number };
const frameMhz = (entry: Entry) => ((entry.centerHz + entry.frame.frequencyOffsetHz) / 1e6).toFixed(6);
const tabs = ["RECEIVER", "DECODES", "MAP", "ENG FGB", "ENG SGB", "IQ REC PLAYER", "RF CTRL"] as const;
function beaconPosition(frame: Frame) {
  const value = (name: string) => Number(frame.fields?.find(field => field.name === name)?.value);
  const lat = value("Latitude"), lon = value("Longitude");
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
type Tab = typeof tabs[number];
const numericSettings: { key: keyof Pick<Settings, "fgbAlpha" | "fgbBeta" | "fgbOverPeakDb" |
  "fgbZeta" | "fgbAverage" | "fgbRuntimeMs" | "fgbMaxErrors" | "fgbBch2MaxErrors" | "fgbHeaderErrors" | "sgbThreshold" | "sgbPhaseGain" |
  "sgbFrequencyGain" | "sgbFilter" | "sgbFeedback" | "sgbMaxErrors" | "searchDepth">;
  label: string; step: number; min?: number; max?: number }[] = [
  { key: "fgbOverPeakDb", label: "FGB OverPeak · dB", step: .5 },
  { key: "fgbAlpha", label: "FGB PLL Alpha", step: .01 },
  { key: "fgbBeta", label: "FGB PLL Beta", step: .01 },
  { key: "fgbZeta", label: "FGB PLL Zeta", step: .001 },
  { key: "fgbAverage", label: "FGB Detection Average", step: .001, max: 1 },
  { key: "fgbRuntimeMs", label: "FGB RunTime · ms", step: 1, min: 1 },
  { key: "fgbMaxErrors", label: "FGB BCH-1 erreurs max", step: 1, max: 3 },
  { key: "fgbBch2MaxErrors", label: "FGB BCH-2 erreurs max", step: 1, max: 2 },
  { key: "fgbHeaderErrors", label: "FGB en-tete erreurs max", step: 1, max: 3 },
  { key: "sgbThreshold", label: "SGB Detection", step: 1, max: 512 },
  { key: "sgbPhaseGain", label: "SGB PLL Alpha", step: .01 },
  { key: "sgbFrequencyGain", label: "SGB PLL Beta", step: .01 },
  { key: "sgbFilter", label: "SGB PLL TC", step: .01, max: 1 },
  { key: "sgbFeedback", label: "SGB PLL FB", step: 1 },
  { key: "searchDepth", label: "SGB Search Depth", step: 1, min: 3, max: 9 },
  { key: "sgbMaxErrors", label: "SGB BCH erreurs max", step: 1, max: 6 },
];
function bchBadges(frame: Frame) {
  return frame.bch.map((bch, n) => {
    const name = frame.generation === 2 ? "BCH" : `BCH${n + 1}`;
    const overLimit = n === 0 && frame.correctionLimit !== undefined &&
      bch.correctedErrors !== null && bch.correctedErrors > frame.correctionLimit;
    const text = !bch.valid ? "FAIL" : overLimit ? `HORS SEUIL · ${bch.correctedErrors} bits`
      : bch.correctedErrors ? `corrige ${bch.correctedErrors} bit${bch.correctedErrors > 1 ? "s" : ""}` : "OK";
    return <span className={`badge ${bch.valid && !overLimit ? bch.correctedErrors ? "corrected" : "valid" : "invalid"}`} key={n}>
      {name} {text}</span>;
  });
}
function headerBadge(frame: Frame) {
  return frame.generation === 1 && frame.headerErrors ? <span className="badge corrected">
    EN-TETE {frame.headerErrors} bit{frame.headerErrors > 1 ? "s" : ""} ecart</span> : null;
}
function FieldDetails({ frame }: { frame: Frame }) {
  if (!frame.fields?.length) return null;
  const sections = [...new Set(frame.fields.map(field => field.section))];
  return <div className="field-detail">{sections.map(section => <section key={section}><h4>{section}</h4><dl>
    {frame.fields!.filter(field => field.section === section).map((field, n) =>
      <div key={n}><dt>{field.name}</dt><dd>{field.value}</dd></div>)}</dl></section>)}</div>;
}
function Trace({ title, trace }: { title: string; trace: NonNullable<Frame["traces"]>["phase"] | undefined }) {
  if (!trace?.values.length) return <div className="empty small">{title} : aucune trace recue</div>;
  const minimum = Math.min(...trace.values), maximum = Math.max(...trace.values);
  const span = Math.max(1e-6, maximum - minimum);
  const points = trace.values.map((value, n) =>
    `${n / Math.max(1, trace.values.length - 1) * 900},${130 - (value - minimum) / span * 115}`).join(" ");
  return <section className="trace"><header>{title}<span>{trace.count} points natifs · pas affiche {trace.stride}</span></header>
    <svg viewBox="0 0 900 145" role="img" aria-label={title} preserveAspectRatio="none">
      <path d="M0 72 H900 M450 0 V145" stroke="#003333" /><polyline points={points} fill="none" stroke="#99ec80" strokeWidth="1" />
    </svg><footer>{minimum.toPrecision(4)} … {maximum.toPrecision(4)}</footer></section>;
}

function App() {
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
  const [metrics, setMetrics] = useState<{ samples: number; diagnostics: Diagnostics; gainIndex?: number; clippedSamples?: number } | null>(null);
  const [session, setSession] = useState<{ source: "rtl" | "sample"; centerHz: number; sampleRateHz: number; durationSeconds: number | null; noisePrerollMs?: number } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [center, setCenter] = useState("406.050000");
  const [gain, setGain] = useState(8);
  const [agc, setAgc] = useState(true);
  const [device, setDevice] = useState("");
  const [sample, setSample] = useState("sgb.wav");
  const [useSampleProfile, setUseSampleProfile] = useState(true);
  const [removeDc, setRemoveDc] = useState(false);
  const [preroll, setPreroll] = useState(0);
  const [base, setBase] = useState(27);
  const [range, setRange] = useState(11);
  const [average, setAverage] = useState(.5);
  const socket = useRef<WebSocket | null>(null);
  const sequence = useRef(0);
  const frameSource = useRef<string | null>(null);
  const frameCenter = useRef(406050000);

  async function refresh() {
    const response = await fetch("/api/info");
    const data: unknown = await response.json();
    if (!response.ok) throw new Error("Impossible de lire le moteur natif. Verifier build et DLL.");
    const parsed = infoSchema.parse(data);
    setInfo(parsed);
    setSettings(previous => previous ?? parsed.settings);
    if (parsed.devices.length === 1) setDevice(`${parsed.devices[0].bus}:${parsed.devices[0].address}`);
  }
  useEffect(() => {
    let active = true;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/events`);
    socket.current = ws;
    ws.onopen = () => { if (active) setConnected(true); };
    ws.onmessage = event => {
      if (!active) return;
      try {
        const message = serverEventSchema.parse(JSON.parse(String(event.data)));
        if (message.type === "status") {
          setStatus(message.status);
          if (message.status === "idle") setChannels([]);
        }
        else if (message.type === "error") setError(message.message);
        else if (message.type === "session") {
          frameSource.current = message.label ?? (message.source === "rtl" ? "RTL-SDR" : "WAV I/Q");
          frameCenter.current = message.centerHz;
          setSession(message); setLine(null); setChannels([]); setMetrics(null); setEpoch(value => value + 1);
        } else if (message.type === "spectrum") setLine(message);
        else if (message.type === "acquisition") setChannels(message.channels);
        else if (message.type === "metrics") setMetrics(message);
        else if (message.type === "complete") { setChannels([]); setMetrics(previous => ({
          ...(previous ?? {}), samples: message.result.dspSamples ?? previous?.samples ?? 0,
          diagnostics: message.result.diagnostics,
        })); }
        else if (message.type === "frame") {
          if (!frameSource.current) throw new Error("Trame recue avant identification de sa source");
          const entry = { id: ++sequence.current, frame: message.frame, received: new Date().toISOString(),
            source: frameSource.current, centerHz: frameCenter.current };
          setEntries(values => [...values.slice(-199), entry]); setSelected(entry.id);
        }
      } catch (reason) { setError(`Evenement UI invalide : ${reason instanceof Error ? reason.message : String(reason)}`); }
    };
    ws.onerror = () => { if (active) setError("Connexion WebSocket locale interrompue."); };
    ws.onclose = event => {
      if (!active) return;
      setConnected(false);
      setChannels([]);
      setError(`Connexion fermee (${event.code}). ${event.reason || "Recharger pour reconnecter."}`);
    };
    void refresh().catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; ws.close(); socket.current = null; };
  }, []);

  const busy = status !== "idle";
  const sampleProfile = info?.sampleProfiles[sample];
  const playback = info && sampleProfile ? playbackConfiguration(info.settings, sampleProfile) : null;
  const playerSettings = useSampleProfile ? playback?.settings : settings;
  const displayedSettings = tab === "IQ REC PLAYER" ? playerSettings : settings;
  function send(command: unknown) {
    if (socket.current?.readyState !== WebSocket.OPEN) { setError("Serveur local deconnecte."); return; }
    socket.current.send(JSON.stringify(command));
  }
  function start(source: "rtl" | "sample") {
    setError("");
    if (source === "sample" && useSampleProfile && !playback) {
      setError("Aucun profil valide pour cette capture. Choisir le mode manuel pour utiliser RF CTRL.");
      return;
    }
    const location = device.split(":").map(Number);
    const parsed = startSchema.safeParse({ type: "start", source, centerHz: Math.round(Number(center) * 1e6),
      gainIndex: gain, agc, sample, removeDc, noisePrerollMs: preroll, settings,
      ...(source === "sample" && useSampleProfile ? playback : {}),
      ...(device ? { bus: location[0], address: location[1] } : {}) });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(" · ")); return; }
    send(parsed.data);
  }
  function stop() { send({ type: "stop" }); }
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(old => old ? { ...old, [key]: value } : old);
  }
  const activeFrame = entries.find(entry => entry.id === selected);
  const engGeneration = tab === "ENG FGB" ? 1 : 2;
  const eng = activeFrame?.frame.generation === engGeneration ? activeFrame
    : [...entries].reverse().find(entry => entry.frame.generation === engGeneration);
  const located = activeFrame && beaconPosition(activeFrame.frame) ? activeFrame
    : [...entries].reverse().find(entry => beaconPosition(entry.frame));
  const position = located ? beaconPosition(located.frame) : null;
  const elapsed = session && metrics ? Math.max(0, metrics.samples / session.sampleRateHz - (session.noisePrerollMs ?? 0) / 1000) : 0;
  const d = metrics?.diagnostics;

  return <main>
    <header className="titlebar"><div className="brand"><strong>COSPAS · SARSAT</strong><span>FGB / SGB · NATIVE DIAGNOSTIC</span></div>
      <div className="connection"><i className={connected ? "led green" : "led"} />{connected ? "LOCAL CONNECTED" : "OFFLINE"}
        <span className="divider" />C++20 DSP · RTL-SDR</div></header>
    <nav aria-label="Fenetres du recepteur">{tabs.map(name =>
      <button key={name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>{name}
        {name === "DECODES" && <span className="count">{entries.length}</span>}</button>)}</nav>
    {error && <div role="alert" className="error"><strong>ERREUR</strong> {error}<button onClick={() => setError("")} aria-label="Fermer erreur">×</button></div>}
    <section className="toolbar">
      <label>Centre · MHz<input aria-label="Centre MHz" type="number" min="406" max="406.1" step=".000001"
        value={center} onChange={event => setCenter(event.target.value)} disabled={busy} /></label>
      <fieldset disabled={busy || !displayedSettings || (tab === "IQ REC PLAYER" && useSampleProfile)}><legend>DECODERS</legend>
        <label><input type="checkbox" checked={displayedSettings?.fgb ?? false} onChange={event => change("fgb", event.target.checked)} />FGB</label>
        <label><input type="checkbox" checked={displayedSettings?.sgb ?? false} onChange={event => change("sgb", event.target.checked)} />SGB</label>
        <span className="divider" />
        <label><input type="checkbox" checked={displayedSettings?.normalPrn ?? false} onChange={event => change("normalPrn", event.target.checked)} />Normal PRN</label>
        <label><input type="checkbox" checked={displayedSettings?.testPrn ?? false} onChange={event => change("testPrn", event.target.checked)} />Self Test PRN</label>
      </fieldset>
      <div className="run-controls"><button className="primary" disabled={busy || !connected || !settings || !info?.devices.length}
        onClick={() => start("rtl")}>▶ RECEVOIR</button>
        <button className="stop" disabled={!busy || status === "stopping"} onClick={stop}>■ STOP</button></div>
    </section>
    <section className="readouts">
      <div><span>ETAT RECEPTEUR</span><b><i className={`led ${status === "running" ? "green" : status === "idle" ? "" : "amber"}`} />{status.toUpperCase()}</b></div>
      <div><span>SOURCE</span><b>{session ? session.source === "rtl" ? "RTL-SDR · USB" : "WAV I/Q" : "—"}</b></div>
      <div><span>TAUX I/Q</span><b>{session ? `${(session.sampleRateHz / 1000).toFixed(1)} kS/s` : "—"}</b></div>
      <div><span>ECHANTILLONS TRAITES</span><b>{metrics ? metrics.samples.toLocaleString("fr-FR") : "—"}</b></div>
      <div><span>TEMPS SOURCE</span><b>{elapsed.toFixed(1)} s</b></div>
      <div><span>TRAMES EN MEMOIRE</span><b>{entries.length} / 200</b></div>
    </section>

    <section hidden={tab !== "RECEIVER" && tab !== "IQ REC PLAYER"}>
      {tab === "IQ REC PLAYER" && <section className="panel player"><h2>IQ REC PLAYER <small>Lecture native des captures de regression</small></h2>
        <div className="row"><label>Capture WAV<select aria-label="Capture WAV" disabled={busy} value={sample} onChange={event => setSample(event.target.value)}>
          {info?.samples.map(name => <option key={name}>{name}</option>)}</select></label>
          <label><input type="checkbox" checked={useSampleProfile} disabled={busy} onChange={event => setUseSampleProfile(event.target.checked)} />Profil valide de la capture</label>
          <label><input type="checkbox" checked={useSampleProfile ? playback?.removeDc ?? false : removeDc} disabled={busy || useSampleProfile} onChange={event => setRemoveDc(event.target.checked)} />Retrait DC explicite</label>
          <label>Prechauffage · ms<input type="number" min="0" max="10000" step="100" disabled={busy || useSampleProfile}
            value={useSampleProfile ? playback?.noisePrerollMs ?? 0 : preroll} onChange={event => setPreroll(Number(event.target.value))} /></label>
          <button className="primary" disabled={busy || !connected || !settings} onClick={() => start("sample")}>▶ LIRE</button>
          <button disabled={!busy} onClick={stop}>■ STOP</button>
        </div><progress aria-label="Progression capture" max={session?.durationSeconds ?? 1} value={Math.min(elapsed, session?.durationSeconds ?? 1)} />
        {useSampleProfile ? playback ? <p role="status">Profil capture actif : {playback.settings.fgb ? "FGB" : ""}{playback.settings.fgb && playback.settings.sgb ? " + " : ""}{playback.settings.sgb ? "SGB" : ""}.
          {playback.settings.fgb && <> OverPeak {playback.settings.fgbOverPeakDb} dB ; moyenne {playback.settings.fgbAverage} ;
            RunTime {playback.settings.fgbRuntimeMs} ms ; Alpha {playback.settings.fgbAlpha} ; Beta {playback.settings.fgbBeta} ;
            Zeta {playback.settings.fgbZeta} ; BCH-1 maximum {playback.settings.fgbMaxErrors} erreurs ; BCH-2 maximum {playback.settings.fgbBch2MaxErrors} erreurs ;
            en-tete maximum {playback.settings.fgbHeaderErrors} erreurs.</>}
          {" "}Defauts natifs et adaptations validees du fichier ; reglages radio RF CTRL inchanges.</p>
          : info ? <p role="alert">Aucun profil valide pour cette capture. Selectionner le mode manuel.</p>
          : <p role="status">Chargement des profils de capture...</p>
          : <p role="status">Mode manuel : parametres DSP de RF CTRL, retrait DC et prechauffage ci-dessus.</p>}
        <p>Lecture temps reel ; arret puis relance depuis debut. Pas encore d'enregistrement ni de recherche temporelle.</p></section>}
      <Spectrum line={line} channels={channels} centerHz={session?.centerHz ?? Number(center) * 1e6}
        epoch={epoch} floor={base} range={range} average={average} />
      <section className="display-controls">
        <label>FFT Average <input aria-label="FFT Average" type="range" min=".01" max=".99" step=".01" value={average} onChange={event => setAverage(Number(event.target.value))} />{average.toFixed(2)}</label>
        <label>WF Base <input aria-label="WF Base" type="range" min="0" max="100" step="1" value={base} onChange={event => setBase(Number(event.target.value))} />{base}</label>
        <label>WF Range <input aria-label="WF Range" type="range" min="0" max="100" step="1" value={range} onChange={event => setRange(Number(event.target.value))} />{range}</label>
      </section>
      <section className="metrics"><article><h3>FGB ACQUISITION</h3><dl>
        <dt>Peak / mean</dt><dd>{d?.fgbMaxPeakDb.toFixed(2) ?? "—"} dB</dd>
        <dt>Candidats</dt><dd>{d?.fgbCandidates ?? "—"}</dd><dt>Sync votes</dt><dd>{d?.fgbMaxSyncVotes ?? "—"} / 16</dd>
      </dl></article><article><h3>SGB ACQUISITION</h3><dl>
        <dt>Detection max.</dt><dd>{d?.sgbMaxDetectionLevel.toFixed(2) ?? "—"}</dd>
        <dt>Candidats</dt><dd>{d?.sgbCandidates ?? "—"}</dd><dt>Rejets qualite / BCH</dt><dd>{d ? `${d.sgbQualityRejections} / ${d.sgbBchRejections}` : "—"}</dd>
      </dl></article><article><h3>RF FRONTEND</h3><dl>
        <dt>Preset actif</dt><dd>{metrics?.gainIndex ?? "—"}</dd><dt>I ecretes</dt><dd>{metrics?.clippedSamples ?? "—"}</dd>
        <dt>Puissance</dt><dd>Non calibree · dBFS</dd>
      </dl></article></section>
    </section>

    {tab === "DECODES" && <section className="panel"><div className="panel-tools"><h2>DECODES <small>Trames natives · brut et corrige</small></h2>
      <button onClick={() => { setEntries([]); setSelected(null); }}>EFFACER</button>
      <button disabled={!entries.length} onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "sarsat-decodes.json"; link.click(); URL.revokeObjectURL(url);
      }}>EXPORT JSON</button></div>
      {!entries.length ? <div className="empty"><strong>Aucune trame recue</strong><p>Demarrer reception RTL-SDR ou lecture d'une capture I/Q.</p><span>Aucune trame de demonstration n'est generee.</span></div>
        : <div className="table-scroll"><table><thead><tr><th>Temps source</th><th>Source</th><th>Gen.</th><th>Mode</th><th>Frequence · MHz</th><th>Δf · Hz</th><th>BCH</th><th>Trame corrigee</th></tr></thead>
          <tbody>{[...entries].reverse().map(entry => <tr key={entry.id} className={selected === entry.id ? "selected" : ""}>
            <td><button className="link" onClick={() => setSelected(entry.id)}>{entry.frame.timeSeconds.toFixed(3)} s</button></td>
            <td>{entry.source}</td>
            <td>{entry.frame.generation === 1 ? "FGB" : "SGB"}</td><td>{entry.frame.mode === "self_test" ? "SELF TEST" : "NORMAL"} {headerBadge(entry.frame)}</td>
            <td className="mono">{frameMhz(entry)}</td><td className="mono">{entry.frame.frequencyOffsetHz.toFixed(1)}</td><td>{bchBadges(entry.frame)}</td>
            <td className="mono hex">{entry.frame.correctedHex}</td></tr>)}</tbody></table></div>}
      {activeFrame && <div className="frame-detail"><h3>TRAME SELECTIONNEE</h3><p>Source : {activeFrame.source} · Reception navigateur : {activeFrame.received}</p>
        <p>Frequence : <b className="mono">{frameMhz(activeFrame)} MHz</b> · Δf = {activeFrame.frame.frequencyOffsetHz.toFixed(1)} Hz · t = {activeFrame.frame.timeSeconds.toFixed(3)} s</p>
        {activeFrame.frame.correctionLimit !== undefined && <p>Limite de correction {activeFrame.frame.generation === 1 ? "BCH-1 FGB" : "BCH SGB"} appliquee : {activeFrame.frame.correctionLimit}
          {activeFrame.frame.bch.length > 1 && activeFrame.frame.bch2Limit !== undefined && <> · BCH-2 FGB : {activeFrame.frame.bch2Limit}</>}</p>}
        <p>{bchBadges(activeFrame.frame)} {headerBadge(activeFrame.frame)}</p>
        <label>Brut<code>{activeFrame.frame.rawHex}</code></label><label>Corrige<code>{activeFrame.frame.correctedHex}</code></label>
        <button onClick={() => setTab(activeFrame.frame.generation === 1 ? "ENG FGB" : "ENG SGB")}>OUVRIR ENG</button>
        <FieldDetails frame={activeFrame.frame} /></div>}
    </section>}

    {tab === "MAP" && <section className="panel map-panel">
      <h2>MAP <small>Position balise · selection DECODES ou derniere trame localisee</small></h2>
      {!located || !position ? <div className="empty"><strong>Aucune position balise</strong><p>Aucune trame recue ne contient de position decodee.</p></div> : <>
        <p>{located.frame.generation === 1 ? "FGB" : "SGB"} · {located.frame.correctedHex} · t = {located.frame.timeSeconds.toFixed(3)} s ·
          <b className="mono"> {position.lat.toFixed(6)}, {position.lon.toFixed(6)}</b></p>
        <BeaconMap lat={position.lat} lon={position.lon} />
        <div className="map-links">
          <a className="button" target="_blank" rel="noopener noreferrer"
            href={`https://www.google.com/maps/search/?api=1&query=${position.lat},${position.lon}`}>GOOGLE MAPS</a>
          <a className="button" target="_blank" rel="noopener noreferrer"
            href={`https://waze.com/ul?ll=${position.lat},${position.lon}&navigate=yes`}>WAZE</a>
        </div></>}
    </section>}

    {(tab === "ENG FGB" || tab === "ENG SGB") && <section className="panel">
      <h2>{tab} <small>Derniere trame ou selection DECODES</small></h2>
      {!eng ? <div className="empty">Aucune trace {engGeneration === 1 ? "FGB" : "SGB"} disponible.</div> : <>
        <p className="mono">{eng.frame.correctedHex}</p><p>{frameMhz(eng)} MHz · t = {eng.frame.timeSeconds.toFixed(6)} s · Δf = {eng.frame.frequencyOffsetHz.toFixed(3)} Hz</p>
        <p>{bchBadges(eng.frame)} {headerBadge(eng.frame)}</p>
        <Trace title="Recovered phase / PLL error" trace={eng.frame.traces?.phase} />
        <Trace title="Recovered I" trace={eng.frame.traces?.i} /><Trace title="Recovered Q" trace={eng.frame.traces?.q} />
      </>}
    </section>}

    {tab === "RF CTRL" && <section className="panel"><h2>RF CTRL &amp; ENGINEERING SETTINGS <small>Appliques au prochain demarrage</small></h2>
      <fieldset disabled={busy || !settings} className="settings-grid"><legend>RTL-SDR · 921600 echantillons complexes/s · Bias-T OFF</legend>
        <label>Cle USB<select aria-label="Cle USB" value={device} onChange={event => setDevice(event.target.value)}>
          <option value="">{info?.devices.length ? "Choisir une cle" : "Aucune cle detectee"}</option>
          {info?.devices.map(value => <option key={`${value.bus}:${value.address}`} value={`${value.bus}:${value.address}`}>
            {value.vendorId.toString(16).padStart(4, "0")}:{value.productId.toString(16).padStart(4, "0")} · bus {value.bus}, adresse {value.address}
          </option>)}</select></label>
        <label>Preset initial explicite · 0–11<input type="number" min="0" max="11" step="1" value={gain} onChange={event => setGain(Number(event.target.value))} /></label>
        <label><input type="checkbox" checked={agc} onChange={event => setAgc(event.target.checked)} />FE_AGC</label>
        {numericSettings.map(field => <label key={field.key}>{field.label}<input type="number" min={field.min ?? 0} max={field.max} step={field.step}
          value={settings?.[field.key] ?? ""} onChange={event => change(field.key, Number(event.target.value))} /></label>)}
        <label>PRN alignment<select value={settings?.prnAlignment ?? 2} onChange={event => change("prnAlignment", Number(event.target.value))}>
          <option value="0">Early</option><option value="1">Norm</option><option value="2">Late</option></select></label>
        <label><input type="checkbox" checked={settings?.qualityCheck ?? true} onChange={event => change("qualityCheck", event.target.checked)} />SGB Quality Check</label>
        <label><input type="checkbox" checked={settings?.showBchFailures ?? false} onChange={event => change("showBchFailures", event.target.checked)} />Afficher BCH invalides / hors seuil</label>
      </fieldset><div className="row">
        <button disabled={busy} onClick={() => { void refresh().catch(reason => setError(String(reason))); }}>ACTUALISER USB</button>
        <button disabled={busy || !info} onClick={() => info && setSettings(info.settings)}>DEFAUTS MOTEUR NATIF</button></div>
      <p>Defauts DSP lus depuis API C, sans copie du decodeur TypeScript abandonne. Gain initial 8 : choix explicite de cette UI.
        Search Depth : {((settings?.searchDepth ?? 9) * 1.2 / 9).toFixed(1)} kHz de part et d'autre.
        Reglages utilises en reception RTL-SDR et en lecture WAV manuelle ; le profil capture du player reste independant.
        Reglages geles pendant session ; arreter avant modification. Pas de calibration dBm ni de sauvegarde INI.</p>
    </section>}
    <footer className="statusbar"><span><i className={connected ? "led green" : "led"} />127.0.0.1 · WebSocket local</span>
      <span>FFT reduite 1024 bins · 10 Hz · Waterfall GPU 7 s</span><span>DSP natif · aucun I/Q brut dans navigateur</span></footer>
  </main>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing UI root");
createRoot(root).render(<StrictMode><App /></StrictMode>);
