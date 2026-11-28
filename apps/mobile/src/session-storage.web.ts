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

import { formatSessionDate, type SessionStorage } from "./frame-sessions";

export function createSessionStorage(): SessionStorage {
  let connection: Promise<IDBDatabase> | undefined;
  function database() {
    return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("sarsat-frame-sessions", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("sessions");
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = undefined; };
        resolve(db);
      };
      request.onerror = () => { connection = undefined; reject(request.error); };
      request.onblocked = () => { connection = undefined; reject(new Error("Session storage upgrade is blocked by another tab")); };
    });
  }
  async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("sessions", mode);
      const request = action(transaction.objectStore("sessions"));
      transaction.oncomplete = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Session storage request failed"));
      transaction.onerror = () => reject(transaction.error ?? new Error("Session storage transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Session storage transaction was aborted"));
    });
  }
  return {
    async dates() {
      const keys = await transaction("readonly", store => store.getAllKeys());
      if (keys.some(key => typeof key !== "string")) throw new Error("Invalid session storage key");
      return keys.map(String);
    },
    async read(date) {
      const value: unknown = await transaction("readonly", store => store.get(date));
      if (value === undefined) return null;
      if (typeof value !== "string") throw new Error(`Invalid session data for ${formatSessionDate(date)}`);
      return value;
    },
    async write(date, value) { await transaction("readwrite", store => store.put(value, date)); },
    async remove(date) { await transaction("readwrite", store => store.delete(date)); },
  };
}

export async function saveJson(name: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  try { link.click(); }
  finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
