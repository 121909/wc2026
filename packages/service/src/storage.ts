import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type {
  AppSettings,
  ChannelCandidate,
  ChannelGroup,
  M3uFeed,
  OutputSession,
  ProbeResult
} from "@m3u-mixer/shared";
import { DEFAULT_OUTPUT_SESSION, DEFAULT_SETTINGS } from "@m3u-mixer/shared";
import { normalizeChannelName } from "@m3u-mixer/core";
import { createId } from "./utils";

type FeedSnapshotRow = {
  feed_id: string;
  etag: string | null;
  last_modified: string | null;
  content_hash: string | null;
  fetched_at: string;
  stale_failures: number;
};

type FeedRow = {
  id: string;
  name: string;
  url: string;
  input_kind: "m3u" | "m3u8-direct";
  refresh_minutes: number;
  last_refresh_at: string | null;
  stale: number;
};

type CandidateRow = {
  id: string;
  group_id: string;
  feed_id: string;
  display_name: string;
  stream_url: string;
  normalized_url: string;
  protocol: "hls" | "http-stream";
  codecs_json: string;
  resolution_width: number | null;
  resolution_height: number | null;
  has_video: number;
  has_audio: number;
  probe_available: number;
  probe_checked_at: string | null;
  probe_startup_latency_ms: number | null;
  probe_success_rate_24h: number;
  probe_continuous_available_seconds: number;
  probe_failure_reason: string | null;
};

const UNKNOWN_CHECKED_AT = new Date(0).toISOString();

type GroupRow = {
  id: string;
  display_name: string;
  normalized_name: string;
};

export class AppStorage {
  private readonly db: Database.Database;

