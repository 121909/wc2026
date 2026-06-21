import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  chooseFfmpegProfile,
  normalizeChannelName,
  normalizeUrl,
  parseM3u,
  sortCandidates,
  sortGroups
} from "@m3u-mixer/core";
import type { ChannelCandidate, ChannelGroup } from "@m3u-mixer/shared";

const fixture = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/sample.m3u"), "utf8");

function candidate(overrides: Partial<ChannelCandidate>): ChannelCandidate {
  return {
    id: overrides.id ?? "candidate-1",
    groupId: overrides.groupId ?? "group-1",
    feedId: overrides.feedId ?? "feed-1",
    streamUrl: overrides.streamUrl ?? "https://example.com/live/index.m3u8",
    normalizedUrl: overrides.normalizedUrl ?? "https://example.com/live/index.m3u8",
    protocol: overrides.protocol ?? "hls",
    codecs: overrides.codecs ?? ["h264", "aac"],
    resolution: overrides.resolution ?? { width: 1920, height: 1080 },
    hasVideo: overrides.hasVideo ?? true,
    hasAudio: overrides.hasAudio ?? true,
    probe: overrides.probe ?? {
      available: true,
      checkedAt: new Date().toISOString(),
      startupLatencyMs: 800,
      successRate24h: 0.95,
      continuousAvailableSeconds: 3600,
      failureReason: null
    }
  };
}

describe("normalize", () => {
  it("normalizes channel names with NFKC and lowercase", () => {
    expect(normalizeChannelName("  CCTV　1 HD  ")).toBe("cctv 1 hd");
  });

  it("normalizes urls by dropping hash", () => {
    expect(normalizeUrl("https://example.com/live/index.m3u8#foo")).toBe(
      "https://example.com/live/index.m3u8"
    );
  });
});

describe("parseM3u", () => {
  it("parses extinf entries", () => {
    const entries = parseM3u(fixture);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.normalizedName).toBe("cctv 1 hd");
    expect(entries[2]?.streamUrl).toContain("music.aac");
  });
});

describe("sorting", () => {
  it("sorts candidates by health and latency", () => {
    const sorted = sortCandidates([
      candidate({
        id: "slow",
        probe: {
          available: true,
          checkedAt: new Date().toISOString(),
          startupLatencyMs: 1500,
          successRate24h: 0.92,
          continuousAvailableSeconds: 1000,
          failureReason: null
        }
      }),
      candidate({
        id: "fast",
        probe: {
          available: true,
          checkedAt: new Date().toISOString(),
          startupLatencyMs: 500,
          successRate24h: 0.92,
          continuousAvailableSeconds: 1000,
          failureReason: null
        }
      })
    ]);
    expect(sorted[0]?.id).toBe("fast");
  });

  it("sorts groups by availability then continuity", () => {
    const groups: ChannelGroup[] = [
      {
        id: "b",
        displayName: "B",
        normalizedName: "b",
        candidateCount: 1,
        sourceCount: 1,
        bestCandidateId: "1",
        aggregateHealth: {
          available: true,
          bestStartupLatencyMs: 900,
          successRate24h: 0.9,
          continuousAvailableSeconds: 500
        }
      },
      {
        id: "a",
        displayName: "A",
        normalizedName: "a",
        candidateCount: 1,
        sourceCount: 1,
        bestCandidateId: "2",
        aggregateHealth: {
          available: true,
          bestStartupLatencyMs: 700,
          successRate24h: 0.9,
          continuousAvailableSeconds: 1000
        }
      }
    ];
    expect(sortGroups(groups)[0]?.id).toBe("a");
  });
});

describe("ffmpeg profile", () => {
  it("prefers copy-av for h264+aac with stable timestamps", () => {
    expect(
      chooseFfmpegProfile(candidate({ codecs: ["h264"] }), candidate({ codecs: ["aac"] }), true)
    ).toBe("copy-av");
  });

  it("falls back to h264-aac for incompatible codecs", () => {
    expect(
      chooseFfmpegProfile(candidate({ codecs: ["hevc"] }), candidate({ codecs: ["ac3"] }), false)
    ).toBe("h264-aac");
  });
});
