import path from "node:path";
import type {
  AppSettings,
  ChannelCandidate,
  ChannelProbeInput,
  ChannelQueryInput,
  ChannelQueryResult,
  FeedSaveInput,
  OutputSession,
  OutputStartInput,
  OutputUpdateInput,
  PreviewKind,
  PreviewStartInput
} from "@m3u-mixer/shared";
import { DEFAULT_OUTPUT_SESSION } from "@m3u-mixer/shared";
import { sortCandidates, sortGroups } from "@m3u-mixer/core";
import { AppStorage } from "./storage";
import { FeedFetcher } from "./fetcher";
import { ChannelProber } from "./probe";
import { FfmpegManager } from "./ffmpeg";
import { DiagnosticsLog } from "./diagnostics";
import { getLanAddresses, resolveAppDataDir } from "./utils";
import { startHlsServer, type HlsServerHandle } from "./hls-server";

type ServiceOptions = {
  appDataDir?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
};

export class M3uMixerService {
  private readonly storage: AppStorage;
  private readonly fetcher: FeedFetcher;
  private readonly prober: ChannelProber;
  private readonly ffmpeg: FfmpegManager;
  private readonly diagnostics = new DiagnosticsLog();
  private previewServer?: HlsServerHandle;
  private publicServer?: HlsServerHandle;
  private backgroundTimers: NodeJS.Timeout[] = [];

  constructor(private readonly options: ServiceOptions = {}) {
    const appDataDir = resolveAppDataDir(options.appDataDir);
    this.storage = new AppStorage(path.join(appDataDir, "m3u-mixer.sqlite"));
    this.fetcher = new FeedFetcher(this.storage);
    this.prober = new ChannelProber(this.storage, { ffprobePath: options.ffprobePath });
    this.ffmpeg = new FfmpegManager({
      ffmpegPath: options.ffmpegPath,
      tempRoot: path.join(appDataDir, "runtime")
    });
  }

  async init(): Promise<void> {
    this.previewServer = await startHlsServer({
      rootDir: path.join(resolveAppDataDir(this.options.appDataDir), "runtime", "preview"),
      bindHost: "127.0.0.1",
      port: 18998,
      routePrefix: "/preview/",
      rootMessage:
        "Preview HLS is only available after you start a preview in the app.\n" +
        "Available preview paths after startup:\n" +
        "  /preview/video/index.m3u8\n" +
        "  /preview/audio/index.m3u8\n" +
        "  /preview/merged/index.m3u8\n" +
        "This server is localhost-only.",
      missingMessage:
        "Preview stream is not running. Start video/audio/merged preview in the app first."
    });

    const settings = this.storage.getSettings();
    this.publicServer = await startHlsServer({
      rootDir: path.join(resolveAppDataDir(this.options.appDataDir), "runtime", "public"),
      bindHost: settings.publicBindHost,
      port: settings.publicPort,
      routePrefix: "/",
      rootMessage:
        "Public HLS output is only available after you start output in the app.\n" +
        "Main path:\n" +
        "  /live/main.m3u8\n" +
        "Use 127.0.0.1 only on the same machine. For other devices, use your LAN IP.",
      missingMessage:
        "Public output is not running. Start output in the app first, then open /live/main.m3u8."
    });

    this.startBackgroundLoops();
    this.diagnostics.push("info", "Service initialized");
  }

  async dispose(): Promise<void> {
    this.stopBackgroundLoops();
    await this.ffmpeg.stopAll();
    await this.previewServer?.close();
    await this.publicServer?.close();
    this.storage.close();
  }

  private startBackgroundLoops(): void {
    this.stopBackgroundLoops();
    const settings = this.storage.getSettings();
    const probeInterval = setInterval(() => {
      void this.probeAllChannels("all");
    }, 30 * 60 * 1000);
    const refreshInterval = setInterval(() => {
      void this.fetcher.refreshFeeds().catch((error) => {
        this.diagnostics.push("error", `Scheduled refresh failed: ${String(error)}`);
      });
    }, settings.refreshMinutes * 60 * 1000);
    const selectedProbeInterval = setInterval(() => {
      void this.probeSelectedOutputCandidates();
    }, 30 * 1000);
    this.backgroundTimers = [probeInterval, refreshInterval, selectedProbeInterval];
  }

  private stopBackgroundLoops(): void {
    for (const timer of this.backgroundTimers) {
      clearInterval(timer);
    }
    this.backgroundTimers = [];
  }

  async listFeeds() {
    return this.storage.listFeeds();
  }

  async saveFeed(input: FeedSaveInput) {
    const feed = this.storage.saveFeed(input);
    await this.fetcher.refreshFeed(feed);
    this.diagnostics.push("info", `Feed saved: ${feed.name}`);
    return this.storage.getFeed(feed.id);
  }

