import * as DocumentPicker from "expo-document-picker";
import { infoSchema, playbackProfilesSchema, settingsSchema, startSchema } from "@sarsat/shared/protocol";
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
    send(command) {
      try {
        if (command.type === "stop") return core.stop();
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
