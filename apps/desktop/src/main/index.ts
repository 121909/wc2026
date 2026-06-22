import { app, BrowserWindow } from "electron";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import path from "node:path";
import fs from "node:fs";
import log from "electron-log/main";
import { M3uMixerService } from "@m3u-mixer/service";
import { registerIpcHandlers } from "./ipc";

let mainWindow: BrowserWindow | null = null;
let service: M3uMixerService | null = null;

function resolvePreloadPath(): string {
  const candidates = [
    path.join(__dirname, "../preload/index.js"),
    path.join(__dirname, "../preload/index.mjs")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? path.join(__dirname, "../preload/index.js");
}

async function createWindow(): Promise<void> {
  const preloadPath = resolvePreloadPath();
  log.info("Creating browser window", {
    preloadPath,
    packaged: app.isPackaged
  });

  mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1280,
    minHeight: 820,
    autoHideMenuBar: true,
    backgroundColor: "#132329",
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("ready-to-show", () => {
    log.info("Main window ready to show");
    mainWindow?.show();
  });

  mainWindow.on("unresponsive", () => {
    log.error("Main window became unresponsive");
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log.error("Renderer process gone", details);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    log.error("Window failed to load", {
      errorCode,
      errorDescription,
      validatedUrl
    });
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    await mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  log.initialize();
  log.transports.file.level = "info";
  log.info("App starting");
  electronApp.setAppUserModelId("com.m3umixer.desktop");
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  try {
    service = new M3uMixerService({
      appDataDir: path.join(app.getPath("userData"), "runtime-data")
    });
    await service.init();
    registerIpcHandlers(service);
    await createWindow();
  } catch (error) {
    log.error("App bootstrap failed", error);
    throw error;
  }

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

process.on("uncaughtException", (error) => {
  log.error("Uncaught exception", error);
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection", reason);
});
