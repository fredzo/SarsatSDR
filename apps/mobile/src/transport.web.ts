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
