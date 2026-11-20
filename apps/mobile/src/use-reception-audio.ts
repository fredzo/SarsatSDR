import { useCallback, useEffect, useMemo, useRef } from "react";
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from "expo-audio";
import { Platform } from "react-native";
import type { NotificationSound } from "./reception-preferences";

const warmUpOnAndroid = Platform.OS === "android";
const playerOptions = { downloadFirst: warmUpOnAndroid };

export function useReceptionAudio(onError: (message: string) => void) {
  const ok = useAudioPlayer(require("../assets/audios/ok.mp3"), playerOptions);
  const ko = useAudioPlayer(require("../assets/audios/ko.mp3"), playerOptions);
  const filtered = useAudioPlayer(require("../assets/audios/filtered.mp3"), playerOptions);
  const countl = useAudioPlayer(require("../assets/audios/countl.mp3"), playerOptions);
  const counth = useAudioPlayer(require("../assets/audios/counth.mp3"), playerOptions);
  const players = useMemo(() => ({ ok, ko, filtered, countl, counth }), [ok, ko, filtered, countl, counth]);
  const active = useRef(true);
  const warmed = useRef(new WeakSet<AudioPlayer>());
  const pending = useRef(new Map<AudioPlayer, number>());
  const play = useCallback((player: AudioPlayer, name: string, volume: number) => {
    const report = (reason: unknown) => { if (active.current) onError(`Could not play ${name}: ${String(reason)}`); };
    try {
      player.volume = volume;
      if (player.currentTime === 0) player.play();
      else void player.seekTo(0).then(() => { if (active.current) player.play(); }).catch(report);
    } catch (reason) { report(reason); }
  }, [onError]);
  useEffect(() => {
    active.current = true;
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "mixWithOthers" })
      .catch(reason => { if (active.current) onError(`Could not configure audio: ${String(reason)}`); });
    const queued = pending.current;
    const subscriptions = Object.entries(players).map(([name, player]) => {
      let warmUpTimer: ReturnType<typeof setTimeout> | undefined;
      const finishWarmUp = () => {
        clearTimeout(warmUpTimer);
        warmUpTimer = undefined;
        warmed.current.add(player);
        const volume = queued.get(player);
        if (volume !== undefined) {
          queued.delete(player);
          play(player, name, volume);
        }
      };
      const warmUp = () => {
        if (!warmUpOnAndroid || warmed.current.has(player) || warmUpTimer !== undefined) return;
        // As in SarsatJRXApp, prepare alone is not enough: start real playback at nonzero, inaudible gain.
        warmUpTimer = setTimeout(() => {
          console.warn(`Audio warm-up timed out for ${name}`);
          finishWarmUp();
        }, 2000);
        play(player, name, 1e-10);
      };
      const subscription = player.addListener("playbackStatusUpdate", status => {
        if (status.error) {
          clearTimeout(warmUpTimer);
          warmUpTimer = undefined;
          warmed.current.add(player);
          queued.delete(player);
          onError(`Could not play ${name}: ${status.error}`);
        } else if (warmUpTimer !== undefined && status.didJustFinish) finishWarmUp();
        else if (status.isLoaded) warmUp();
      });
      if (warmUpOnAndroid && player.isLoaded) warmUp();
      return () => { clearTimeout(warmUpTimer); subscription.remove(); };
    });
    return () => { active.current = false; queued.clear(); subscriptions.forEach(remove => remove()); };
  }, [players, onError, play]);
  return useCallback((sound: NotificationSound, volume: number) => {
    if (volume === 0) return;
    const player = players[sound];
    if (warmUpOnAndroid && !warmed.current.has(player)) pending.current.set(player, volume);
    else play(player, sound, volume);
  }, [players, play]);
}
