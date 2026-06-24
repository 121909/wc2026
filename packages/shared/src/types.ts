import { z } from "zod";

export const ProbeResultSchema = z.object({
  available: z.boolean(),
  checkedAt: z.string().datetime(),
  startupLatencyMs: z.number().int().nonnegative().nullable(),
  successRate24h: z.number().min(0).max(1),
  continuousAvailableSeconds: z.number().int().nonnegative(),
  failureReason: z.string().nullable()
});

export type ProbeResult = z.infer<typeof ProbeResultSchema>;

export const M3uFeedSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  inputKind: z.enum(["m3u", "m3u8-direct"]).default("m3u"),
  refreshMinutes: z.number().int().min(5).max(240),
  lastRefreshAt: z.string().datetime().nullable(),
  stale: z.boolean()
});

export type M3uFeed = z.infer<typeof M3uFeedSchema>;

export const AggregateHealthSchema = z.object({
  status: z.enum(["unknown", "available", "unavailable"]),
  available: z.boolean(),
  bestStartupLatencyMs: z.number().int().nonnegative().nullable(),
  successRate24h: z.number().min(0).max(1),
  continuousAvailableSeconds: z.number().int().nonnegative(),
  lastCheckedAt: z.string().datetime().nullable()
});

export type AggregateHealth = z.infer<typeof AggregateHealthSchema>;

export const ChannelGroupSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  normalizedName: z.string(),
  candidateCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  bestCandidateId: z.string().nullable(),
  aggregateHealth: AggregateHealthSchema
});

export type ChannelGroup = z.infer<typeof ChannelGroupSchema>;

export const ChannelCandidateSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  feedId: z.string(),
  streamUrl: z.string().url(),
  normalizedUrl: z.string(),
  protocol: z.enum(["hls", "http-stream"]),
  codecs: z.array(z.string()),
  resolution: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    })
    .nullable(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  probe: ProbeResultSchema
});

export type ChannelCandidate = z.infer<typeof ChannelCandidateSchema>;

export const OutputSessionStateSchema = z.enum([
  "idle",
  "starting",
  "running",
  "restarting",
  "error"
]);

export type OutputSessionState = z.infer<typeof OutputSessionStateSchema>;

export const FfmpegProfileSchema = z.enum([
  "copy-av",
  "copy-v-aac",
  "h264-copy-a",
  "h264-aac"
]);

export type FfmpegProfile = z.infer<typeof FfmpegProfileSchema>;

export const OutputSessionSchema = z.object({
  videoGroupId: z.string().nullable(),
  audioGroupId: z.string().nullable(),
  resolvedVideoCandidateId: z.string().nullable(),
  resolvedAudioCandidateId: z.string().nullable(),
  videoDelayMs: z.number().int().min(0).max(30000),
  profile: FfmpegProfileSchema.nullable(),
  publicUrl: z.string().url().nullable(),
  state: OutputSessionStateSchema,
  error: z.string().nullable()
});

export type OutputSession = z.infer<typeof OutputSessionSchema>;

export const AppSettingsSchema = z.object({
  publicBindHost: z.string(),
  publicPort: z.number().int().min(1).max(65535),
  refreshMinutes: z.number().int().min(5).max(240),
  probeConcurrency: z.number().int().min(1).max(16),
  probeTimeoutMs: z.number().int().min(1000).max(60000)
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const FeedSaveInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  url: z.string().url(),
  inputKind: z.enum(["m3u", "m3u8-direct"]).default("m3u"),
  refreshMinutes: z.number().int().min(5).max(240).default(15)
});

export type FeedSaveInput = z.infer<typeof FeedSaveInputSchema>;

export const ChannelQueryInputSchema = z.object({
  search: z.string().default(""),
  limit: z.number().int().min(1).max(500).default(200)
});

export type ChannelQueryInput = z.infer<typeof ChannelQueryInputSchema>;