  async removeFeed(feedId: string): Promise<void> {
    this.storage.removeFeed(feedId);
    this.diagnostics.push("info", `Feed removed: ${feedId}`);
  }

  async refreshFeeds(feedIds?: string[]): Promise<void> {
    await this.fetcher.refreshFeeds(feedIds);
    this.diagnostics.push("info", `Feeds refreshed: ${feedIds?.join(",") ?? "all"}`);
  }

  async queryChannels(input: ChannelQueryInput): Promise<ChannelQueryResult> {
    const result = this.storage.listCandidatesForQuery(input.search, input.limit);
    return {
      groups: sortGroups(result.groups),
      candidates: sortCandidates(result.candidates)
    };
  }

  async probeChannels(input: ChannelProbeInput): Promise<void> {
    if (input.mode === "all") {
      await this.probeAllChannels("all");
      return;
    }
    if (input.mode === "visible") {
      const candidates = input.visibleGroupIds.flatMap((groupId) =>
        this.storage.listCandidatesByGroup(groupId)
      );
      const settings = this.storage.getSettings();
      await this.prober.probeCandidates(
        candidates,
        settings.probeTimeoutMs,
        settings.probeConcurrency
      );
      return;
    }
    const session = this.storage.getOutputSession();
    const selected = [session.videoGroupId, session.audioGroupId].filter(
      (value): value is string => Boolean(value)
    );
    const candidates = selected.flatMap((groupId) =>
      this.storage.listCandidatesByGroup(groupId)
    );
    const settings = this.storage.getSettings();
    await this.prober.probeCandidates(
      candidates,
      settings.probeTimeoutMs,
      settings.probeConcurrency
    );
  }

  private async probeAllChannels(reason: "all" | "selected"): Promise<void> {
    const candidates = this.storage.listAllCandidates();
    const settings = this.storage.getSettings();
    await this.prober.probeCandidates(
      candidates,
      settings.probeTimeoutMs,
      settings.probeConcurrency
    );
    this.diagnostics.push(
      "info",
      `Probe completed (${reason}) for ${candidates.length} candidates`
    );
  }

  private async probeSelectedOutputCandidates(): Promise<void> {
    const session = this.storage.getOutputSession();
    const groupIds = [session.videoGroupId, session.audioGroupId].filter(
      (value): value is string => Boolean(value)
    );
    if (groupIds.length === 0) {
      return;
    }
    const candidates = groupIds.flatMap((groupId) =>
      this.storage.listCandidatesByGroup(groupId)
    );
    const settings = this.storage.getSettings();
    await this.prober.probeCandidates(
      candidates,
      settings.probeTimeoutMs,
      settings.probeConcurrency
    );
    if (session.state === "running" || session.state === "restarting") {
      await this.ensureActiveOutputHealthy();
    }
  }

  async startPreview(
    input: PreviewStartInput
  ): Promise<{ url: string | null; note: string | null }> {
    if (!this.previewServer) {
      throw new Error("Preview server not initialized");
    }

    const videoCandidate = input.videoCandidateId
      ? this.storage.getCandidate(input.videoCandidateId)
      : null;
    const audioCandidate = input.audioCandidateId
      ? this.storage.getCandidate(input.audioCandidateId)
      : null;
    if (input.kind === "audio" && audioCandidate && !audioCandidate.hasVideo) {
      return { url: null, note: "当前音频源无视频轨，无法画面预览" };
    }
    const job = await this.ffmpeg.startPreview({
      kind: input.kind,
      origin: this.previewServer.origin,
      videoCandidate,
      audioCandidate,
      videoDelayMs: input.videoDelayMs
    });
    return {
      url: job?.outputUrl ?? null,
      note: job ? null : "缺少预览所需的频道选择"
    };
  }

  async stopPreview(kind: PreviewKind): Promise<void> {
    await this.ffmpeg.stop(kind);
  }

  async startOutput(input: OutputStartInput): Promise<OutputSession> {
    const session = {
      ...DEFAULT_OUTPUT_SESSION,
      videoGroupId: input.videoGroupId,
      audioGroupId: input.audioGroupId,
      videoDelayMs: input.videoDelayMs,
      state: "starting" as const
    };
    this.storage.saveOutputSession(session);
    return this.restartOutput();
  }

  async updateOutput(input: OutputUpdateInput): Promise<OutputSession> {
    const current = this.storage.getOutputSession();
    const next: OutputSession = {
      ...current,
      videoGroupId: input.videoGroupId ?? current.videoGroupId,
      audioGroupId: input.audioGroupId ?? current.audioGroupId,
      videoDelayMs: input.videoDelayMs ?? current.videoDelayMs,
      state: current.state === "idle" ? "idle" : "restarting",
      error: null
    };
    this.storage.saveOutputSession(next);
    if (next.state === "idle") {
      return next;
    }
    return this.restartOutput();
  }

