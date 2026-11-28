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

import { infoSchema, serverEventSchema } from "@sarsat/shared/protocol";
import type { Transport, TransportHandlers } from "./transport-types";

export function createTransport(handlers: TransportHandlers): Transport {
  let active = true;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/events`);
  ws.onopen = () => { if (active) handlers.connection(true); };
  ws.onmessage = event => {
    if (!active) return;
    try { handlers.event(serverEventSchema.parse(JSON.parse(String(event.data)))); }
    catch (reason) { handlers.event({ type: "error", message: `Invalid UI event: ${reason instanceof Error ? reason.message : String(reason)}` }); }
  };
  ws.onerror = () => { if (active) handlers.event({ type: "error", message: "Local WebSocket connection interrupted." }); };
  ws.onclose = event => {
    if (active) handlers.connection(false, `Connection closed (${event.code}). ${event.reason || "Reload to reconnect."}`);
  };
  return {
    label: "127.0.0.1 · WebSocket local",
    async info() {
      const response = await fetch("/api/info");
      const data: unknown = await response.json();
      if (!response.ok) throw new Error("Could not read native engine information. Check the build and DLLs.");
      return infoSchema.parse(data);
    },
    send(command) {
      if (ws.readyState !== WebSocket.OPEN) { handlers.event({ type: "error", message: "Local server disconnected." }); return; }
      ws.send(JSON.stringify(command));
    },
    close() { active = false; ws.close(); },
  };
}
