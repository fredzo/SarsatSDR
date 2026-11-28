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

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Frame } from "@sarsat/shared/protocol";
import { FrameSessions, formatSessionDate, localSessionDate, type SessionStorage } from "../../mobile/src/frame-sessions";
import { playbackProgress } from "../../mobile/src/playback-progress";

const beforeMidnight = new Date(2026, 10, 25, 23, 59, 59);
const afterMidnight = new Date(2026, 10, 26, 0, 0, 1);
const trace = () => ({ count: 4400, stride: 1, values: Array.from({ length: 4400 }, (_, n) => Math.sin(n)) });
const frame: Frame = {
  generation: 1, beaconType: "EPIRB", mode: "normal", timeSeconds: 1.5, frequencyOffsetHz: -250,
  rawHex: "A".repeat(36), correctedHex: "B".repeat(36), correctionLimit: 3, bch2Limit: 2,
  bch: [{ valid: true, correctedErrors: 1 }, { valid: false, correctedErrors: null }],
  fields: [{ section: "Identification", name: "Country", value: "France" }],
  traces: { phase: trace(), i: trace(), q: trace() },
};
function fixture() {
  const data = new Map<string, string>();
  const errors: string[] = [];
  const storage: SessionStorage = {
    async dates() { return [...data.keys()]; },
    async read(date) { return data.get(date) ?? null; },
    async write(date, value) { data.set(date, value); },
    async remove(date) { data.delete(date); },
  };
  const create = (now = beforeMidnight) => new FrameSessions(storage, () => {}, message => errors.push(message), now);
  return { data, errors, storage, create };
}
const append = (sessions: FrameSessions, now = beforeMidnight, value = frame) => sessions.append(value, "RTL-SDR", 406050000, now);

test("Daily sessions pin acquisition day across midnight and restore today's frames before a new start", async () => {
  const { create, data } = fixture();
  const sessions = create();
  await sessions.initialize(beforeMidnight);
  await sessions.begin(beforeMidnight);
  const first = append(sessions);
  const midnight = append(sessions, afterMidnight);
  assert.equal(sessions.current.date, "2026-11-25");
  assert.equal(midnight.received, afterMidnight.toISOString());
  sessions.end();
  await sessions.begin(afterMidnight);
  assert.equal(sessions.current.entries.length, 0);
  const today = append(sessions, afterMidnight);
  assert.ok(today.id > midnight.id);
  sessions.end();
  await sessions.load("2026-11-25");
  assert.deepEqual(sessions.current.entries.map(entry => entry.id), [first.id, midnight.id]);
  await sessions.begin(afterMidnight);
  assert.deepEqual(sessions.current.entries, [today]);
  assert.deepEqual([...data.keys()], ["2026-11-25", "2026-11-26"]);
  const restored = create(afterMidnight);
  await restored.initialize(afterMidnight);
  assert.deepEqual(restored.current.entries, [today]);
});

test("A day's last 200 complete frames survive reload and another acquisition, including WAV frames", async () => {
  const { create, storage } = fixture();
  const write = storage.write;
  let writes = 0;
  storage.write = async (date, value) => { writes++; await write(date, value); };
  const sessions = create();
  await sessions.begin(beforeMidnight);
  const smallFrame = { ...frame, traces: undefined };
  for (let n = 0; n < 201; n++) append(sessions, beforeMidnight, smallFrame);
  const last = sessions.append(frame, "fgb.wav", 145825123, beforeMidnight);
  await sessions.flush();
  assert.equal(writes, 2, "Coalesce a burst of frames instead of queuing hundreds of full-trace snapshots");
  assert.equal(sessions.current.entries.length, 200);
  const ids = sessions.current.entries.map(entry => entry.id);
  const restored = create();
  await restored.begin(beforeMidnight);
  assert.deepEqual(restored.current.entries.map(entry => entry.id), ids);
  assert.deepEqual(restored.current.entries.at(-1), last, "Keep every trace, BCH result and reception metadata");
  const next = append(restored);
  assert.ok(next.id > last.id);
  await restored.flush();
  const exported = await restored.export("2026-11-25");
  assert.equal(exported.name, "sarsat-decodes-25-11-2026.json");
  const entries = JSON.parse(exported.json);
  assert.equal(entries.length, 200);
  assert.deepEqual(entries.at(-2), last, "Export keeps the existing Entry[] format and full traces");
});