  async stopOutput(): Promise<OutputSession> {
    await this.ffmpeg.stop("public");
    const session: OutputSession = {
      ...DEFAULT_OUTPUT_SESSION
    };
    this.storage.saveOutputSession(session);
    this.diagnostics.push("info", "Output stopped");
    return session;
  }

  async getSettings(): Promise<AppSettings> {
    return this.storage.getSettings();
  }

  async setSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
    const settings = this.storage.saveSettings(partial);
    if (this.publicServer) {
      await this.publicServer.close();
      this.publicServer = await startHlsServer({
        rootDir: path.join(resolveAppDataDir(this.options.appDataDir), "runtime", "public"),
        bindHost: settings.publicBindHost,
        port: settings.publicPort,
        routePrefix: "/",
        rootMessage:
          "Public HLS output is only available after you start output in the app.\n" +
          "Main path:\n" +
          "  /live/main.m3u8\n" +
          "Use 127.0.0.1 only on the same machine. For other devices, use your LAN IP.",
        missingMessage:
          "Public output is not running. Start output in the app first, then open /live/main.m3u8."
      });
    }
    this.startBackgroundLoops();
    return settings;
  }

  async tailLogs(limit: number) {
    return this.diagnostics.tail(limit);
  }

  private async restartOutput(): Promise<OutputSession> {
    if (!this.publicServer) {
      throw new Error("Public server not initialized");
    }
    const current = this.storage.getOutputSession();
    if (!current.videoGroupId || !current.audioGroupId) {
      const errored = {
        ...current,
        state: "error" as const,
        error: "未选择音频或视频频道组"
      };
      this.storage.saveOutputSession(errored);
      return errored;
    }

    const videoCandidate = this.resolveBestCandidate(current.videoGroupId);
    const audioCandidate = this.resolveBestCandidate(current.audioGroupId);
    if (!videoCandidate || !audioCandidate) {
      const errored = { ...current, state: "error" as const, error: "找不到可用候选源" };
      this.storage.saveOutputSession(errored);
      return errored;
    }

    try {
      const output = await this.ffmpeg.startPublicOutput({
        origin: this.publicServer.origin,
        videoCandidate,
        audioCandidate,
        videoDelayMs: current.videoDelayMs,
        timestampStable: true
      });
      const settings = this.storage.getSettings();
      const next: OutputSession = {
        ...current,
        resolvedVideoCandidateId: videoCandidate.id,
        resolvedAudioCandidateId: audioCandidate.id,
        profile: output.profile,
        publicUrl: `http://127.0.0.1:${settings.publicPort}/live/main.m3u8`,
        state: "running",
        error: null
      };
      this.storage.saveOutputSession(next);
      this.diagnostics.push("info", `Output started: ${output.outputUrl}`);
      return next;
    } catch (error) {
      const errored: OutputSession = {
        ...current,
        state: "error",
        error: error instanceof Error ? error.message : "启动输出失败"
      };
      this.storage.saveOutputSession(errored);
      this.diagnostics.push("error", `Output failed: ${errored.error}`);
      return errored;
    }
  }

  private async ensureActiveOutputHealthy(): Promise<void> {
    const session = this.storage.getOutputSession();
    if (!session.videoGroupId || !session.audioGroupId) {
      return;
    }
    const currentVideo = session.resolvedVideoCandidateId
      ? this.storage.getCandidate(session.resolvedVideoCandidateId)
      : null;
    const currentAudio = session.resolvedAudioCandidateId
      ? this.storage.getCandidate(session.resolvedAudioCandidateId)
      : null;
    if (currentVideo?.probe.available && currentAudio?.probe.available) {
      return;
    }
    await this.restartOutput();
  }

  private resolveBestCandidate(groupId: string): ChannelCandidate | null {
    const candidates = sortCandidates(this.storage.listCandidatesByGroup(groupId));
    return candidates.find((candidate) => candidate.probe.available) ?? candidates[0] ?? null;
  }

  getLanPlaybackUrls(): string[] {
    const session = this.storage.getOutputSession();
    if (!session.publicUrl) {
      return [];
    }
    const settings = this.storage.getSettings();
    return [
      `http://127.0.0.1:${settings.publicPort}/live/main.m3u8`,
      ...getLanAddresses().map(
        (address) => `http://${address}:${settings.publicPort}/live/main.m3u8`
      )
    ];
  }

  getCurrentOutputSession(): OutputSession {
    return this.storage.getOutputSession();
  }
}