  constructor(dbFile: string) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    this.db = new Database(dbFile);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
    this.seedDefaults();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feeds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        input_kind TEXT NOT NULL DEFAULT 'm3u',
        refresh_minutes INTEGER NOT NULL,
        last_refresh_at TEXT,
        stale INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS feed_snapshots (
        feed_id TEXT PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
        etag TEXT,
        last_modified TEXT,
        content_hash TEXT,
        fetched_at TEXT NOT NULL,
        stale_failures INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS channel_groups (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS channel_candidates (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES channel_groups(id) ON DELETE CASCADE,
        feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        stream_url TEXT NOT NULL,
        normalized_url TEXT NOT NULL,
        protocol TEXT NOT NULL,
        codecs_json TEXT NOT NULL DEFAULT '[]',
        resolution_width INTEGER,
        resolution_height INTEGER,
        has_video INTEGER NOT NULL DEFAULT 1,
        has_audio INTEGER NOT NULL DEFAULT 1,
        UNIQUE(feed_id, normalized_url)
      );

      CREATE TABLE IF NOT EXISTS probe_results (
        candidate_id TEXT PRIMARY KEY REFERENCES channel_candidates(id) ON DELETE CASCADE,
        available INTEGER NOT NULL DEFAULT 0,
        checked_at TEXT,
        startup_latency_ms INTEGER,
        success_rate_24h REAL NOT NULL DEFAULT 0,
        continuous_available_seconds INTEGER NOT NULL DEFAULT 0,
        failure_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS output_presets (
        id TEXT PRIMARY KEY,
        video_group_id TEXT,
        audio_group_id TEXT,
        video_delay_ms INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_runtime (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `);

    const feedColumns = this.db.prepare(`PRAGMA table_info(feeds)`).all() as Array<{
      name: string;
    }>;
    if (!feedColumns.some((column) => column.name === "input_kind")) {
      this.db.exec(
        `ALTER TABLE feeds ADD COLUMN input_kind TEXT NOT NULL DEFAULT 'm3u'`
      );
    }
  }

  private seedDefaults(): void {
    if (!this.db.prepare(`SELECT 1 FROM app_settings WHERE key = 'settings'`).get()) {
      this.db
        .prepare(`INSERT INTO app_settings (key, value_json) VALUES ('settings', @valueJson)`)
        .run({ valueJson: JSON.stringify(DEFAULT_SETTINGS) });
    }
    if (!this.db.prepare(`SELECT 1 FROM app_runtime WHERE key = 'output_session'`).get()) {
      this.db
        .prepare(`INSERT INTO app_runtime (key, value_json) VALUES ('output_session', @valueJson)`)
        .run({ valueJson: JSON.stringify(DEFAULT_OUTPUT_SESSION) });
    }
  }

  close(): void {
    this.db.close();
  }

  listFeeds(): M3uFeed[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, url, input_kind, refresh_minutes, last_refresh_at, stale
         FROM feeds
         ORDER BY name COLLATE NOCASE ASC`
      )
      .all() as FeedRow[];

    return rows.map((row) => this.mapFeed(row));
  }

  saveFeed(input: {
    id?: string;
    name: string;
    url: string;
    inputKind: "m3u" | "m3u8-direct";
    refreshMinutes: number;
  }): M3uFeed {
    const id = input.id ?? createId("feed");
    this.db
      .prepare(
        `INSERT INTO feeds (id, name, url, input_kind, refresh_minutes, stale)
         VALUES (@id, @name, @url, @inputKind, @refreshMinutes, 0)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           url = excluded.url,
           input_kind = excluded.input_kind,
           refresh_minutes = excluded.refresh_minutes`
      )
      .run({
        id,
        name: input.name,
        url: input.url,
        inputKind: input.inputKind,
        refreshMinutes: input.refreshMinutes
      });
    return this.getFeed(id);
  }

  getFeed(feedId: string): M3uFeed {
    const row = this.db
      .prepare(
        `SELECT id, name, url, input_kind, refresh_minutes, last_refresh_at, stale
         FROM feeds
         WHERE id = ?`
      )
      .get(feedId) as FeedRow | undefined;
    if (!row) {
      throw new Error(`Feed not found: ${feedId}`);
    }
    return this.mapFeed(row);
  }

  removeFeed(feedId: string): void {
    this.db.prepare(`DELETE FROM feeds WHERE id = ?`).run(feedId);
  }

  private mapFeed(row: FeedRow): M3uFeed {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      inputKind: row.input_kind ?? "m3u",
      refreshMinutes: row.refresh_minutes,
      lastRefreshAt: row.last_refresh_at,
      stale: Boolean(row.stale)
    };
  }

  getFeedSnapshot(feedId: string): FeedSnapshotRow | null {
    return (this.db
      .prepare(
        `SELECT feed_id, etag, last_modified, content_hash, fetched_at, stale_failures
         FROM feed_snapshots
         WHERE feed_id = ?`
      )
      .get(feedId) as FeedSnapshotRow | undefined) ?? null;
  }

  updateFeedSnapshot(feedId: string, snapshot: Omit<FeedSnapshotRow, "feed_id">): void {
    this.db
      .prepare(
        `INSERT INTO feed_snapshots (feed_id, etag, last_modified, content_hash, fetched_at, stale_failures)
         VALUES (@feedId, @etag, @lastModified, @contentHash, @fetchedAt, @staleFailures)
         ON CONFLICT(feed_id) DO UPDATE SET
           etag = excluded.etag,
           last_modified = excluded.last_modified,
           content_hash = excluded.content_hash,
           fetched_at = excluded.fetched_at,
           stale_failures = excluded.stale_failures`
      )
      .run({
        feedId,
        etag: snapshot.etag,
        lastModified: snapshot.last_modified,
        contentHash: snapshot.content_hash,
        fetchedAt: snapshot.fetched_at,
        staleFailures: snapshot.stale_failures
      });
  }

  markFeedRefresh(feedId: string, staleFailures: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE feeds
         SET last_refresh_at = @now,
             stale = @stale
         WHERE id = @feedId`
      )
      .run({
        now,
        stale: staleFailures >= 2 ? 1 : 0,
        feedId
      });
  }

  upsertCandidates(
    feedId: string,
    entries: Array<{
      displayName: string;
      normalizedName: string;
      streamUrl: string;
      normalizedUrl: string;
      protocol: "hls" | "http-stream";
    }>
  ): void {
    const groupSelect = this.db.prepare(
      `SELECT id FROM channel_groups WHERE normalized_name = ?`
    );
    const insertGroup = this.db.prepare(
      `INSERT INTO channel_groups (id, display_name, normalized_name)
       VALUES (@id, @displayName, @normalizedName)`
    );
    const updateGroup = this.db.prepare(
      `UPDATE channel_groups SET display_name = @displayName WHERE id = @id`
    );
    const insertCandidate = this.db.prepare(
      `INSERT INTO channel_candidates (
         id, group_id, feed_id, display_name, stream_url, normalized_url, protocol
       ) VALUES (
         @id, @groupId, @feedId, @displayName, @streamUrl, @normalizedUrl, @protocol
       )
       ON CONFLICT(feed_id, normalized_url) DO UPDATE SET
         group_id = excluded.group_id,
         display_name = excluded.display_name,
         stream_url = excluded.stream_url,
         protocol = excluded.protocol`
    );
    const existingIds = new Set(
      (
        this.db
          .prepare(`SELECT id, normalized_url FROM channel_candidates WHERE feed_id = ?`)
          .all(feedId) as Array<{ id: string; normalized_url: string }>
      ).map((row) => row.normalized_url)
    );
    const currentNormalizedUrls = new Set(entries.map((entry) => entry.normalizedUrl));

    const transaction = this.db.transaction(() => {
      for (const entry of entries) {
        let groupId =
          (groupSelect.get(entry.normalizedName) as { id: string } | undefined)?.id ?? null;
        if (!groupId) {
          groupId = createId("group");
          insertGroup.run({
            id: groupId,
            displayName: entry.displayName,
            normalizedName: entry.normalizedName
          });
        } else {
          updateGroup.run({
            id: groupId,
            displayName: entry.displayName
          });
        }

        const candidateId =
          (
            this.db
              .prepare(
                `SELECT id FROM channel_candidates WHERE feed_id = ? AND normalized_url = ?`
              )
              .get(feedId, entry.normalizedUrl) as { id: string } | undefined
          )?.id ?? createId("candidate");

        insertCandidate.run({
          id: candidateId,
          groupId,
          feedId,
          displayName: entry.displayName,
          streamUrl: entry.streamUrl,
          normalizedUrl: entry.normalizedUrl,
          protocol: entry.protocol
        });

        this.db
          .prepare(
            `INSERT INTO probe_results (candidate_id)
             VALUES (?)
             ON CONFLICT(candidate_id) DO NOTHING`
          )
          .run(candidateId);
      }

      for (const normalizedUrl of existingIds) {
        if (!currentNormalizedUrls.has(normalizedUrl)) {
          this.db
            .prepare(`DELETE FROM channel_candidates WHERE feed_id = ? AND normalized_url = ?`)
            .run(feedId, normalizedUrl);
        }
      }
    });

    transaction();
    this.compactUnusedGroups();
  }

  private compactUnusedGroups(): void {
    this.db.exec(`
      DELETE FROM channel_groups
      WHERE id NOT IN (SELECT DISTINCT group_id FROM channel_candidates)
    `);
  }

  listCandidatesForQuery(search: string, limit: number): { groups: ChannelGroup[]; candidates: ChannelCandidate[] } {
    const normalizedSearch = normalizeChannelName(search);
    const groupRows = this.db
      .prepare(
        `SELECT g.id, g.display_name, g.normalized_name
         FROM channel_groups g
         WHERE (@search = '' OR g.normalized_name LIKE '%' || @search || '%')
         ORDER BY g.display_name COLLATE NOCASE ASC
         LIMIT @limit`
      )
      .all({ search: normalizedSearch, limit }) as GroupRow[];

    const groupIds = groupRows.map((row) => row.id);
    if (groupIds.length === 0) {
      return { groups: [], candidates: [] };
    }

    const placeholders = groupIds.map(() => "?").join(", ");
    const candidateRows = this.db
      .prepare(
        `SELECT
           c.id,
           c.group_id,
           c.feed_id,
           c.display_name,
           c.stream_url,
           c.normalized_url,
           c.protocol,
           c.codecs_json,
           c.resolution_width,
           c.resolution_height,
           c.has_video,
           c.has_audio,
           COALESCE(p.available, 0) AS probe_available,
           p.checked_at AS probe_checked_at,
           p.startup_latency_ms AS probe_startup_latency_ms,
           COALESCE(p.success_rate_24h, 0) AS probe_success_rate_24h,
           COALESCE(p.continuous_available_seconds, 0) AS probe_continuous_available_seconds,
           p.failure_reason AS probe_failure_reason
         FROM channel_candidates c
         LEFT JOIN probe_results p ON p.candidate_id = c.id
         WHERE c.group_id IN (${placeholders})
         ORDER BY c.display_name COLLATE NOCASE ASC`
      )
      .all(...groupIds) as CandidateRow[];

    const candidates = candidateRows.map((row) => this.mapCandidate(row));
    const groups = groupRows.map((row) =>
      this.mapGroup(row, candidates.filter((candidate) => candidate.groupId === row.id))
    );
    return { groups, candidates };
  }

  private mapCandidate(row: CandidateRow): ChannelCandidate {
    const probe: ProbeResult = {
      available: Boolean(row.probe_available),
      checkedAt: row.probe_checked_at ?? UNKNOWN_CHECKED_AT,
      startupLatencyMs: row.probe_startup_latency_ms,
      successRate24h: row.probe_success_rate_24h,
      continuousAvailableSeconds: row.probe_continuous_available_seconds,
      failureReason: row.probe_failure_reason
    };

    return {
      id: row.id,
      groupId: row.group_id,
      feedId: row.feed_id,
      streamUrl: row.stream_url,
      normalizedUrl: row.normalized_url,
      protocol: row.protocol,
      codecs: JSON.parse(row.codecs_json) as string[],
      resolution:
        row.resolution_width && row.resolution_height
          ? { width: row.resolution_width, height: row.resolution_height }
          : null,
      hasVideo: Boolean(row.has_video),
      hasAudio: Boolean(row.has_audio),
      probe
    };
  }

  private mapGroup(row: GroupRow, candidates: ChannelCandidate[]): ChannelGroup {
    const sorted = [...candidates].sort((left, right) => {
      if (left.probe.available !== right.probe.available) {
        return left.probe.available ? -1 : 1;
      }
      if (left.probe.continuousAvailableSeconds !== right.probe.continuousAvailableSeconds) {
        return right.probe.continuousAvailableSeconds - left.probe.continuousAvailableSeconds;
      }
      if (left.probe.successRate24h !== right.probe.successRate24h) {
        return right.probe.successRate24h - left.probe.successRate24h;
      }
      return (
        (left.probe.startupLatencyMs ?? Number.MAX_SAFE_INTEGER) -
        (right.probe.startupLatencyMs ?? Number.MAX_SAFE_INTEGER)
      );
    });
    const best = sorted[0];
    const hasProbeResult = Boolean(
      best && best.probe.checkedAt && best.probe.checkedAt !== UNKNOWN_CHECKED_AT
    );
    const status = !best || !hasProbeResult
      ? "unknown"
      : best.probe.available
        ? "available"
        : "unavailable";
    return {
      id: row.id,
      displayName: row.display_name,
      normalizedName: row.normalized_name,
      candidateCount: candidates.length,
      sourceCount: new Set(candidates.map((candidate) => candidate.feedId)).size,
      bestCandidateId: best?.id ?? null,
      aggregateHealth: {
        status,
        available: best?.probe.available ?? false,
        bestStartupLatencyMs: best?.probe.startupLatencyMs ?? null,
        successRate24h: best?.probe.successRate24h ?? 0,
        continuousAvailableSeconds: best?.probe.continuousAvailableSeconds ?? 0,
        lastCheckedAt: hasProbeResult ? best?.probe.checkedAt ?? null : null
      }
    };
  }

  listCandidatesByGroup(groupId: string): ChannelCandidate[] {
    const rows = this.db
      .prepare(
        `SELECT
           c.id,
           c.group_id,
           c.feed_id,
           c.display_name,
           c.stream_url,
           c.normalized_url,
           c.protocol,
           c.codecs_json,
           c.resolution_width,
           c.resolution_height,
           c.has_video,
           c.has_audio,
           COALESCE(p.available, 0) AS probe_available,
           p.checked_at AS probe_checked_at,
           p.startup_latency_ms AS probe_startup_latency_ms,
           COALESCE(p.success_rate_24h, 0) AS probe_success_rate_24h,
           COALESCE(p.continuous_available_seconds, 0) AS probe_continuous_available_seconds,
           p.failure_reason AS probe_failure_reason
         FROM channel_candidates c
         LEFT JOIN probe_results p ON p.candidate_id = c.id
         WHERE c.group_id = ?`
      )
      .all(groupId) as CandidateRow[];
    return rows.map((row) => this.mapCandidate(row));
  }

  listAllCandidates(): ChannelCandidate[] {
    const rows = this.db
      .prepare(
        `SELECT
           c.id,
           c.group_id,
           c.feed_id,
           c.display_name,
           c.stream_url,
           c.normalized_url,
           c.protocol,
           c.codecs_json,
           c.resolution_width,
           c.resolution_height,
           c.has_video,
           c.has_audio,
           COALESCE(p.available, 0) AS probe_available,
           p.checked_at AS probe_checked_at,
           p.startup_latency_ms AS probe_startup_latency_ms,
           COALESCE(p.success_rate_24h, 0) AS probe_success_rate_24h,
           COALESCE(p.continuous_available_seconds, 0) AS probe_continuous_available_seconds,
           p.failure_reason AS probe_failure_reason
         FROM channel_candidates c
         LEFT JOIN probe_results p ON p.candidate_id = c.id`
      )
      .all() as CandidateRow[];
    return rows.map((row) => this.mapCandidate(row));
  }

  getCandidate(candidateId: string): ChannelCandidate | null {
    const row = this.db
      .prepare(
        `SELECT
           c.id,
           c.group_id,
           c.feed_id,
           c.display_name,
           c.stream_url,
           c.normalized_url,
           c.protocol,
           c.codecs_json,
           c.resolution_width,
           c.resolution_height,
           c.has_video,
           c.has_audio,
           COALESCE(p.available, 0) AS probe_available,
           p.checked_at AS probe_checked_at,
           p.startup_latency_ms AS probe_startup_latency_ms,
           COALESCE(p.success_rate_24h, 0) AS probe_success_rate_24h,
           COALESCE(p.continuous_available_seconds, 0) AS probe_continuous_available_seconds,
           p.failure_reason AS probe_failure_reason
         FROM channel_candidates c
         LEFT JOIN probe_results p ON p.candidate_id = c.id
         WHERE c.id = ?`
      )
      .get(candidateId) as CandidateRow | undefined;
    return row ? this.mapCandidate(row) : null;
  }

  updateCandidateMedia(candidateId: string, media: {
    codecs: string[];
    width: number | null;
    height: number | null;
    hasVideo: boolean;
    hasAudio: boolean;
  }): void {
    this.db
      .prepare(
        `UPDATE channel_candidates
         SET codecs_json = @codecsJson,
             resolution_width = @width,
             resolution_height = @height,
             has_video = @hasVideo,
             has_audio = @hasAudio
         WHERE id = @candidateId`
      )
      .run({
        candidateId,
        codecsJson: JSON.stringify(media.codecs),
        width: media.width,
        height: media.height,
        hasVideo: media.hasVideo ? 1 : 0,
        hasAudio: media.hasAudio ? 1 : 0
      });
  }

  updateProbe(candidateId: string, probe: ProbeResult): void {
    this.db
      .prepare(
        `INSERT INTO probe_results (
           candidate_id, available, checked_at, startup_latency_ms, success_rate_24h,
           continuous_available_seconds, failure_reason
         ) VALUES (
           @candidateId, @available, @checkedAt, @startupLatencyMs, @successRate24h,
           @continuousAvailableSeconds, @failureReason
         )
         ON CONFLICT(candidate_id) DO UPDATE SET
           available = excluded.available,
           checked_at = excluded.checked_at,
           startup_latency_ms = excluded.startup_latency_ms,
           success_rate_24h = excluded.success_rate_24h,
           continuous_available_seconds = excluded.continuous_available_seconds,
           failure_reason = excluded.failure_reason`
      )
      .run({
        candidateId,
        available: probe.available ? 1 : 0,
        checkedAt: probe.checkedAt,
        startupLatencyMs: probe.startupLatencyMs,
        successRate24h: probe.successRate24h,
        continuousAvailableSeconds: probe.continuousAvailableSeconds,
        failureReason: probe.failureReason
      });
  }

  getSettings(): AppSettings {
    const row = this.db
      .prepare(`SELECT value_json FROM app_settings WHERE key = 'settings'`)
      .get() as { value_json: string };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value_json) as Partial<AppSettings>) };
  }

  saveSettings(partial: Partial<AppSettings>): AppSettings {
    const merged = { ...this.getSettings(), ...partial };
    this.db
      .prepare(`UPDATE app_settings SET value_json = @json WHERE key = 'settings'`)
      .run({ json: JSON.stringify(merged) });
    return merged;
  }

  getOutputSession(): OutputSession {
    const row = this.db
      .prepare(`SELECT value_json FROM app_runtime WHERE key = 'output_session'`)
      .get() as { value_json: string };
    return {
      ...DEFAULT_OUTPUT_SESSION,
      ...(JSON.parse(row.value_json) as Partial<OutputSession>)
    };
  }

  saveOutputSession(session: OutputSession): OutputSession {
    this.db
      .prepare(`UPDATE app_runtime SET value_json = @json WHERE key = 'output_session'`)
      .run({ json: JSON.stringify(session) });
    return session;
  }
}
