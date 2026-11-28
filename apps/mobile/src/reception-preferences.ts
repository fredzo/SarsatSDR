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

import { z } from "zod";
import { fgbFrequencyBandSchema, type Frame } from "@sarsat/shared/protocol";

const frequencyFilterSchema = fgbFrequencyBandSchema.extend({
  enabled: z.boolean(),
  preDecoder: z.boolean(),
});
const defaultFrequencyFilters = [
  { offsetHz: -28000, deviationHz: 1000, enabled: true, preDecoder: false },
  { offsetHz: -19000, deviationHz: 1000, enabled: false, preDecoder: false },
  { offsetHz: -16000, deviationHz: 1000, enabled: true, preDecoder: false },
  { offsetHz: -1000, deviationHz: 1000, enabled: false, preDecoder: false },
  { offsetHz: 2000, deviationHz: 1000, enabled: true, preDecoder: false },
  { offsetHz: 11000, deviationHz: 2000, enabled: true, preDecoder: true },
];

export const receptionPreferencesSchema = z.object({
  notifications: z.boolean().default(true),
  invalidNotifications: z.boolean().default(true),
  filteredNotifications: z.boolean().default(true),
  volume: z.number().finite().min(0).max(1).default(1),
  fgbFm: z.boolean().default(true),
  fgbFmVolume: z.number().finite().min(0).max(1).default(.5),
  filterInvalid: z.boolean().default(true),
  filterOrbitographic: z.boolean().default(true),
  fgbFrequencyFilters: z.array(frequencyFilterSchema).length(6).default(defaultFrequencyFilters),
  countdown: z.boolean().default(true),
  countdownSeconds: z.number().int().min(1).max(3600).default(50),
  countdownBeep: z.boolean().default(true),
  autoReloadCountdown: z.boolean().default(false),
  orbitoCountdown: z.boolean().default(false),
});
export type ReceptionPreferences = z.infer<typeof receptionPreferencesSchema>;
export type NotificationSound = "ok" | "ko" | "filtered" | "countl" | "counth";

function hasBchFailure(frame: Frame) {
  return frame.bch.some((bch, n) => {
    const limit = n === 0 ? frame.correctionLimit : frame.bch2Limit;
    return !bch.valid || (frame.generation === 1 && limit !== undefined && (bch.correctedErrors ?? 0) > limit);
  });
}

export function isFrameFiltered(frame: Frame, preferences: ReceptionPreferences) {
  return (preferences.filterInvalid && hasBchFailure(frame)) ||
    (preferences.filterOrbitographic && (frame.generation === 1 ? frame.beaconType === "ORB" : frame.beaconType === "SYSTM")) ||
    (frame.generation === 1 && preferences.fgbFrequencyFilters.some(filter =>
      filter.enabled && Math.abs(frame.frequencyOffsetHz - filter.offsetHz) <= filter.deviationHz));
}

export function startsFgbCountdown(frame: Frame, preferences: ReceptionPreferences) {
  return preferences.countdown && frame.generation === 1 && !isFrameFiltered(frame, preferences) &&
    (frame.beaconType !== "ORB" || preferences.orbitoCountdown);
}

export function frameNotification(frame: Frame, preferences: ReceptionPreferences): NotificationSound | null {
  if (isFrameFiltered(frame, preferences)) return preferences.filteredNotifications ? "filtered" : null;
  if (hasBchFailure(frame)) return preferences.invalidNotifications ? "ko" : null;
  return preferences.notifications ? "ok" : null;
}
