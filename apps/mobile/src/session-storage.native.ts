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

import * as FileSystem from "expo-file-system/legacy";
import { sessionDateSchema, type SessionStorage } from "./frame-sessions";

export function createSessionStorage(): SessionStorage {
  function directory() {
    if (!FileSystem.documentDirectory) throw new Error("Internal application storage is unavailable");
    return `${FileSystem.documentDirectory}frame-sessions/`;
  }
  const file = (date: string) => `${directory()}${sessionDateSchema.parse(date)}.json`;
  return {
    async dates() {
      const path = directory();
      if (!(await FileSystem.getInfoAsync(path)).exists) return [];
      return (await FileSystem.readDirectoryAsync(path))
        .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).map(name => name.slice(0, -5));
    },
    async read(date) {
      const path = file(date);
      return (await FileSystem.getInfoAsync(path)).exists ? FileSystem.readAsStringAsync(path) : null;
    },
    async write(date, value) {
      const path = file(date);
      await FileSystem.makeDirectoryAsync(directory(), { intermediates: true });
      await FileSystem.writeAsStringAsync(`${path}.tmp`, value);
      await FileSystem.moveAsync({ from: `${path}.tmp`, to: path });
    },
    async remove(date) { await FileSystem.deleteAsync(file(date)); },
  };
}

export async function saveJson(name: string, json: string) {
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return;
  const uri = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, name, "application/json");
  await FileSystem.writeAsStringAsync(uri, json);
}
