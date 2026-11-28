/*
 * SarsatSDR
 * Copyright (C) 2026 Frederic BORRY - F4JRX
 * Authors: Frederic BORRY - F4JRX and Copilot (AI-assisted development).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

export function createFmAudio(onError: (message: string) => void) {
  let context: AudioContext | undefined;
  let gain: GainNode | undefined;
  let end = 0;
  const active = new Set<AudioBufferSourceNode>();
  const reset = () => {
    for (const source of active) source.stop();
    active.clear();
    end = 0;
  };
  return {
    activate() {
      try {
        if (!context) {
          context = new AudioContext();
          gain = context.createGain();
          gain.connect(context.destination);
        }
        void context.resume().catch(reason => onError(`Could not enable FM audio: ${String(reason)}`));
      } catch (reason) { onError(`Could not enable FM audio: ${String(reason)}`); }
    },
    write(pcm: string, volume: number) {
      if (!context || !gain || context.state !== "running") return;
      const current = context.currentTime;
      if (end > current + .25) reset();
      const bytes = atob(pcm);
      const buffer = context.createBuffer(1, bytes.length / 2, 12000);
      const samples = buffer.getChannelData(0);
      for (let n = 0; n < samples.length; ++n) {
        const low = bytes.charCodeAt(2 * n), high = bytes.charCodeAt(2 * n + 1);
        samples[n] = (low + (high >= 128 ? high - 256 : high) * 256) / 32768;
      }
      gain.gain.value = volume;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      active.add(source);
      source.onended = () => { source.disconnect(); active.delete(source); };
      source.start(end > current ? end : current + .065);
      end = (end > current ? end : current + .065) + buffer.duration;
    },
    setVolume(volume: number) { if (gain) gain.gain.value = volume; },
    reset,
    close() {
      reset();
      void context?.close().catch(reason => onError(`Could not close FM audio: ${String(reason)}`));
      context = gain = undefined;
    },
  };
}
