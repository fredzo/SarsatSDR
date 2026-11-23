import { z } from "zod";
import { settingsSchema } from "@sarsat/shared/protocol";

export const appPreferencesSchema = z.object({
  settings: settingsSchema.nullable().default(null),
  center: z.number().finite().min(100).max(999).default(406.05),
  gain: z.number().int().min(0).max(11).default(8),
  agc: z.boolean().default(true),
  sample: z.string().max(128).default("sgb.wav"),
  useSampleProfile: z.boolean().default(true),
  removeDc: z.boolean().default(false),
  preroll: z.number().int().min(0).max(10000).default(0),
  base: z.number().min(0).max(100).default(27),
  range: z.number().min(0).max(100).default(11),
  waterfallAutomatic: z.boolean().default(true),
  calibrationDb: z.number().finite().default(0),
  average: z.number().min(.01).max(.99).default(.5),
  waterfallSpeed: z.number().min(.25).max(4).default(1),
});
