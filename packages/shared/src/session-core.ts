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

import { nativeEventSchema, retuneSchema, type ServerEvent, type StartCommand } from "./protocol";

export function argumentsFor(command: StartCommand, samples: string[], samplePath: (sample: string) => string): string[] {
  const s = command.settings;
  if (command.source === "sample" && (!command.sample || !samples.includes(command.sample)))
    throw new Error("Unknown capture; select a file from the sample list");
  const args = command.source === "rtl"
    ? ["receive", "--frequency-hz", String(command.centerHz), "--gain-index", String(command.gainIndex), "--continuous"]
    : ["decode", "--input", samplePath(command.sample!), "--realtime"];
  args.push("--events", "--control-stdin");
  if (s.fgb && command.fgbFm) args.push("--fgb-fm");
  if (!s.fgb) args.push("--sgb-only");
  if (!s.sgb) args.push("--fgb-only");
  if (!s.fgbNormal) args.push("--fgb-self-test-only");
  if (!s.fgbSelfTest) args.push("--fgb-normal-only");
  if (!s.normalPrn) args.push("--test-prn-only");
  if (!s.testPrn) args.push("--normal-prn-only");
  if (!s.qualityCheck) args.push("--no-quality-check");
  if (s.showBchFailures) args.push("--show-bch-failures");
  else if (s.fgb) args.push("--show-fgb-bch-failures");
  for (const band of s.fgbExcludedBands)
    args.push("--fgb-exclude-band", String(band.offsetHz), String(band.deviationHz));
  args.push("--fgb-alpha", String(s.fgbAlpha), "--fgb-beta", String(s.fgbBeta),
    "--fgb-zeta", String(s.fgbZeta), "--fgb-average", String(s.fgbAverage),
    "--fgb-runtime-ms", String(s.fgbRuntimeMs),
    "--fgb-max-candidates", String(s.fgbMaxCandidates),
    "--fgb-max-errors", String(s.fgbMaxErrors), "--fgb-header-errors", String(s.fgbHeaderErrors),
    "--fgb-bch2-max-errors", String(s.fgbBch2MaxErrors),
    "--fgb-over-peak", String(s.fgbOverPeakDb), "--sgb-threshold", String(s.sgbThreshold),
    "--sgb-phase-gain", String(s.sgbPhaseGain), "--sgb-frequency-gain", String(s.sgbFrequencyGain),
    "--sgb-filter", String(s.sgbFilter), "--sgb-max-errors", String(s.sgbMaxErrors),
    "--sgb-feedback", String(s.sgbFeedback),
    "--search-depth", String(s.searchDepth), "--prn-alignment", String(s.prnAlignment));
  if (command.source === "rtl") {
    if (command.agc) args.push("--agc");
    if (command.bus !== undefined) args.push("--bus", String(command.bus), "--address", String(command.address));
  } else {
    if (command.removeDc) args.push("--remove-dc");
    args.push("--noise-preroll-ms", String(command.noisePrerollMs));
  }
  return args;
}

export type EngineHandlers = {
  line(line: string): void;
  stderr(chunk: string): void;
  error(error: Error): void;
  close(code: number | null): void;
};
// stop() requests a graceful stop (stop<LF>); kill() aborts the engine.
export type EngineProcess = { stop(): void; kill(): void };
export type EngineLauncher = (args: string[], handlers: EngineHandlers) => EngineProcess;

export class SessionCore {
  status: Extract<ServerEvent, { type: "status" }>["status"] = "idle";
  lastSession: Extract<ServerEvent, { type: "session" }> | null = null;
  private engine: EngineProcess | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private command: StartCommand | null = null;
  private pendingRetune: StartCommand | null = null;
  private startedAt = "";
  constructor(private readonly launch: EngineLauncher, private readonly sampleList: () => string[],
    private readonly samplePath: (sample: string) => string, private readonly emit: (event: ServerEvent) => void) {}

  start(command: StartCommand, startedAt = new Date().toISOString()) {
    if (this.engine || this.retry) throw new Error("Session already active; stop before changing the source or settings");
    const args = argumentsFor(command, this.sampleList(), this.samplePath);
    this.startedAt = startedAt;
    this.command = command;
    this.status = "starting";
    this.lastSession = null;
    this.emit({ type: "status", status: this.status });
    let stderr = "", terminal = false, closed = false;
    const fail = (message: string) => this.emit({ type: "error", message });
    this.engine = this.launch(args, {
      stderr: chunk => { stderr = (stderr + chunk).slice(-32768); },
      line: line => {
        if (closed) return;
        try {
          if (line.length > 262144) throw new Error("Native event is too large");
          const event = nativeEventSchema.parse(JSON.parse(line));
          if (event.type === "frame") {
            event.frame.correctionLimit = event.frame.generation === 1 ? command.settings.fgbMaxErrors : command.settings.sgbMaxErrors;
            if (event.frame.generation === 1) event.frame.bch2Limit = command.settings.fgbBch2MaxErrors;
          }
          if (event.type === "session") {
            event.label = command.source === "sample" ? command.sample : "RTL-SDR";
            event.startedAt = startedAt;
            this.lastSession = event;
          }
          if (event.type === "session" && this.status !== "stopping") {
            this.status = "running";
            this.emit({ type: "status", status: this.status });
          }
          if (event.type === "complete") terminal = true;
          this.emit(event);
        } catch (error) {
          fail(`Invalid native protocol: ${error instanceof Error ? error.message : String(error)}`);
          this.stop();
        }
      },
      error: error => fail(`Engine startup: ${error.message}`),
      close: code => {
        closed = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.engine = null;
        const message = stderr.trim();
        const retune = this.pendingRetune;
        this.pendingRetune = null;
        if (retune && terminal && (code === 0 || code === 2)) {
          this.start(retune, startedAt);
          return;
        }
        if (this.status !== "stopping" && command.source === "rtl" &&
            (message.includes("RTL-SDR I/Q acquisition queue full; sample continuity lost") ||
             message.includes("Worker input queue is full; block was not accepted"))) {
          this.lastSession = null;
          this.status = "retrying";
          this.retry = setTimeout(() => {
            this.retry = null;
            this.start(command, startedAt);
          }, 1000);
          fail(`${message}\nRetrying RTL-SDR acquisition…`);
          this.emit({ type: "status", status: this.status });
          return;
        }
        if ((code !== 0 && code !== 2) || !terminal)
          fail(message || `Engine exited without a final result (code ${code})`);
        this.status = "idle";
        this.emit({ type: "status", status: this.status });
      },
    });
  }
  stop() {
    this.pendingRetune = null;
    this.requestStop();
  }
  retune(centerHz: number) {
    retuneSchema.parse({ type: "retune", centerHz });
    if (!this.command || this.command.source !== "rtl" || this.status === "idle")
      throw new Error("Retuning requires an active RTL-SDR session");
    const command = { ...this.command, centerHz };
    if (this.retry) { const startedAt = this.startedAt; this.stop(); this.start(command, startedAt); return; }
    this.pendingRetune = command;
    this.requestStop();
  }
  private requestStop() {
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
      this.status = "idle";
      this.emit({ type: "status", status: this.status });
      return;
    }
    if (!this.engine || this.status === "stopping") return;
    this.status = "stopping";
    this.emit({ type: "status", status: this.status });
    const engine = this.engine;
    engine.stop();
    this.timer = setTimeout(() => {
      this.emit({ type: "error", message: "Native stop timed out after 5 s; terminating the process" });
      engine.kill();
    }, 5000);
  }
}
