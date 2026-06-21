import { create } from "zustand";
import type { AppSettings, ChannelCandidate, ChannelGroup, DiagnosticsEntry, M3uFeed, OutputSession } from "@m3u-mixer/shared";

type PreviewState = {
  videoUrl: string | null;
  audioUrl: string | null;
  mergedUrl: string | null;
  audioNote: string | null;
};

type AppState = {
  feeds: M3uFeed[];
  groups: ChannelGroup[];
  candidates: ChannelCandidate[];
  settings: AppSettings | null;
  session: OutputSession | null;
  playbackUrls: string[];
  logs: DiagnosticsEntry[];
  search: string;
  selectedVideoGroupId: string | null;
  selectedAudioGroupId: string | null;
  videoDelayMs: number;
  preview: PreviewState;
  loading: boolean;
  setState: (partial: Partial<AppState>) => void;
};

export const useAppStore = create<AppState>((set) => ({
  feeds: [],
  groups: [],
  candidates: [],
  settings: null,
  session: null,
  playbackUrls: [],
  logs: [],
  search: "",
  selectedVideoGroupId: null,
  selectedAudioGroupId: null,
  videoDelayMs: 0,
  preview: {
    videoUrl: null,
    audioUrl: null,
    mergedUrl: null,
    audioNote: null
  },
  loading: true,
  setState: (partial) => set(partial)
}));
