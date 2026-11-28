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

import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { type ServerEvent, type StartCommand, settingsSchema, infoSchema,
  playbackProfilesSchema } from "@sarsat/shared/protocol";
import { argumentsFor as sharedArguments, SessionCore, type EngineLauncher } from "@sarsat/shared/session-core";

const execute = promisify(execFile);
export function argumentsFor(command: StartCommand, samples: string[], root: string): string[] {
  return sharedArguments(command, samples, sample => join(root, "samples", sample));
}

export class Session extends SessionCore {
  constructor(readonly executable: string, readonly root: string, readonly samples: string[],
    emit: (event: ServerEvent) => void) {
    const launch: EngineLauncher = (args, handlers) => {
      const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: "pipe" });
      child.stderr.setEncoding("utf8").on("data", handlers.stderr);
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") emit({ type: "error", message: `Native control: ${error.message}` });
      });
      const lines = createInterface({ input: child.stdout });
      lines.on("line", handlers.line);
      child.on("error", handlers.error);
      child.on("close", code => { lines.close(); handlers.close(code); });
      return { stop: () => child.stdin.end("stop\n"), kill: () => child.kill() };
    };
    super(launch, () => samples, sample => join(root, "samples", sample), emit);
  }

  async info() {
    const options = { cwd: this.root, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 };
    const [defaults, devices, profiles] = await Promise.all([
      execute(this.executable, ["settings", "--json"], options),
      execute(this.executable, ["devices", "--json"], options),
      readFile(join(this.root, "samples", "playback-profiles.json"), "utf8"),
    ]);
    return { settings: settingsSchema.parse(JSON.parse(defaults.stdout)),
      devices: infoSchema.shape.devices.parse(JSON.parse(devices.stdout).devices), samples: this.samples, status: this.status,
      sampleProfiles: playbackProfilesSchema.parse(JSON.parse(profiles)) };
  }
}
