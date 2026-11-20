import { requireNativeModule, type EventSubscription } from "expo-modules-core";

type NativeEvents = {
  onLine(event: { stream: number; line: string }): void;
  onExit(event: { code: number }): void;
};
type SarsatNative = {
  samplesDirectory(): string;
  listSamples(): string[];
  readAsset(name: string): string;
  devices(): { vendorId: number; productId: number; bus: number; address: number }[];
  settings(): Promise<string>;
  prepareSample(name: string): Promise<string>;
  start(args: string[]): Promise<void>;
  stop(): void;
  writeFm(pcm: string, volume: number): void;
  setFmVolume(volume: number): void;
  resetFm(): void;
  addListener<K extends keyof NativeEvents>(name: K, listener: NativeEvents[K]): EventSubscription;
};

export default requireNativeModule<SarsatNative>("SarsatNative");
