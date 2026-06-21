import type { ChannelCandidate, FfmpegProfile } from "@m3u-mixer/shared";

function includesCodec(codecs: string[], predicate: (codec: string) => boolean): boolean {
  return codecs.some(predicate);
}

function isVideoH264(candidate: ChannelCandidate): boolean {
  return includesCodec(candidate.codecs, (codec) => codec.toLowerCase().includes("h264"));
}

function isAudioTargetReady(candidate: ChannelCandidate): boolean {
  return includesCodec(candidate.codecs, (codec) => {
    const normalized = codec.toLowerCase();
    return normalized.includes("aac") || normalized.includes("mp3");
  });
}

export function chooseFfmpegProfile(
  videoCandidate: ChannelCandidate,
  audioCandidate: ChannelCandidate,
  timestampStable: boolean
): FfmpegProfile {
  const videoH264 = isVideoH264(videoCandidate);
  const audioReady = isAudioTargetReady(audioCandidate);

  if (videoH264 && audioReady && timestampStable) {
    return "copy-av";
  }
  if (videoH264) {
    return "copy-v-aac";
  }
  if (audioReady) {
    return "h264-copy-a";
  }
  return "h264-aac";
}
