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

import type { Frame } from "./protocol";

export function beaconPosition(frame: Frame) {
  const value = (name: string) => {
    const text = frame.fields?.find(field => field.name === name)?.value;
    return text?.trim() ? Number(text) : NaN;
  };
  const lat = value("Latitude"), lon = value("Longitude");
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export function beaconLocator(frame: Frame) {
  const position = beaconPosition(frame);
  if (!position) return null;
  const x = Math.min(Math.floor((position.lon + 180) * 2880), 360 * 2880 - 1);
  const y = Math.min(Math.floor((position.lat + 90) * 5760), 180 * 5760 - 1);
  const pair = (divisor: number, base: number, size: number) =>
    String.fromCharCode(base + Math.floor(x / divisor) % size, base + Math.floor(y / divisor) % size);
  return pair(57600, 65, 18) + pair(5760, 48, 10) + pair(240, 97, 24) +
    pair(24, 48, 10) + pair(1, 97, 24);
}

export const googleMapsUrl = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
export const wazeUrl = (lat: number, lon: number) => `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
export const geoUrl = (lat: number, lon: number) => `geo:${lat.toFixed(6)},${lon.toFixed(6)}`;