test("Historical clearing and active loading/deletion are rejected; today's clear preserves subsequent frames", async () => {
  const { create, data } = fixture();
  const sessions = create();
  await sessions.begin(beforeMidnight);
  append(sessions);
  await assert.rejects(sessions.load("2026-11-25"), /Stop acquisition/);
  await assert.rejects(sessions.remove("2026-11-25"), /Stop acquisition/);
  await assert.rejects(sessions.clear(afterMidnight), /Only today's/);
  const cleared = sessions.clear(beforeMidnight);
  const next = append(sessions);
  await cleared;
  await sessions.flush();
  assert.deepEqual(sessions.current.entries, [next]);
  assert.deepEqual(JSON.parse(data.get("2026-11-25")!).entries, [next]);
  sessions.end();
  await sessions.remove("2026-11-25");
  assert.equal(data.size, 0);
  assert.deepEqual(sessions.current.entries, []);
  await assert.rejects(sessions.load("2026-11-25"), /no longer exists/);
});

test("Sessions list newest first with counts; deleting another day preserves the loaded session", async () => {
  const { create } = fixture();
  const sessions = create();
  await sessions.begin(beforeMidnight);
  append(sessions);
  sessions.end();
  await sessions.begin(afterMidnight);
  append(sessions, afterMidnight);
  append(sessions, afterMidnight);
  sessions.end();
  assert.deepEqual(await sessions.list(), [{ date: "2026-11-26", count: 2 }, { date: "2026-11-25", count: 1 }]);
  await sessions.remove("2026-11-25");
  assert.equal(sessions.current.entries.length, 2);
  assert.deepEqual(await sessions.list(), [{ date: "2026-11-26", count: 2 }]);
});

test("Corrupt sessions cannot be silently replaced and failed writes report errors without poisoning the queue", async () => {
  const { create, storage, data, errors } = fixture();
  data.set("2026-11-26", "{broken");
  const sessions = create();
  await sessions.begin(beforeMidnight);
  append(sessions);
  sessions.end();
  await assert.rejects(sessions.begin(afterMidnight));
  assert.equal(data.get("2026-11-26"), "{broken");
  assert.equal(sessions.current.date, "2026-11-25");
  const write = storage.write;
  storage.write = async () => { throw new Error("Disk full"); };
  await assert.rejects(sessions.begin(beforeMidnight), /Disk full/);
  assert.equal(sessions.acquisitionDate, null);
  storage.write = write;
  await sessions.begin(beforeMidnight);
  storage.write = async () => { throw new Error("Disk full"); };
  append(sessions);
  await sessions.flush();
  assert.ok(errors.some(message => message.includes("Could not save session 25/11/2026") && message.includes("Disk full")));
  storage.write = write;
  append(sessions);
  await sessions.flush();
  assert.equal(JSON.parse(data.get("2026-11-25")!).entries.length, 3);
  assert.equal(localSessionDate(new Date(2026, 0, 1)), "2026-01-01");
});

test("Preroll counts down processed milliseconds, then playback time excludes the prefix", () => {
  assert.deepEqual(playbackProgress(0, 230400, 2000), { remainingMs: 2000, elapsedSeconds: 0 });
  assert.deepEqual(playbackProgress(23040, 230400, 2000), { remainingMs: 1900, elapsedSeconds: 0 });
  assert.deepEqual(playbackProgress(460799, 230400, 2000), { remainingMs: 1, elapsedSeconds: 0 });
  assert.deepEqual(playbackProgress(460800, 230400, 2000), { remainingMs: 0, elapsedSeconds: 0 });
  assert.deepEqual(playbackProgress(691200, 230400, 2000), { remainingMs: 0, elapsedSeconds: 1 });
  assert.deepEqual(playbackProgress(23040, 230400, 0), { remainingMs: 0, elapsedSeconds: .1 });
});

test("Session dates display day first without timezone conversion and exports use filename-safe separators", async () => {
  assert.equal(formatSessionDate("2026-01-02"), "02/01/2026");
  assert.equal(formatSessionDate("2028-02-29", "-"), "29-02-2028");
  assert.throws(() => formatSessionDate("2026-02-29"));
  const { create } = fixture();
  const sessions = create();
  await sessions.begin(beforeMidnight);
  const entry = append(sessions);
  sessions.end();
  const exported = await sessions.export("2026-11-25");
  assert.equal(exported.name, "sarsat-decodes-25-11-2026.json");
  assert.equal(JSON.parse(exported.json)[0].received, entry.received, "Keep machine-readable timestamps and storage keys compatible");
  assert.equal(sessions.current.date, "2026-11-25");
});
