import { ipcMain } from "electron";
import {
  AppSettingsSchema,
  ChannelProbeInputSchema,
  ChannelQueryInputSchema,
  FeedSaveInputSchema,
  OutputStartInputSchema,
  OutputUpdateInputSchema,
  PreviewKindSchema,
  PreviewStartInputSchema
} from "@m3u-mixer/shared";
import type { M3uMixerService } from "@m3u-mixer/service";

export function registerIpcHandlers(service: M3uMixerService): void {
  ipcMain.handle("feeds.list", async () => service.listFeeds());
  ipcMain.handle("feeds.save", async (_event, payload) =>
    service.saveFeed(FeedSaveInputSchema.parse(payload))
  );
  ipcMain.handle("feeds.remove", async (_event, payload: string) => service.removeFeed(payload));
  ipcMain.handle("feeds.refresh", async (_event, payload?: string[]) => service.refreshFeeds(payload));
  ipcMain.handle("channels.query", async (_event, payload) =>
    service.queryChannels(ChannelQueryInputSchema.parse(payload))
  );
  ipcMain.handle("channels.probe", async (_event, payload) =>
    service.probeChannels(ChannelProbeInputSchema.parse(payload))
  );
  ipcMain.handle("session.preview.start", async (_event, payload) =>
    service.startPreview(PreviewStartInputSchema.parse(payload))
  );
  ipcMain.handle("session.preview.stop", async (_event, payload) =>
    service.stopPreview(PreviewKindSchema.parse(payload))
  );
  ipcMain.handle("session.output.start", async (_event, payload) =>
    service.startOutput(OutputStartInputSchema.parse(payload))
  );
  ipcMain.handle("session.output.stop", async () => service.stopOutput());
  ipcMain.handle("session.output.update", async (_event, payload) =>
    service.updateOutput(OutputUpdateInputSchema.parse(payload))
  );
  ipcMain.handle("settings.get", async () => service.getSettings());
  ipcMain.handle("settings.set", async (_event, payload) =>
    service.setSettings(AppSettingsSchema.partial().parse(payload))
  );
  ipcMain.handle("diagnostics.logs.tail", async (_event, payload: number | undefined) =>
    service.tailLogs(typeof payload === "number" ? payload : 200)
  );
  ipcMain.handle("session.output.current", async () => service.getCurrentOutputSession());
  ipcMain.handle("session.output.urls", async () => service.getLanPlaybackUrls());
}
