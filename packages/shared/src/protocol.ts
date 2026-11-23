import { z } from "zod";

const finite = z.number().finite();
const settingsFields = z.object({
  fgb: z.boolean(), sgb: z.boolean(), normalPrn: z.boolean(), testPrn: z.boolean(),
  fgbNormal: z.boolean().default(true), fgbSelfTest: z.boolean().default(true),
  qualityCheck: z.boolean(), showBchFailures: z.boolean(),
  fgbAlpha: finite.nonnegative(), fgbBeta: finite.nonnegative(),
  fgbZeta: finite.nonnegative(), fgbAverage: finite.min(0).max(1),
  fgbRuntimeMs: z.number().int().positive(),
  fgbMaxCandidates: z.number().int().min(1).max(10).default(4),
  fgbMaxErrors: z.number().int().min(0).max(3),
  fgbHeaderErrors: z.number().int().min(0).max(3),
  fgbBch2MaxErrors: z.number().int().min(0).max(2),
  fgbOverPeakDb: finite.nonnegative(),
  sgbThreshold: finite.min(0).max(512), sgbPhaseGain: finite.nonnegative(),
  sgbFrequencyGain: finite.nonnegative(), sgbFilter: finite.min(0).max(1),
  sgbFeedback: finite.nonnegative(),
  sgbMaxErrors: z.number().int().min(0).max(6),
  searchDepth: z.number().int().min(3).max(9),
  prnAlignment: z.number().int().min(0).max(2),
});
export const settingsSchema = settingsFields;
export type Settings = z.infer<typeof settingsSchema>;

const playbackProfileSchema = z.object({
  removeDc: z.boolean(), noisePrerollMs: z.number().int().min(0).max(10000),
  settings: settingsFields.pick({ fgb: true, sgb: true, fgbOverPeakDb: true, fgbAlpha: true, fgbBeta: true,
    fgbAverage: true, fgbZeta: true, fgbMaxErrors: true, fgbHeaderErrors: true, fgbBch2MaxErrors: true })
    .partial({ fgbOverPeakDb: true, fgbAlpha: true, fgbBeta: true, fgbAverage: true,
      fgbZeta: true, fgbMaxErrors: true, fgbHeaderErrors: true, fgbBch2MaxErrors: true }).strict(),
}).strict();
export const playbackProfilesSchema = z.record(z.string(), playbackProfileSchema);
export function playbackConfiguration(defaults: Settings, profile: z.infer<typeof playbackProfileSchema>) {
  return { removeDc: profile.removeDc, noisePrerollMs: profile.noisePrerollMs,
    settings: settingsSchema.parse({ ...defaults, ...profile.settings }) };
}

