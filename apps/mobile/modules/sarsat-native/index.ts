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

import { requireNativeModule, type EventSubscription } from "expo-modules-core";

type NativeEvents = {
  onLine(event: { stream: number; line: string }): void;
  onExit(event: { code: number }): void;
  onRecording(event: { file: string | null; saved?: string }): void;
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
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  writeFm(pcm: string, volume: number): void;
  setFmVolume(volume: number): void;
  resetFm(): void;
  addListener<K extends keyof NativeEvents>(name: K, listener: NativeEvents[K]): EventSubscription;
};

export default requireNativeModule<SarsatNative>("SarsatNative");
