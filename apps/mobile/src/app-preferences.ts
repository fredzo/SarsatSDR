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
