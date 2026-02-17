import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { app, BrowserWindow, ipcMain, type WebContents } from "electron/main";
import { shell } from "electron/common";
import {
  DownloadOrchestrator,
  runPreflight
} from "@audio-ripper/core";
import type {
  ChooseMetadataInput,
  CreateJobInput,
  JobEvent,
  ResolveCandidatesInput,
  Settings
} from "@audio-ripper/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const platformArch = `${process.platform}-${process.arch}`;

function binaryName(base: "ffmpeg" | "ffprobe" | "yt-dlp"): string {
  if (process.platform === "win32") {
    return base === "yt-dlp" ? "yt-dlp.exe" : `${base}.exe`;
  }
  return base;
}

function configureBundledBinaries(): void {
  const packagedBinRoot = path.join(process.resourcesPath, "bin", platformArch);
  const devBinRoot = path.join(__dirname, "..", "vendor", "bin", platformArch);
  const binRoot = app.isPackaged ? packagedBinRoot : devBinRoot;

  const ffmpegPath = path.join(binRoot, binaryName("ffmpeg"));
  const ffprobePath = path.join(binRoot, binaryName("ffprobe"));
  const ytdlpPath = path.join(binRoot, binaryName("yt-dlp"));

  if (existsSync(ffmpegPath)) {
    process.env.YAR_FFMPEG_PATH = ffmpegPath;
  }
  if (existsSync(ffprobePath)) {
    process.env.YAR_FFPROBE_PATH = ffprobePath;
  }
  if (existsSync(ytdlpPath)) {
    process.env.YAR_YTDLP_PATH = ytdlpPath;
  }
}

configureBundledBinaries();

let mainWindow: BrowserWindow | null = null;
const subscriptions = new Map<number, (event: JobEvent) => void>();

const orchestrator = new DownloadOrchestrator({
  appDataDir: app.getPath("userData")
});

interface RevealInFinderResult {
  ok: boolean;
  message?: string;
}

function getRendererEntryPath(): string {
  return path.join(__dirname, "..", "dist-renderer", "index.html");
}

async function revealInFinder(targetPath: string): Promise<RevealInFinderResult> {
  const normalized = targetPath?.trim();
  if (!normalized) {
    return {
      ok: false,
      message: "No output file is available for this job yet."
    };
  }

  try {
    await stat(normalized);
    shell.showItemInFolder(normalized);
    return { ok: true };
  } catch {
    const parentDir = path.dirname(normalized);

    try {
      await stat(parentDir);
      const error = await shell.openPath(parentDir);
      if (error) {
        return {
          ok: false,
          message: "Could not open Finder for the output location."
        };
      }

      return {
        ok: false,
        message: "Output file was not found. Opened the target folder instead."
      };
    } catch {
      return {
        ok: false,
        message: "Output path no longer exists. The file may have been moved or deleted."
      };
    }
  }
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("Renderer failed to load", {
      errorCode,
      errorDescription,
      validatedURL
    });
  });

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("Preload failed", {
      preloadPath,
      error: error?.message ?? String(error)
    });
  });

  mainWindow.webContents.on("did-finish-load", async () => {
    try {
      const bridgeType = await mainWindow?.webContents.executeJavaScript("typeof window.audioRipper", true);
      console.log("Renderer bridge type:", bridgeType);
    } catch (error) {
      console.error("Bridge probe failed", error);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(getRendererEntryPath());
  }
}

function bindIpc(): void {
  ipcMain.handle("system:preflight", async () => {
    return runPreflight();
  });

  ipcMain.handle("system:showInFinder", async (_event, targetPath: string) => {
    return revealInFinder(targetPath);
  });

  ipcMain.handle("job:create", async (_event, payload: CreateJobInput) => {
    return orchestrator.createJob(payload);
  });

  ipcMain.handle("job:list", async () => {
    return orchestrator.listJobs();
  });

  ipcMain.handle("job:cancel", async (_event, jobId: string) => {
    return orchestrator.cancelJob(jobId);
  });

  ipcMain.handle("job:delete", async (_event, jobId: string) => {
    await orchestrator.deleteJob(jobId);
    return orchestrator.listJobs();
  });

  ipcMain.handle("job:clearHistory", async () => {
    await orchestrator.clearHistory();
    return orchestrator.listJobs();
  });

  ipcMain.handle("metadata:resolveCandidates", async (_event, payload: ResolveCandidatesInput) => {
    return orchestrator.resolveMetadataCandidates(payload);
  });

  ipcMain.handle("metadata:chooseCandidate", async (_event, payload: ChooseMetadataInput) => {
    return orchestrator.chooseMetadata(payload);
  });

  ipcMain.handle("settings:get", async () => {
    return orchestrator.getSettings();
  });

  ipcMain.handle("settings:update", async (_event, payload: Settings) => {
    await orchestrator.updateSettings(payload);
    return orchestrator.getSettings();
  });

  ipcMain.handle("window:toggleMaximize", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return false;
    }

    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }

    return win.isMaximized();
  });

  ipcMain.handle("job:subscribeStatus", async (event) => {
    const sender = event.sender;
    const key = sender.id;

    if (subscriptions.has(key)) {
      return true;
    }

    const handler = (jobEvent: JobEvent): void => {
      if (!sender.isDestroyed()) {
        sender.send("job:event", jobEvent);
      }
    };

    subscriptions.set(key, handler);
    orchestrator.on("event", handler);

    sender.once("destroyed", () => {
      const existing = subscriptions.get(key);
      if (existing) {
        orchestrator.off("event", existing);
        subscriptions.delete(key);
      }
    });

    return true;
  });

  ipcMain.handle("job:unsubscribeStatus", async (event) => {
    const sender: WebContents = event.sender;
    const key = sender.id;
    const handler = subscriptions.get(key);
    if (handler) {
      orchestrator.off("event", handler);
      subscriptions.delete(key);
    }
    return true;
  });
}

app.whenReady().then(async () => {
  await orchestrator.initialize();
  bindIpc();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
