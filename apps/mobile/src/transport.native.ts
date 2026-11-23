import * as DocumentPicker from "expo-document-picker";
import { AppState } from "react-native";
import { infoSchema, playbackProfilesSchema, retuneSchema, settingsSchema, startSchema } from "@sarsat/shared/protocol";
import { SessionCore, type EngineHandlers } from "@sarsat/shared/session-core";
import SarsatNative from "../modules/sarsat-native";
import type { Transport, TransportHandlers } from "./transport-types";

export function createTransport(handlers: TransportHandlers): Transport {
  const embedded = SarsatNative.listSamples();
  const picked = new Map<string, string>();
  const samples = () => [...embedded, ...picked.keys()];
  let current: EngineHandlers | null = null;
  const subscriptions = [
    SarsatNative.addListener("onLine", ({ stream, line }) => {
      if (stream === 1) current?.line(line); else current?.stderr(line + "\n");
    }),
    SarsatNative.addListener("onExit", ({ code }) => { const done = current; current = null; done?.close(code); }),
  ];
  const core = new SessionCore((args, engine) => {
    current = engine;
    SarsatNative.start(args).catch((error: Error) => { current = null; engine.error(error); engine.close(1); });
    return { stop: () => SarsatNative.stop(), kill: () => SarsatNative.stop() };
  }, samples, sample => picked.get(sample) ?? `${SarsatNative.samplesDirectory()}/${sample}`, handlers.event);
  setTimeout(() => handlers.connection(true), 0);
  return {
    label: "Embedded native engine · Android",
    async info() {
      const settings = settingsSchema.parse(JSON.parse(await SarsatNative.settings()));
      return infoSchema.parse({ settings, devices: SarsatNative.devices(), samples: samples(), status: core.status,
        sampleProfiles: playbackProfilesSchema.parse(JSON.parse(SarsatNative.readAsset("playback-profiles.json"))) });
    },
    watchDevices(listener) {
      let previous: string | undefined;
      let lastError: string | undefined;
      const scan = () => {
        try {
          const devices = SarsatNative.devices();
          const key = devices.map(d => `${d.bus}:${d.address}:${d.vendorId}:${d.productId}`).sort().join(",");
          lastError = undefined;
          if (key === previous) return;
          previous = key;
          listener(devices);
        } catch (reason) {
          const message = `Could not enumerate USB devices: ${String(reason)}`;
          if (message !== lastError) handlers.event({ type: "error", message });
          lastError = message;
        }
      };
      scan();
      const timer = setInterval(() => { if (AppState.currentState === "active") scan(); }, 1000);
      const appState = AppState.addEventListener("change", state => { if (state === "active") scan(); });
      return () => { clearInterval(timer); appState.remove(); };
    },
    send(command) {
      try {
        if (command.type === "stop") return core.stop();
        if (command.type === "retune") return core.retune(retuneSchema.parse(command).centerHz);
        const start = startSchema.parse(command);
        if (start.source === "sample" && start.sample && !picked.has(start.sample)) {
          handlers.event({ type: "status", status: "starting" });
          SarsatNative.prepareSample(start.sample).then(() => core.start(start)).catch((error: Error) => {
            handlers.event({ type: "error", message: error.message });
            handlers.event({ type: "status", status: "idle" });
          });
        } else core.start(start);
      } catch (error) { handlers.event({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
    },
    close() { subscriptions.forEach(subscription => subscription.remove()); core.stop(); },
    async pickFile() {
      const result = await DocumentPicker.getDocumentAsync({ type: ["audio/wav", "audio/x-wav", "audio/*"], copyToCacheDirectory: true });
      if (result.canceled || !result.assets[0]) return null;
      const asset = result.assets[0];
      const name = `file/${asset.name}`.slice(0, 128);
      picked.set(name, decodeURIComponent(asset.uri.replace(/^file:\/\//, "")));
      return name;
    },
  };
}
