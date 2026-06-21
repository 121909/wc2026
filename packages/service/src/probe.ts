import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import type { ChannelCandidate, ProbeResult } from "@m3u-mixer/shared";
import type { AppStorage } from "./storage";

const execFileAsync = promisify(execFile);

type ProbeDependencies = {
  ffprobePath?: string;
};

type ProbeOutcome = {
  probe: ProbeResult;
  codecs: string[];
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
};

export class ChannelProber {
  private readonly ffprobePath: string;

  constructor(
    private readonly storage: AppStorage,
    dependencies: ProbeDependencies = {}
  ) {
    this.ffprobePath = dependencies.ffprobePath ?? "ffprobe";
  }

  async probeCandidates(
    candidates: ChannelCandidate[],
    timeoutMs: number,
    concurrency: number
  ): Promise<void> {
    const queue = [...candidates];
    const workerCount = Math.max(1, Math.min(concurrency, queue.length || 1));
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (queue.length > 0) {
          const candidate = queue.shift();
          if (!candidate) {
            return;
          }
          const outcome = await this.probeCandidate(candidate, timeoutMs);
          this.storage.updateCandidateMedia(candidate.id, {
            codecs: outcome.codecs,
            width: outcome.width,
            height: outcome.height,
            hasVideo: outcome.hasVideo,
            hasAudio: outcome.hasAudio
          });
          this.storage.updateProbe(candidate.id, outcome.probe);
        }
      })
    );
  }

  async probeCandidate(
    candidate: ChannelCandidate,
    timeoutMs: number
  ): Promise<ProbeOutcome> {
    if (candidate.protocol === "hls") {
      return this.probeHls(candidate, timeoutMs);
    }
    return this.probeGenericStream(candidate, timeoutMs);
  }

  private async probeHls(
    candidate: ChannelCandidate,
    timeoutMs: number
  ): Promise<ProbeOutcome> {
    const start = performance.now();
    const manifestResponse = await fetch(candidate.streamUrl, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!manifestResponse.ok) {
      return this.failure(candidate, `Manifest fetch failed: ${manifestResponse.status}`);
    }
    const manifest = await manifestResponse.text();
    const segmentLine = manifest
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));

    if (!segmentLine) {
      return this.failure(candidate, "Manifest has no media segment");
    }

    const segmentUrl = new URL(segmentLine, candidate.streamUrl).toString();
    const segmentResponse = await fetch(segmentUrl, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!segmentResponse.ok) {
      return this.failure(candidate, `Segment fetch failed: ${segmentResponse.status}`);
    }

    const media = await this.inspectMedia(candidate.streamUrl, timeoutMs);
    return {
      probe: {
        available: true,
        checkedAt: new Date().toISOString(),
        startupLatencyMs: Math.round(performance.now() - start),
        successRate24h: 1,
        continuousAvailableSeconds:
          Math.max(candidate.probe.continuousAvailableSeconds, 0) + 1800,
        failureReason: null
      },
      ...media
    };
  }

  private async probeGenericStream(
    candidate: ChannelCandidate,
    timeoutMs: number
  ): Promise<ProbeOutcome> {
    const start = performance.now();
    try {
      const media = await this.inspectMedia(candidate.streamUrl, timeoutMs);
      return {
        probe: {
          available: true,
          checkedAt: new Date().toISOString(),
          startupLatencyMs: Math.round(performance.now() - start),
          successRate24h: 1,
          continuousAvailableSeconds:
            Math.max(candidate.probe.continuousAvailableSeconds, 0) + 1800,
          failureReason: null
        },
        ...media
      };
    } catch (error) {
      return this.failure(
        candidate,
        error instanceof Error ? error.message : "Probe failed"
      );
    }
  }

  private async inspectMedia(
    streamUrl: string,
    timeoutMs: number
  ): Promise<Omit<ProbeOutcome, "probe">> {
    const { stdout } = await execFileAsync(
      this.ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,codec_type,width,height",
        "-of",
        "json",
        "-rw_timeout",
        String(timeoutMs * 1000),
        streamUrl
      ],
      { timeout: timeoutMs }
    );
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{
        codec_name?: string;
        codec_type?: string;
        width?: number;
        height?: number;
      }>;
    };
    const streams = parsed.streams ?? [];
    const codecs = streams
      .map((stream) => stream.codec_name)
      .filter((value): value is string => Boolean(value));
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    return {
      codecs,
      width: video?.width ?? null,
      height: video?.height ?? null,
      hasVideo: Boolean(video),
      hasAudio: Boolean(audio)
    };
  }

  private failure(candidate: ChannelCandidate, reason: string): ProbeOutcome {
    return {
      probe: {
        available: false,
        checkedAt: new Date().toISOString(),
        startupLatencyMs: null,
        successRate24h: candidate.probe.successRate24h * 0.9,
        continuousAvailableSeconds: 0,
        failureReason: reason
      },
      codecs: candidate.codecs,
      width: candidate.resolution?.width ?? null,
      height: candidate.resolution?.height ?? null,
      hasVideo: candidate.hasVideo,
      hasAudio: candidate.hasAudio
    };
  }
}
