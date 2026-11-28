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

import type { Info, ServerEvent } from "@sarsat/shared/protocol";

export type Command = { type: "stop" } | { type: "retune"; centerHz: number } | ({ type: "start" } & Record<string, unknown>);
export type Transport = {
  info(): Promise<Info>;
  send(command: Command): void;
  close(): void;
  watchDevices?(listener: (devices: Info["devices"]) => void): () => void;
  // Native only: copy a WAV picked on the tablet and return its playlist name.
  pickFile?(): Promise<string | null>;
  startRecording?(): Promise<void>;
  stopRecording?(): Promise<void>;
  label: string;
};
export type TransportHandlers = {
  event(event: ServerEvent): void;
  connection(connected: boolean, reason?: string): void;
};
