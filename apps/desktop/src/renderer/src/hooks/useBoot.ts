import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";

export function useBoot(): void {
  const setState = useAppStore((state) => state.setState);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      setState({ loading: true });
      const [feeds, channelResult, settings, session, playbackUrls, logs] = await Promise.all([
        window.m3uMixer.feeds.list(),
        window.m3uMixer.channels.query({ search: "", limit: 200 }),
        window.m3uMixer.settings.get(),
        window.m3uMixer.session.output.current(),
        window.m3uMixer.session.output.urls(),
        window.m3uMixer.diagnostics.tail(100)
      ]);

      if (cancelled) {
        return;
      }

      setState({
        feeds,
        groups: channelResult.groups,
        candidates: channelResult.candidates,
        settings,
        session,
        playbackUrls,
        logs,
        selectedVideoGroupId: session.videoGroupId,
        selectedAudioGroupId: session.audioGroupId,
        videoDelayMs: session.videoDelayMs,
        loading: false
      });
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [setState]);
}
