import crypto from "node:crypto";
import { parseM3u } from "@m3u-mixer/core";
import type { M3uFeed } from "@m3u-mixer/shared";
import type { AppStorage } from "./storage";

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class FeedFetcher {
  constructor(private readonly storage: AppStorage) {}

  async refreshFeeds(feedIds?: string[]): Promise<void> {
    const feeds = this.storage
      .listFeeds()
      .filter((feed) => !feedIds || feedIds.includes(feed.id));
    for (const feed of feeds) {
      await this.refreshFeed(feed);
    }
  }

  async refreshFeed(feed: M3uFeed): Promise<void> {
    const snapshot = this.storage.getFeedSnapshot(feed.id);
    const headers: Record<string, string> = {};
    if (snapshot?.etag) {
      headers["If-None-Match"] = snapshot.etag;
    }
    if (snapshot?.last_modified) {
      headers["If-Modified-Since"] = snapshot.last_modified;
    }

    try {
      const response = await fetch(feed.url, { headers });
      if (response.status === 304) {
        const staleFailures = 0;
        this.storage.updateFeedSnapshot(feed.id, {
          etag: snapshot?.etag ?? null,
          last_modified: snapshot?.last_modified ?? null,
          content_hash: snapshot?.content_hash ?? null,
          fetched_at: new Date().toISOString(),
          stale_failures: staleFailures
        });
        this.storage.markFeedRefresh(feed.id, staleFailures);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch feed: ${response.status} ${response.statusText}`);
      }

      const content = await response.text();
      const parsed = parseM3u(content).map((entry) => ({
        displayName: entry.name,
        normalizedName: entry.normalizedName,
        streamUrl: entry.streamUrl,
        normalizedUrl: entry.normalizedUrl,
        protocol:
          entry.streamUrl.endsWith(".m3u8") || entry.streamUrl.includes(".m3u8?")
            ? ("hls" as const)
            : ("http-stream" as const)
      }));

      this.storage.upsertCandidates(feed.id, parsed);

      const staleFailures = 0;
      this.storage.updateFeedSnapshot(feed.id, {
        etag: response.headers.get("etag"),
        last_modified: response.headers.get("last-modified"),
        content_hash: hashContent(content),
        fetched_at: new Date().toISOString(),
        stale_failures: staleFailures
      });
      this.storage.markFeedRefresh(feed.id, staleFailures);
    } catch (error) {
      const staleFailures = (snapshot?.stale_failures ?? 0) + 1;
      this.storage.updateFeedSnapshot(feed.id, {
        etag: snapshot?.etag ?? null,
        last_modified: snapshot?.last_modified ?? null,
        content_hash: snapshot?.content_hash ?? null,
        fetched_at: snapshot?.fetched_at ?? new Date().toISOString(),
        stale_failures: staleFailures
      });
      this.storage.markFeedRefresh(feed.id, staleFailures);
      throw error;
    }
  }
}
