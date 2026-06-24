import { useEffect, useMemo, useState } from "react";
import type { FeedSaveInput } from "@m3u-mixer/shared";
import { Section } from "./components/Section";
import { VideoPreview } from "./components/VideoPreview";
import { ChannelTable } from "./components/ChannelTable";
import { useAppStore } from "./store/useAppStore";
import { useBoot } from "./hooks/useBoot";

function findBestCandidateId(
  groupId: string | null,
  candidates: ReturnType<typeof useAppStore.getState>["candidates"]
) {
  if (!groupId) {
    return null;
  }
  const groupCandidates = candidates.filter((candidate) => candidate.groupId === groupId);
  return groupCandidates.find((candidate) => candidate.probe.available)?.id ?? groupCandidates[0]?.id ?? null;
}

function ensureUrlUsesLoopback(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "0.0.0.0") {
      parsed.hostname = "127.0.0.1";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function App() {
  useBoot();
  const {
    feeds,
    groups,
    candidates,
    settings,
    session,
    playbackUrls,
    logs,
    search,
    selectedVideoGroupId,
    selectedAudioGroupId,
    videoDelayMs,
    preview,
    loading,
    setState
  } = useAppStore();

  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedInputKind, setFeedInputKind] = useState<FeedSaveInput["inputKind"]>("m3u");
  const [portDraft, setPortDraft] = useState("18999");
  const [bindHostDraft, setBindHostDraft] = useState("0.0.0.0");

  const mergePreview = (
    updater: (current: typeof preview) => typeof preview
  ) => {
    setState({
      preview: updater(useAppStore.getState().preview)
    });
  };

  useEffect(() => {
    if (settings) {
      setPortDraft(String(settings.publicPort));
      setBindHostDraft(settings.publicBindHost);
    }
  }, [settings]);

  const filteredGroups = useMemo(() => {
    if (!search) {
      return groups;
    }
    const normalized = search.normalize("NFKC").trim().toLowerCase();
    return groups.filter((group) => group.normalizedName.includes(normalized));
  }, [groups, search]);

  const refreshChannels = async (nextSearch = search) => {
    const result = await window.m3uMixer.channels.query({ search: nextSearch, limit: 200 });
    const latestSession = await window.m3uMixer.session.output.current();
    const latestUrls = await window.m3uMixer.session.output.urls();
    const latestLogs = await window.m3uMixer.diagnostics.tail(100);
    setState({
      groups: result.groups,
      candidates: result.candidates,
      session: latestSession,
      playbackUrls: latestUrls.map((url) => ensureUrlUsesLoopback(url) ?? url),
      logs: latestLogs,
      selectedVideoGroupId: latestSession.videoGroupId,
      selectedAudioGroupId: latestSession.audioGroupId,
      videoDelayMs: latestSession.videoDelayMs
    });
  };

  const refreshLogs = async () => {
    const latestLogs = await window.m3uMixer.diagnostics.tail(100);
    setState({ logs: latestLogs });
  };

  const startPreview = async (kind: "video" | "audio" | "merged") => {
    const videoCandidateId = findBestCandidateId(selectedVideoGroupId, candidates);
    const audioCandidateId = findBestCandidateId(selectedAudioGroupId, candidates);
    if (kind === "video") {
      mergePreview((current) => ({
        ...current,
        activeKind: kind,
        videoError: null,
        videoUrl: null
      }));
    }
    if (kind === "audio") {
      mergePreview((current) => ({
        ...current,
        activeKind: kind,
        audioError: null,
        audioUrl: null,
        audioNote: null
      }));
    }
    if (kind === "merged") {
      mergePreview((current) => ({
        ...current,
        activeKind: kind,
        mergedError: null,
        mergedUrl: null
      }));
    }

    try {
      const result = await window.m3uMixer.session.preview.start({
        kind,
        videoCandidateId,
        audioCandidateId,
        videoDelayMs
      });
      if (kind === "video") {
        mergePreview((current) => ({
          ...current,
          videoUrl: ensureUrlUsesLoopback(result.url),
          videoError: result.url ? null : result.note ?? "无法启动视频预览",
          activeKind: null
        }));
      }
      if (kind === "audio") {
        mergePreview((current) => ({
          ...current,
          audioUrl: ensureUrlUsesLoopback(result.url),
          audioNote: result.note,
          audioError: result.url || result.note ? null : "无法启动音频预览",
          activeKind: null
        }));
      }
      if (kind === "merged") {
        mergePreview((current) => ({
          ...current,
          mergedUrl: ensureUrlUsesLoopback(result.url),
          mergedError: result.url ? null : result.note ?? "无法启动合流预览",
          activeKind: null
        }));
      }
      await refreshLogs();
    } catch (error) {
      const message = error instanceof Error ? error.message : "预览启动失败";
      if (kind === "video") {
        mergePreview((current) => ({
          ...current,
          videoUrl: null,
          videoError: message,
          activeKind: null
        }));
      }
      if (kind === "audio") {
        mergePreview((current) => ({
          ...current,
          audioUrl: null,
          audioNote: null,
          audioError: message,
          activeKind: null
        }));
      }
      if (kind === "merged") {
        mergePreview((current) => ({
          ...current,
          mergedUrl: null,
          mergedError: message,
          activeKind: null
        }));
      }
      await refreshLogs();
    }
  };

  const saveFeed = async () => {
    if (!feedName || !feedUrl) {
      return;
    }
    await window.m3uMixer.feeds.save({
      name: feedName,
      url: feedUrl,
      inputKind: feedInputKind,
      refreshMinutes: settings?.refreshMinutes ?? 15
    });
    const nextFeeds = await window.m3uMixer.feeds.list();
    setState({ feeds: nextFeeds });
    setFeedName("");
    setFeedUrl("");
    setFeedInputKind("m3u");
    await refreshChannels("");
  };

  const saveSettings = async () => {
    const next = await window.m3uMixer.settings.set({
      publicBindHost: bindHostDraft,
      publicPort: Number(portDraft)
    });
    setState({ settings: next });
    const latestUrls = await window.m3uMixer.session.output.urls();
    setState({ playbackUrls: latestUrls.map((url) => ensureUrlUsesLoopback(url) ?? url) });
  };

  const startOutput = async () => {
    if (!selectedVideoGroupId || !selectedAudioGroupId) {
      return;
    }
    const next = await window.m3uMixer.session.output.start({
      videoGroupId: selectedVideoGroupId,
      audioGroupId: selectedAudioGroupId,
      videoDelayMs
    });
    const latestUrls = await window.m3uMixer.session.output.urls();
    setState({
      session: next,
      playbackUrls: latestUrls.map((url) => ensureUrlUsesLoopback(url) ?? url)
    });
    await startPreview("merged");
  };

  const stopOutput = async () => {
    const next = await window.m3uMixer.session.output.stop();
    setState({
      session: next,
      playbackUrls: [],
      preview: {
        ...useAppStore.getState().preview,
        mergedUrl: null,
        mergedError: null
      }
    });
  };

  if (loading) {
    return <div className="loading-shell">Loading M3U Mixer...</div>;
  }

  return (
    <main className="app-shell">
      <aside className="left-column">
        <Section title="添加源">
          <div className="stack">
            <label className="field">
              <span>名称</span>
              <input
                value={feedName}
                onChange={(event) => setFeedName(event.target.value)}
                placeholder="例如：主订阅"
              />
            </label>
            <label className="field">
              <span>输入类型</span>
              <div className="toggle-row">
                <button
                  className={feedInputKind === "m3u" ? "role-button active" : "role-button"}
                  onClick={() => setFeedInputKind("m3u")}
                  type="button"
                >
                  M3U 订阅
                </button>
                <button
                  className={feedInputKind === "m3u8-direct" ? "role-button active" : "role-button"}
                  onClick={() => setFeedInputKind("m3u8-direct")}
                  type="button"
                >
                  单条 M3U8
                </button>
              </div>
            </label>
            <label className="field">
              <span>{feedInputKind === "m3u8-direct" ? "M3U8 地址" : "M3U 链接"}</span>
              <input
                value={feedUrl}
                onChange={(event) => setFeedUrl(event.target.value)}
                placeholder={
                  feedInputKind === "m3u8-direct"
                    ? "https://example.com/live/index.m3u8"
                    : "https://example.com/list.m3u"
                }
              />
            </label>
            <button className="primary-button" onClick={() => void saveFeed()}>
              添加并刷新
            </button>
          </div>
        </Section>

        <Section
          title={`已添加源 (${feeds.length})`}
          action={
            feeds.length > 0 ? (
              <button
                className="secondary-button"
                onClick={() => void window.m3uMixer.feeds.refresh().then(() => refreshChannels())}
              >
                全部刷新
              </button>
            ) : null
          }
        >
          <div className="feed-list">
            {feeds.length === 0 ? (
              <div className="empty-card">还没有添加任何 M3U 源。</div>
            ) : (
              feeds.map((feed) => (
                <div key={feed.id} className="feed-card">
                  <div>
                    <strong>{feed.name}</strong>
                    <div className="feed-card-topline">
                      <div className="feed-kind">
                        {feed.inputKind === "m3u8-direct" ? "单条 M3U8" : "M3U 订阅"}
                      </div>
                      <div className={`feed-state ${feed.stale ? "stale" : "fresh"}`}>
                        {feed.stale ? "刷新异常" : "正常"}
                      </div>
                    </div>
                    <div className="feed-meta">{feed.url}</div>
                    <div className="feed-submeta">
                      最近刷新：
                      {feed.lastRefreshAt
                        ? new Date(feed.lastRefreshAt).toLocaleString()
                        : "尚未刷新"}
                    </div>
                  </div>
                  <div className="feed-actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void window.m3uMixer.feeds.refresh([feed.id]).then(() => refreshChannels())
                      }
                    >
                      刷新
                    </button>
                    <button
                      className="danger-button"
                      onClick={() =>
                        void window.m3uMixer.feeds.remove(feed.id).then(async () => {
                          setState({ feeds: await window.m3uMixer.feeds.list() });
                          await refreshChannels();
                        })
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Section>

        <Section title="输出绑定">
          <div className="stack">
            <label className="field">
              <span>监听地址</span>
              <input value={bindHostDraft} onChange={(event) => setBindHostDraft(event.target.value)} />
            </label>
            <label className="field">
              <span>端口</span>
              <input value={portDraft} onChange={(event) => setPortDraft(event.target.value)} />
            </label>
            <button className="secondary-button" onClick={() => void saveSettings()}>
              保存绑定设置
            </button>
          </div>
          <div className="hint-block">
            局域网访问未鉴权。请仅在可信网络中使用，并优先绑定到明确网卡或内网环境。
          </div>
        </Section>

        <Section title="诊断日志">
          <div className="log-list">
            {logs.map((entry, index) => (
              <div key={`${entry.timestamp}-${index}`} className={`log-entry ${entry.level}`}>
                <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span>{entry.message}</span>
              </div>
            ))}
          </div>
        </Section>
      </aside>

      <section className="center-column">
        <Section
          title="频道列表"
          action={
            <div className="section-tools">
              <input
                value={search}
                onChange={(event) => {
                  const nextSearch = event.target.value;
                  setState({ search: nextSearch });
                  void refreshChannels(nextSearch);
                }}
                placeholder="按名称过滤频道"
              />
              <button
                className="secondary-button"
                onClick={() =>
                  void window.m3uMixer.channels
                    .probe({
                      mode: "visible",
                      visibleGroupIds: filteredGroups.map((group) => group.id),
                      groupIds: []
                    })
                    .then(() => refreshChannels())
                }
              >
                Test Visible
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  void window.m3uMixer.channels
                    .probe({ mode: "selected", visibleGroupIds: [], groupIds: [] })
                    .then(() => refreshChannels())
                }
              >
                Test Selected
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  void window.m3uMixer.channels
                    .probe({ mode: "all", visibleGroupIds: [], groupIds: [] })
                    .then(() => refreshChannels())
                }
              >
                Test All
              </button>
            </div>
          }
        >
          <ChannelTable
            groups={filteredGroups}
            selectedVideoGroupId={selectedVideoGroupId}
            selectedAudioGroupId={selectedAudioGroupId}
            onPickVideo={(groupId) => setState({ selectedVideoGroupId: groupId })}
            onPickAudio={(groupId) => setState({ selectedAudioGroupId: groupId })}
          />
        </Section>
      </section>

      <aside className="right-column">
        <Section title="角色与延迟">
          <div className="selection-grid">
            <div className="selection-card">
              <span>视频组</span>
              <strong>{groups.find((group) => group.id === selectedVideoGroupId)?.displayName ?? "未选择"}</strong>
              <button className="secondary-button" onClick={() => void startPreview("video")}>
                预览视频源
              </button>
            </div>
            <div className="selection-card">
              <span>音频组</span>
              <strong>{groups.find((group) => group.id === selectedAudioGroupId)?.displayName ?? "未选择"}</strong>
              <button className="secondary-button" onClick={() => void startPreview("audio")}>
                预览音频源
              </button>
            </div>
          </div>
          <label className="field">
            <span>视频延迟 {videoDelayMs} ms</span>
            <input
              type="range"
              min={0}
              max={30000}
              step={100}
              value={videoDelayMs}
              onChange={(event) => setState({ videoDelayMs: Number(event.target.value) })}
            />
          </label>
          <div className="button-row">
            <button className="primary-button" onClick={() => void startOutput()}>
              启动输出
            </button>
            <button className="secondary-button" onClick={() => void startPreview("merged")}>
              预览合流
            </button>
            <button className="danger-button" onClick={() => void stopOutput()}>
              停止输出
            </button>
          </div>
          {session?.state === "running" ? (
            <div className="status-pill success">运行中 · {session.profile}</div>
          ) : (
            <div className={`status-pill ${session?.state === "error" ? "error" : "idle"}`}>
              {session?.state ?? "idle"} {session?.error ? `· ${session.error}` : ""}
            </div>
          )}
        </Section>

        <Section title="预览">
          <div className="preview-stack">
            <VideoPreview
              title="视频源预览"
              url={preview.videoUrl}
              error={preview.videoError}
              isLoading={preview.activeKind === "video"}
            />
            <VideoPreview
              title="音频源预览"
              url={preview.audioUrl}
              note={preview.audioNote}
              error={preview.audioError}
              isLoading={preview.activeKind === "audio"}
            />
            <VideoPreview
              title="合流预览"
              url={preview.mergedUrl}
              error={preview.mergedError}
              isLoading={preview.activeKind === "merged"}
            />
          </div>
        </Section>

        <Section title="输出地址">
          <div className="url-list">
            {session?.publicUrl && <div className="url-card">当前任务地址：{session.publicUrl}</div>}
            {playbackUrls.map((url) => (
              <div key={url} className="url-card">
                {url}
              </div>
            ))}
          </div>
        </Section>
      </aside>
    </main>
  );
}
