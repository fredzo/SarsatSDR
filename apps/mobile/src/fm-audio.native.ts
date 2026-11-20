import SarsatNative from "../modules/sarsat-native";

export function createFmAudio(_onError: (message: string) => void) {
  return {
    activate() {},
    write(pcm: string, volume: number) { SarsatNative.writeFm(pcm, volume); },
    setVolume(volume: number) { SarsatNative.setFmVolume(volume); },
    reset() { SarsatNative.resetFm(); },
    close() { SarsatNative.resetFm(); },
  };
}
