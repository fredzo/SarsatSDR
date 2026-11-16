import { infoSchema, serverEventSchema } from "@sarsat/shared/protocol";
import type { Transport, TransportHandlers } from "./transport-types";

export function createTransport(handlers: TransportHandlers): Transport {
  let active = true;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/events`);
  ws.onopen = () => { if (active) handlers.connection(true); };
  ws.onmessage = event => {
    if (!active) return;
    try { handlers.event(serverEventSchema.parse(JSON.parse(String(event.data)))); }
    catch (reason) { handlers.event({ type: "error", message: `Evenement UI invalide : ${reason instanceof Error ? reason.message : String(reason)}` }); }
  };
  ws.onerror = () => { if (active) handlers.event({ type: "error", message: "Connexion WebSocket locale interrompue." }); };
  ws.onclose = event => {
    if (active) handlers.connection(false, `Connexion fermee (${event.code}). ${event.reason || "Recharger pour reconnecter."}`);
  };
  return {
    label: "127.0.0.1 · WebSocket local",
    async info() {
      const response = await fetch("/api/info");
      const data: unknown = await response.json();
      if (!response.ok) throw new Error("Impossible de lire le moteur natif. Verifier build et DLL.");
      return infoSchema.parse(data);
    },
    send(command) {
      if (ws.readyState !== WebSocket.OPEN) { handlers.event({ type: "error", message: "Serveur local deconnecte." }); return; }
      ws.send(JSON.stringify(command));
    },
    close() { active = false; ws.close(); },
  };
}
