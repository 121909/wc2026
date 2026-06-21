import type { AppSettings, OutputSession } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  publicBindHost: "0.0.0.0",
  publicPort: 18999,
  refreshMinutes: 15,
  probeConcurrency: 4,
  probeTimeoutMs: 8000
};

export const DEFAULT_OUTPUT_SESSION: OutputSession = {
  videoGroupId: null,
  audioGroupId: null,
  resolvedVideoCandidateId: null,
  resolvedAudioCandidateId: null,
  videoDelayMs: 0,
  profile: null,
  publicUrl: null,
  state: "idle",
  error: null
};
