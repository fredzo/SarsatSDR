import { nativeEventSchema, type ServerEvent, type StartCommand } from "./protocol";

export function argumentsFor(command: StartCommand, samples: string[], samplePath: (sample: string) => string): string[] {
  const s = command.settings;
  if (command.source === "sample" && (!command.sample || !samples.includes(command.sample)))
    throw new Error("Capture inconnue ; choisir un fichier du repertoire samples");
  const args = command.source === "rtl"
    ? ["receive", "--frequency-hz", String(command.centerHz), "--gain-index", String(command.gainIndex), "--continuous"]
    : ["decode", "--input", samplePath(command.sample!), "--realtime"];
  args.push("--events", "--control-stdin");
  if (!s.fgb) args.push("--sgb-only");
  if (!s.sgb) args.push("--fgb-only");
  if (!s.normalPrn) args.push("--test-prn-only");
  if (!s.testPrn) args.push("--normal-prn-only");
  if (!s.qualityCheck) args.push("--no-quality-check");
  if (s.showBchFailures) args.push("--show-bch-failures");
  args.push("--fgb-alpha", String(s.fgbAlpha), "--fgb-beta", String(s.fgbBeta),
    "--fgb-zeta", String(s.fgbZeta), "--fgb-average", String(s.fgbAverage),
    "--fgb-runtime-ms", String(s.fgbRuntimeMs),
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
  status: "idle" | "starting" | "running" | "stopping" = "idle";
  lastSession: Extract<ServerEvent, { type: "session" }> | null = null;
  private engine: EngineProcess | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly launch: EngineLauncher, private readonly sampleList: () => string[],
    private readonly samplePath: (sample: string) => string, private readonly emit: (event: ServerEvent) => void) {}

  start(command: StartCommand) {
    if (this.engine) throw new Error("Session deja active ; arreter avant de changer de source ou de reglage");
    const args = argumentsFor(command, this.sampleList(), this.samplePath);
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
          if (line.length > 262144) throw new Error("Evenement natif trop volumineux");
          const event = nativeEventSchema.parse(JSON.parse(line));
          if (event.type === "frame") {
            event.frame.correctionLimit = event.frame.generation === 1 ? command.settings.fgbMaxErrors : command.settings.sgbMaxErrors;
            if (event.frame.generation === 1) event.frame.bch2Limit = command.settings.fgbBch2MaxErrors;
          }
          if (event.type === "session") {
            event.label = command.source === "sample" ? command.sample : "RTL-SDR";
            this.lastSession = event;
          }
          if (event.type === "session" && this.status !== "stopping") {
            this.status = "running";
            this.emit({ type: "status", status: this.status });
          }
          if (event.type === "complete") terminal = true;
          this.emit(event);
        } catch (error) {
          fail(`Protocole natif invalide : ${error instanceof Error ? error.message : String(error)}`);
          this.stop();
        }
      },
      error: error => fail(`Demarrage du moteur : ${error.message}`),
      close: code => {
        closed = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.engine = null;
        if ((code !== 0 && code !== 2) || !terminal)
          fail(stderr.trim() || `Moteur termine sans resultat final (code ${code})`);
        this.status = "idle";
        this.emit({ type: "status", status: this.status });
      },
    });
  }
  stop() {
    if (!this.engine || this.status === "stopping") return;
    this.status = "stopping";
    this.emit({ type: "status", status: this.status });
    const engine = this.engine;
    engine.stop();
    this.timer = setTimeout(() => {
      this.emit({ type: "error", message: "Arret natif sans reponse apres 5 s ; processus termine de force" });
      engine.kill();
    }, 5000);
  }
}