const trace = z.object({
  count: z.number().int().nonnegative(), stride: z.number().int().positive(),
  values: z.array(finite).max(4400),
});
export const frameSchema = z.object({
  generation: z.union([z.literal(1), z.literal(2)]),
  mode: z.enum(["normal", "self_test"]), headerErrors: z.number().int().min(0).max(9).optional(),
  fgbBitStartSample: z.number().int().nonnegative().optional(),
  timeSeconds: finite, frequencyOffsetHz: finite, beaconType: z.string().min(1),
  rawHex: z.string().regex(/^[0-9A-F]{28,63}$/),
  correctedHex: z.string().regex(/^[0-9A-F]{28,63}$/),
  correctionLimit: z.number().int().min(0).max(6).optional(),
  bch2Limit: z.number().int().min(0).max(2).optional(),
  bch: z.array(z.object({ valid: z.boolean(), correctedErrors: z.number().int().nonnegative().nullable() })).min(1).max(2),
  fields: z.array(z.object({ section: z.string(), name: z.string(), value: z.string() })).max(64).optional(),
  traces: z.object({ phase: trace, i: trace, q: trace }).optional(),
});
export type Frame = z.infer<typeof frameSchema>;
export const diagnosticsSchema = z.object({
  fgbMaxPeakDb: finite, fgbCandidates: finite, fgbMaxSyncVotes: finite,
  sgbMaxDetectionLevel: finite, sgbCandidates: finite, sgbQualityRejections: finite, sgbBchRejections: finite,
});
export type Diagnostics = z.infer<typeof diagnosticsSchema>;
export const acquisitionChannelSchema = z.object({
  channel: z.number().int().min(0).max(9), frequencyOffsetHz: finite, levelDbfs: finite,
});
export type AcquisitionChannel = z.infer<typeof acquisitionChannelSchema>;
export const nativeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session"), source: z.enum(["rtl", "sample"]), sampleRateHz: finite.positive(),
    centerHz: finite, durationSeconds: finite.nonnegative().nullable(), noisePrerollMs: finite.optional(),
    label: z.string().optional() }),
  z.object({ type: z.literal("spectrum"), timeSeconds: finite, startHz: finite, binWidthHz: finite.positive(),
    displayOffsetDb: finite, fullBandwidthDbm: finite.nullable(), dbfs: z.array(finite.nullable()).length(1024) }),
  z.object({ type: z.literal("acquisition"), channels: z.array(acquisitionChannelSchema).max(10)
    .refine(channels => new Set(channels.map(channel => channel.channel)).size === channels.length,
      "Duplicate FGB channel") }),
  z.object({ type: z.literal("frame"), frame: frameSchema }),
  z.object({ type: z.literal("fmAudio"), channel: z.number().int().min(0).max(9),
    pcm: z.string().min(4).max(1280).regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .refine(text => text.length % 4 === 0 && (text.length / 4 * 3 -
        (text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0)) % 2 === 0) }),
  z.object({ type: z.literal("metrics"), samples: finite.nonnegative(), diagnostics: diagnosticsSchema,
    gainIndex: finite.optional(), clippedSamples: finite.optional() }),
  z.object({ type: z.literal("complete"), result: z.object({
    diagnostics: diagnosticsSchema, frames: z.array(frameSchema), dspSamples: finite.nonnegative().optional(),
  }).passthrough() }),
]);
export const serverEventSchema = z.union([nativeEventSchema,
  z.object({ type: z.literal("recording"), file: z.string().nullable(), saved: z.string().optional() }),
  z.object({ type: z.literal("status"), status: z.enum(["idle", "starting", "running", "stopping", "retrying"]) }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
export type SpectrumEvent = Extract<ServerEvent, { type: "spectrum" }>;

const centerFrequencyHz = z.number().int().min(100000000).max(999000000);
export const retuneSchema = z.object({ type: z.literal("retune"), centerHz: centerFrequencyHz });
export const startSchema = z.object({
  type: z.literal("start"), source: z.enum(["rtl", "sample"]),
  centerHz: centerFrequencyHz,
  gainIndex: z.number().int().min(0).max(11), agc: z.boolean(),
  bus: z.number().int().min(0).max(255).optional(), address: z.number().int().min(0).max(255).optional(),
  sample: z.string().max(128).optional(),
  removeDc: z.boolean(), noisePrerollMs: z.number().int().min(0).max(10000),
  settings: settingsSchema,
  fgbFm: z.boolean().optional(),
}).refine(s => (s.bus === undefined) === (s.address === undefined), "Bus and address must be specified together");
export const commandSchema = z.union([startSchema, retuneSchema, z.object({ type: z.literal("stop") })]);
export type StartCommand = z.infer<typeof startSchema>;

export const infoSchema = z.object({
  settings: settingsSchema,
  devices: z.array(z.object({ vendorId: finite, productId: finite, bus: finite, address: finite })),
  samples: z.array(z.string()), status: z.enum(["idle", "starting", "running", "stopping", "retrying"]),
  sampleProfiles: playbackProfilesSchema,
});
export type Info = z.infer<typeof infoSchema>;
