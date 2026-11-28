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

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { Session } from "./session.js";
import { commandSchema, type ServerEvent } from "@sarsat/shared/protocol";

const app = dirname(fileURLToPath(import.meta.url));
const root = resolve(app, "..", "..");
const port = Number(process.env.SARSAT_UI_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid SARSAT_UI_PORT");
const origin = `http://127.0.0.1:${port}`;
const clients = new Set<WebSocket>();
function send(socket: WebSocket, event: ServerEvent) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 1024 * 1024) {
    socket.close(1013, "Client too slow; events cannot be silently discarded");
    return;
  }
  socket.send(JSON.stringify(event));
}
const samples = (await readdir(resolve(root, "samples"))).filter(name => name.endsWith(".wav")).sort();
const session = new Session(resolve(root, "build", process.platform === "win32" ? "cospas-cli.exe" : "cospas-cli"),
  root, samples, event => { for (const client of clients) send(client, event); });
const dist = resolve(root, "apps", "mobile", "dist");
const server = createServer(async (request, response) => {
  try {
    if (request.headers.host !== `127.0.0.1:${port}`) {
      response.writeHead(403).end("Loopback host required"); return;
    }
    if (request.method !== "GET") { response.writeHead(405).end("GET required"); return; }
    if (request.url === "/api/info") {
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify(await session.info()));
    } else {
      const path = resolve(dist, "." + decodeURIComponent((request.url ?? "/").split("?")[0]));
      const base = dist;
      if (path !== base && !path.startsWith(base + sep)) { response.writeHead(403).end("Forbidden"); return; }
      const file = path === base ? resolve(base, "index.html") : path;
      response.setHeader("Content-Type", ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript",
        ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon",
        ".mp3": "audio/mpeg" } as Record<string, string>)[extname(file)] ?? "application/octet-stream");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.end(await readFile(file));
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      response.writeHead(404).end("Not found");
      return;
    }
    console.error(error);
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
server.on("upgrade", (request, socket, head) => {
  if (request.url !== "/events") return;
  if (request.headers.origin !== origin || request.headers.host !== `127.0.0.1:${port}`) {
    socket.destroy(); return;
  }
  sockets.handleUpgrade(request, socket, head, client => sockets.emit("connection", client));
});
sockets.on("connection", (client: WebSocket) => {
  clients.add(client);
  send(client, { type: "status", status: session.status });
  if (session.status !== "idle" && session.lastSession) send(client, session.lastSession);
  client.on("message", data => {
    try {
      const command = commandSchema.parse(JSON.parse(data.toString()));
      if (command.type === "stop") session.stop();
      else if (command.type === "retune") session.retune(command.centerHz);
      else session.start(command);
    } catch (error) {
      send(client, { type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });
  client.on("error", error => console.error("WebSocket:", error.message));
  client.on("close", () => { clients.delete(client); if (!clients.size) session.stop(); });
});
server.listen(port, "127.0.0.1", () => console.log(`SarsatSDR: ${origin}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    session.stop();
    for (const client of clients) client.close(1001, "Server stopped");
    server.close();
    sockets.close();
  });
}
