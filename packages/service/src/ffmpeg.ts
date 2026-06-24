import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import type { ChannelCandidate, FfmpegProfile } from "@m3u-mixer/shared";
import { chooseFfmpegProfile } from "@m3u-mixer/core";
import { ensureDir } from "./utils";

type JobKind = "video" | "audio" | "merged" | "public";

export type FfmpegJob = {
  kind: JobKind;
  manifestPath: string;
  outputUrl: string;
  stop: () => Promise<void>;
};

type FfmpegManagerOptions = {
  ffmpegPath?: string;
  tempRoot: string;
};

export class FfmpegManager {
  private readonly ffmpegPath: string;
  private readonly jobs = new Map<JobKind, ChildProcessWithoutNullStreams>();
  private readonly jobLogs = new Map<JobKind, string[]>();

  constructor(private readonly options: FfmpegManagerOptions) {
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
  }

  async stop(kind: JobKind): Promise<void> {
    const child = this.jobs.get(kind);
    if (!child) {
      return;
    }
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 3000);
    });
    this.jobs.delete(kind);
    this.jobLogs.delete(kind);
  }

  async stopAll(): Promise<void> {
    const kinds = Array.from(this.jobs.keys());
    for (const kind of kinds) {
      await this.stop(kind);
    }
  }

  async startPreview(input: {
    kind: "video" | "audio" | "merged";
    origin: string;
    videoCandidate?: ChannelCandidate | null;
    audioCandidate?: ChannelCandidate | null;
    videoDelayMs: number;
  }): Promise<FfmpegJob | null> {
    if (input.kind === "video" && !input.videoCandidate) {
      return null;
    }
    if (input.kind === "audio" && !input.audioCandidate) {
      return null;
    }
    if (input.kind === "merged" && (!input.videoCandidate || !input.audioCandidate)) {
      return null;
    }

    const jobDir = path.join(this.options.tempRoot, "preview", input.kind);
    await ensureDir(jobDir);
    await fs.rm(jobDir, { recursive: true, force: true });
    await ensureDir(jobDir);
    await ensureDir(path.join(jobDir, "segments"));

    const manifestPath = path.join(jobDir, "index.m3u8");
    const outputUrl = `${input.origin}/preview/${input.kind}/index.m3u8`;
    await this.stop(input.kind);

    const args = this.buildPreviewArgs(
      input.kind,
      manifestPath,
      input.videoCandidate ?? null,
      input.audioCandidate ?? null,
      input.videoDelayMs
    );
    const child = spawn(this.ffmpegPath, args, {
      stdio: "pipe"
    });
    this.captureJobLogs(input.kind, child);
    this.jobs.set(input.kind, child);

    return {
      kind: input.kind,
      manifestPath,
      outputUrl,
      stop: async () => this.stop(input.kind)
    };
  }

  async startPublicOutput(input: {
    origin: string;
    videoCandidate: ChannelCandidate;
    audioCandidate: ChannelCandidate;
    videoDelayMs: number;
    timestampStable: boolean;
  }): Promise<{ manifestPath: string; outputUrl: string; profile: FfmpegProfile }> {
    const kind: JobKind = "public";
    const jobDir = path.join(this.options.tempRoot, "public", "live");
    await ensureDir(jobDir);
    await fs.rm(jobDir, { recursive: true, force: true });
    await ensureDir(jobDir);
    await ensureDir(path.join(jobDir, "segments"));
    const manifestPath = path.join(jobDir, "main.m3u8");
    const outputUrl = `${input.origin}/live/main.m3u8`;
    await this.stop(kind);

    const profile = chooseFfmpegProfile(
      input.videoCandidate,
      input.audioCandidate,
      input.timestampStable
    );
    const args = this.buildPublicArgs(
      manifestPath,
      input.videoCandidate,
      input.audioCandidate,
      input.videoDelayMs,
      profile
    );
    const child = spawn(this.ffmpegPath, args, {
      stdio: "pipe"
    });
    this.captureJobLogs(kind, child);
    this.jobs.set(kind, child);

    return {
      manifestPath,
      outputUrl,
      profile
    };
  }

  private captureJobLogs(kind: JobKind, child: ChildProcessWithoutNullStreams): void {
    this.jobLogs.set(kind, []);
    const pushLog = (chunk: Buffer) => {
      const history = this.jobLogs.get(kind) ?? [];
      history.push(chunk.toString("utf8"));
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }
      this.jobLogs.set(kind, history);
    };
    child.stderr.on("data", pushLog);
    child.stdout.on("data", pushLog);
  }

  getJobLog(kind: JobKind): string {
    return (this.jobLogs.get(kind) ?? []).join("");
  }

  private commonInputArgs(url: string): string[] {
    return [
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "2",
      "-fflags",
      "+genpts+discardcorrupt",
      "-i",
      url
    ];
  }

  private buildPreviewArgs(
    kind: "video" | "audio" | "merged",
    manifestPath: string,
    videoCandidate: ChannelCandidate | null,
    audioCandidate: ChannelCandidate | null,
    videoDelayMs: number
  ): string[] {
    const segmentPattern = path.join(
      path.dirname(manifestPath),
      "segments",
      "seg_%06d.ts"
    );
    const args = ["-y"];
    if (kind === "video" && videoCandidate) {
      args.push(...this.commonInputArgs(videoCandidate.streamUrl));
      args.push(
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "scale='min(1280,iw)':-2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-c:a",
        "aac"
      );
    }
    if (kind === "audio" && audioCandidate) {
      args.push(...this.commonInputArgs(audioCandidate.streamUrl));
      args.push(
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0",
        "-vf",
        "scale='min(1280,iw)':-2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-c:a",
        "aac",
        "-b:a",
        "128k"
      );
    }
    if (kind === "merged" && videoCandidate && audioCandidate) {
      if (videoDelayMs > 0) {
        args.push("-itsoffset", (videoDelayMs / 1000).toFixed(3));
      }
      args.push(...this.commonInputArgs(videoCandidate.streamUrl));
      args.push(...this.commonInputArgs(audioCandidate.streamUrl));
      args.push(
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-vf",
        "scale='min(1280,iw)':-2",
        "-af",
        "aresample=async=1:first_pts=0",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-c:a",
        "aac",
        "-b:a",
        "128k"
      );
    }

    args.push(
      "-f",
      "hls",
      "-hls_time",
      "2",
      "-hls_list_size",
      "5",
      "-hls_flags",
      "delete_segments+append_list",
      "-hls_segment_filename",
      segmentPattern,
      manifestPath
    );

    return args;
  }

  private buildPublicArgs(
    manifestPath: string,
    videoCandidate: ChannelCandidate,
    audioCandidate: ChannelCandidate,
    videoDelayMs: number,
    profile: FfmpegProfile
  ): string[] {
    const segmentPattern = path.join(
      path.dirname(manifestPath),
      "segments",
      "seg_%06d.ts"
    );
    const args = ["-y"];
    if (videoDelayMs > 0) {
      args.push("-itsoffset", (videoDelayMs / 1000).toFixed(3));
    }
    args.push(...this.commonInputArgs(videoCandidate.streamUrl));
    args.push(...this.commonInputArgs(audioCandidate.streamUrl));
    args.push("-map", "0:v:0", "-map", "1:a:0");

    if (profile === "copy-av") {
      args.push("-c:v", "copy", "-c:a", "copy");
    } else if (profile === "copy-v-aac") {
      args.push(
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-ar",
        "48000"
      );
    } else if (profile === "h264-copy-a") {
      args.push(
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-g",
        "60",
        "-keyint_min",
        "60",
        "-sc_threshold",
        "0",
        "-c:a",
        "copy"
      );
    } else {
      args.push(
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-g",
        "60",
        "-keyint_min",
        "60",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-ar",
        "48000"
      );
    }

    args.push(
      "-af",
      "aresample=async=1:first_pts=0",
      "-f",
      "hls",
      "-hls_time",
      "3",
      "-hls_list_size",
      "6",
      "-hls_flags",
      "delete_segments+append_list",
      "-hls_segment_filename",
      segmentPattern,
      manifestPath
    );
    return args;
  }
}
