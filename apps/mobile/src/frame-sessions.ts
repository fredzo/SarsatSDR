import { z } from "zod";
import { frameSchema, type Frame } from "@sarsat/shared/protocol";

export const sessionDateSchema = z.iso.date();
const entrySchema = z.object({
  id: z.number().int().positive(),
  frame: frameSchema,
  received: z.iso.datetime(),
  source: z.string().min(1),
  centerHz: z.number().finite().positive(),
});
const sessionSchema = z.object({
  version: z.literal(1),
  date: sessionDateSchema,
  entries: z.array(entrySchema).max(200)
    .refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length, "Duplicate frame IDs"),
});
export type Entry = z.infer<typeof entrySchema>;
export type FrameSession = z.infer<typeof sessionSchema>;
export type SessionSummary = { date: string; count: number };
export type SessionStorage = {
  dates(): Promise<string[]>;
  read(date: string): Promise<string | null>;
  write(date: string, value: string): Promise<void>;
  remove(date: string): Promise<void>;
};

export function localSessionDate(now: Date) {
  return sessionDateSchema.parse(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
}

export function formatSessionDate(date: string, separator: "/" | "-" = "/") {
  return sessionDateSchema.parse(date).split("-").reverse().join(separator);
}

export function sessionExport(session: FrameSession) {
  return { name: `sarsat-decodes-${formatSessionDate(session.date, "-")}.json`, json: JSON.stringify(session.entries, null, 2) };
}

export class FrameSessions {
  current: FrameSession;
  acquisitionDate: string | null = null;
  private sequence = 0;
  private loaded = false;
  private queuedSave: { session: FrameSession } | null = null;
  private pending = Promise.resolve();

  constructor(private readonly storage: SessionStorage,
    private readonly changed: (session: FrameSession) => void,
    private readonly failed: (message: string) => void, now = new Date()) {
    this.current = { version: 1, date: localSessionDate(now), entries: [] };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.pending.then(operation);
    this.pending = task.then(() => {}, () => {});
    return task;
  }

  private async read(date: string) {
    sessionDateSchema.parse(date);
    const value = await this.storage.read(date);
    if (value === null) return null;
    const session = sessionSchema.parse(JSON.parse(value));
    if (session.date !== date) throw new Error(`Session date does not match ${formatSessionDate(date)}`);
    return session;
  }

  private display(session: FrameSession) {
    this.sequence = Math.max(this.sequence, ...session.entries.map(entry => entry.id));
    this.current = session;
    this.loaded = true;
    this.changed(session);
  }

  initialize(now = new Date()) {
    return this.enqueue(async () => {
      const date = localSessionDate(now);
      this.display(await this.read(date) ?? { version: 1, date, entries: [] });
    });
  }

  begin(now = new Date()) {
    return this.enqueue(async () => {
      if (this.acquisitionDate) throw new Error("An acquisition is already active");
      const date = localSessionDate(now);
      const session: FrameSession = this.loaded && date === this.current.date ? this.current
        : await this.read(date) ?? { version: 1, date, entries: [] };
      await this.storage.write(date, JSON.stringify(session));
      this.acquisitionDate = date;
      this.display(session);
    });
  }

  end() { this.acquisitionDate = null; }

  append(frame: Frame, source: string, centerHz: number, now = new Date()) {
    if (!this.acquisitionDate || this.current.date !== this.acquisitionDate)
      throw new Error("Frame received outside the active daily session");
    const entry: Entry = { id: this.sequence = Math.max(this.sequence + 1, now.getTime()),
      frame, source, centerHz, received: now.toISOString() };
    const session = { ...this.current, entries: [...this.current.entries.slice(-199), entry] };
    this.display(session);
    if (this.queuedSave) this.queuedSave.session = session;
    else {
      const save = this.queuedSave = { session };
      void this.enqueue(async () => {
        if (this.queuedSave === save) this.queuedSave = null;
        await this.storage.write(save.session.date, JSON.stringify(save.session));
      }).catch(reason => this.failed(`Could not save session ${formatSessionDate(session.date)}: ${String(reason)}`));
    }
    return entry;
  }

  load(date: string) {
    return this.enqueue(async () => {
      if (this.acquisitionDate) throw new Error("Stop acquisition before loading a session");
      const session = await this.read(date);
      if (!session) throw new Error(`Session ${formatSessionDate(date)} no longer exists`);
      this.display(session);
    });
  }

  list() {
    return this.enqueue(async () => {
      const summaries: SessionSummary[] = [];
      for (const date of (await this.storage.dates()).sort().reverse()) {
        const session = await this.read(date);
        if (!session) throw new Error(`Session ${formatSessionDate(date)} no longer exists`);
        summaries.push({ date, count: session.entries.length });
      }
      return summaries;
    });
  }

  export(date: string) {
    return this.enqueue(async () => {
      const session = await this.read(date);
      if (!session) throw new Error(`Session ${formatSessionDate(date)} no longer exists`);
      return sessionExport(session);
    });
  }

  remove(date: string) {
    return this.enqueue(async () => {
      if (this.acquisitionDate) throw new Error("Stop acquisition before deleting a session");
      sessionDateSchema.parse(date);
      await this.storage.remove(date);
      if (date === this.current.date) this.display({ version: 1, date, entries: [] });
    });
  }

  clear(now = new Date()) {
    if (this.current.date !== localSessionDate(now)) return Promise.reject(new Error("Only today's frames can be cleared"));
    const session = { ...this.current, entries: [] };
    this.queuedSave = null;
    this.display(session);
    return this.enqueue(() => this.storage.write(session.date, JSON.stringify(session)));
  }

  flush() { return this.pending; }
}
