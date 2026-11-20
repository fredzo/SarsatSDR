import { z } from "zod";
import type { Frame } from "@sarsat/shared/protocol";

export const receptionPreferencesSchema = z.object({
  notifications: z.boolean().default(true),
  volume: z.number().finite().min(0).max(1).default(1),
  fgbFm: z.boolean().default(true),
  fgbFmVolume: z.number().finite().min(0).max(1).default(.5),
  filterInvalid: z.boolean().default(false),
  filterOrbitographic: z.boolean().default(false),
  countdown: z.boolean().default(true),
  countdownSeconds: z.number().int().min(1).max(3600).default(50),
  countdownBeep: z.boolean().default(true),
  autoReloadCountdown: z.boolean().default(false),
});
export type ReceptionPreferences = z.infer<typeof receptionPreferencesSchema>;
export type NotificationSound = "ok" | "ko" | "filtered" | "countl" | "counth";

export function isFrameFiltered(frame: Frame, preferences: ReceptionPreferences) {
  return (preferences.filterInvalid && frame.bch.some(bch => !bch.valid)) ||
    (preferences.filterOrbitographic && (frame.generation === 1 ? frame.beaconType === "ORB" : frame.beaconType === "SYSTM"));
}

export function frameNotification(frame: Frame, preferences: ReceptionPreferences): NotificationSound | null {
  if (!preferences.notifications) return null;
  if (isFrameFiltered(frame, preferences)) return "filtered";
  return frame.bch.every(bch => bch.valid) ? "ok" : "ko";
}
