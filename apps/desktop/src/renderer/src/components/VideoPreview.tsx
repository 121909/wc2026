import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type VideoPreviewProps = {
  title: string;
  url: string | null;
  note?: string | null;
  error?: string | null;
  isLoading?: boolean;
};

export function VideoPreview({ title, url, note, error, isLoading = false }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    setPlaybackError(null);

    if (!element) {
      return;
    }

    element.pause();
    element.removeAttribute("src");
    element.load();

    if (!url) {
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void element.play().catch(() => {
          // controls remain available even if autoplay is blocked
        });
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setPlaybackError(data.details || "HLS 预览加载失败");
          hls.destroy();
        }
      });
      hls.loadSource(url);
      hls.attachMedia(element);
      return () => hls.destroy();
    }

    element.src = url;
    void element.play().catch(() => {
      // controls remain available even if autoplay is blocked
    });
    return () => {
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [url]);

  const message = error ?? playbackError ?? note;

  return (
    <div className="preview-card">
      <div className="preview-title">{title}</div>
      {message ? (
        <div className="preview-empty">{message}</div>
      ) : (
        <div className="preview-media-shell">
          <video ref={videoRef} className="preview-video" controls muted playsInline />
          {isLoading && <div className="preview-overlay">正在启动预览…</div>}
        </div>
      )}
      {!message && <div className="preview-url">{url ?? "未启动预览"}</div>}
    </div>
  );
}