export const ChannelProbeModeSchema = z.enum(["selected", "visible", "all"]);
export type ChannelProbeMode = z.infer<typeof ChannelProbeModeSchema>;

export const ChannelProbeInputSchema = z.object({
  mode: ChannelProbeModeSchema,
  groupIds: z.array(z.string()).default([]),
  visibleGroupIds: z.array(z.string()).default([])
});

export type ChannelProbeInput = z.infer<typeof ChannelProbeInputSchema>;

export const PreviewKindSchema = z.enum(["video", "audio", "merged"]);
export type PreviewKind = z.infer<typeof PreviewKindSchema>;

export const PreviewStartInputSchema = z.object({
  kind: PreviewKindSchema,
  videoCandidateId: z.string().nullable().optional(),
  audioCandidateId: z.string().nullable().optional(),
  videoDelayMs: z.number().int().min(0).max(30000).default(0)
});

export type PreviewStartInput = z.infer<typeof PreviewStartInputSchema>;

export const OutputStartInputSchema = z.object({
  videoGroupId: z.string(),
  audioGroupId: z.string(),
  videoDelayMs: z.number().int().min(0).max(30000).default(0)
});

export type OutputStartInput = z.infer<typeof OutputStartInputSchema>;

export const OutputUpdateInputSchema = z.object({
  videoGroupId: z.string().optional(),
  audioGroupId: z.string().optional(),
  videoDelayMs: z.number().int().min(0).max(30000).optional()
});

export type OutputUpdateInput = z.infer<typeof OutputUpdateInputSchema>;

export const DiagnosticsEntrySchema = z.object({
  timestamp: z.string().datetime(),
  level: z.enum(["info", "warn", "error"]),
  message: z.string()
});

export type DiagnosticsEntry = z.infer<typeof DiagnosticsEntrySchema>;

export const DiagnosticsTailSchema = z.array(DiagnosticsEntrySchema);

export const IpcContract = {
  "feeds.list": z.function().returns(z.promise(z.array(M3uFeedSchema))),
  "feeds.save": z.function().args(FeedSaveInputSchema).returns(z.promise(M3uFeedSchema)),
  "feeds.remove": z.function().args(z.string()).returns(z.promise(z.void())),
  "feeds.refresh": z.function().args(z.array(z.string()).optional()).returns(z.promise(z.void())),
  "channels.query": z.function().args(ChannelQueryInputSchema).returns(
    z.promise(
      z.object({
        groups: z.array(ChannelGroupSchema),
        candidates: z.array(ChannelCandidateSchema)
      })
    )
  ),
  "channels.probe": z.function().args(ChannelProbeInputSchema).returns(z.promise(z.void())),
  "session.preview.start": z.function().args(PreviewStartInputSchema).returns(
    z.promise(
      z.object({
        url: z.string().url().nullable(),
        note: z.string().nullable()
      })
    )
  ),
  "session.preview.stop": z.function().args(PreviewKindSchema).returns(z.promise(z.void())),
  "session.output.start": z.function().args(OutputStartInputSchema).returns(z.promise(OutputSessionSchema)),
  "session.output.stop": z.function().returns(z.promise(OutputSessionSchema)),
  "session.output.update": z.function().args(OutputUpdateInputSchema).returns(z.promise(OutputSessionSchema)),
  "session.output.current": z.function().returns(z.promise(OutputSessionSchema)),
  "session.output.urls": z.function().returns(z.promise(z.array(z.string().url()))),
  "settings.get": z.function().returns(z.promise(AppSettingsSchema)),
  "settings.set": z.function().args(AppSettingsSchema.partial()).returns(z.promise(AppSettingsSchema)),
  "diagnostics.logs.tail": z.function().args(z.number().int().min(1).max(500).default(200)).returns(z.promise(DiagnosticsTailSchema))
} as const;

export type ChannelQueryResult = {
  groups: ChannelGroup[];
  candidates: ChannelCandidate[];
};
