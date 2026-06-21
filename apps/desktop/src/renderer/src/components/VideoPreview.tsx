import { useEffect, useRef } from "react";
import Hls from "hls.js";

type VideoPreviewProps = {
  title: string;
  url: string | null;
  note?: string | null;
};

export function VideoPreview({ title, url, note }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !url) {
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(element);
      return () => hls.destroy();
    }

    element.src = url;
    return () => {
      element.removeAttribute("src");
    };
  }, [url]);

  return (
    <div className="preview-card">
      <div className="preview-title">{title}</div>
      {note ? (
        <div className="preview-empty">{note}</div>
      ) : (
        <video ref={videoRef} className="preview-video" controls muted playsInline />
      )}
      {!note && <div className="preview-url">{url ?? "未启动预览"}</div>}
    </div>
  );
}
