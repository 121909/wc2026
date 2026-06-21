import { app, BrowserWindow } from "electron";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import path from "node:path";
import { M3uMixerService } from "@m3u-mixer/service";
import { registerIpcHandlers } from "./ipc";

let mainWindow: BrowserWindow | null = null;
let service: M3uMixerService | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1280,
    minHeight: 820,
    autoHideMenuBar: true,
    backgroundColor: "#132329",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    await mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.m3umixer.desktop");
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  service = new M3uMixerService({
    appDataDir: path.join(app.getPath("userData"), "runtime-data")
  });
  await service.init();
  registerIpcHandlers(service);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  if (service) {
    await service.dispose();
  }
});
