import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  ChannelProbeInput,
  ChannelQueryInput,
  ChannelQueryResult,
  DiagnosticsEntry,
  FeedSaveInput,
  M3uFeed,
  OutputSession,
  OutputStartInput,
  OutputUpdateInput,
  PreviewKind,
  PreviewStartInput
} from "@m3u-mixer/shared";

export const api = {
  feeds: {
    list: () => ipcRenderer.invoke("feeds.list") as Promise<M3uFeed[]>,
    save: (payload: FeedSaveInput) => ipcRenderer.invoke("feeds.save", payload) as Promise<M3uFeed>,
    remove: (payload: string) => ipcRenderer.invoke("feeds.remove", payload) as Promise<void>,
    refresh: (payload?: string[]) => ipcRenderer.invoke("feeds.refresh", payload) as Promise<void>
  },
  channels: {
    query: (payload: ChannelQueryInput) =>
      ipcRenderer.invoke("channels.query", payload) as Promise<ChannelQueryResult>,
    probe: (payload: ChannelProbeInput) =>
      ipcRenderer.invoke("channels.probe", payload) as Promise<void>
  },
  session: {
    preview: {
      start: (payload: PreviewStartInput) =>
        ipcRenderer.invoke("session.preview.start", payload) as Promise<{ url: string | null; note: string | null }>,
      stop: (payload: PreviewKind) => ipcRenderer.invoke("session.preview.stop", payload) as Promise<void>
    },
    output: {
      start: (payload: OutputStartInput) =>
        ipcRenderer.invoke("session.output.start", payload) as Promise<OutputSession>,
      stop: () => ipcRenderer.invoke("session.output.stop") as Promise<OutputSession>,
      update: (payload: OutputUpdateInput) =>
        ipcRenderer.invoke("session.output.update", payload) as Promise<OutputSession>,
      current: () => ipcRenderer.invoke("session.output.current") as Promise<OutputSession>,
      urls: () => ipcRenderer.invoke("session.output.urls") as Promise<string[]>
    }
  },
  settings: {
    get: () => ipcRenderer.invoke("settings.get") as Promise<AppSettings>,
    set: (payload: Partial<AppSettings>) => ipcRenderer.invoke("settings.set", payload) as Promise<AppSettings>
  },
  diagnostics: {
    tail: (limit = 200) => ipcRenderer.invoke("diagnostics.logs.tail", limit) as Promise<DiagnosticsEntry[]>
  }
};

contextBridge.exposeInMainWorld("m3uMixer", api);
