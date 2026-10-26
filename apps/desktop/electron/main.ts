import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  type BrowserWindowConstructorOptions,
  type MenuItemConstructorOptions,
  type WebContents
} from "electron/main";
import { shell } from "electron/common";
import {
  checkForYtDlpUpdate,
  compareYtDlpVersions,
  DownloadOrchestrator,
  readInstalledYtDlp,
  ytDlpAssetName
} from "@audio-ripper/core";
import type {
  ApplyTrimInput,
  ChooseMetadataInput,
  CreateJobInput,
  JobEvent,
  ResolveCandidatesInput,
  Settings,
  ThemePreference,
  ToolUpdateStatus
} from "@audio-ripper/shared";

// The app is called Liner, but its data folder keeps the original package name so
// existing settings and history carry over (~/Library/Application Support/@audio-ripper/desktop).
app.setName("Liner");
app.setPath("userData", path.join(app.getPath("appData"), "@audio-ripper", "desktop"));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const platformArch = `${process.platform}-${process.arch}`;
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const ISSUES_URL = "https://github.com/Omaaarkhan/Liner/issues";
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function bundledBinRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "bin", platformArch)
    : path.join(__dirname, "..", "vendor", "bin", platformArch);
}

function bundledYtDlpPath(): string {
  return path.join(bundledBinRoot(), "yt-dlp", ytDlpAssetName().executable);
}

/** Points the core at the bundled tools. Environment overrides set by the user win. */
function configureBundledBinaries(): void {
  const ffmpegPath = path.join(bundledBinRoot(), isWindows ? "ffmpeg.exe" : "ffmpeg");
  if (!process.env.YAR_FFMPEG_PATH && existsSync(ffmpegPath)) {
    process.env.YAR_FFMPEG_PATH = ffmpegPath;
  }
  if (!process.env.YAR_YTDLP_PATH && existsSync(bundledYtDlpPath())) {
    process.env.YAR_YTDLP_PATH = bundledYtDlpPath();
  }
}

configureBundledBinaries();

// The trim editor plays downloads that are still in the temp folder through this scheme.
// It must be registered before the app is ready; stream support lets media elements seek.
const MEDIA_SCHEME = "liner-media";
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
]);

const toolsDir = path.join(app.getPath("userData"), "tools", "yt-dlp");
let mainWindow: BrowserWindow | null = null;
const subscriptions = new Map<number, (event: JobEvent) => void>();

const orchestrator = new DownloadOrchestrator({
  appDataDir: app.getPath("userData")
});

interface RevealResult {
  ok: boolean;
  message?: string;
}

function getRendererEntryPath(): string {
  return path.join(__dirname, "..", "dist-renderer", "index.html");
}

async function revealItem(targetPath: string): Promise<RevealResult> {
  const normalized = targetPath?.trim();
  if (!normalized) {
    return { ok: false, message: "This download has no file yet." };
  }

  try {
    await stat(normalized);
    shell.showItemInFolder(normalized);
    return { ok: true };
  } catch {
    const parentDir = path.dirname(normalized);
    try {
      await stat(parentDir);
      await shell.openPath(parentDir);
      return { ok: false, message: "The file was moved or renamed, so its folder was opened instead." };
    } catch {
      return { ok: false, message: "The file and its folder no longer exist." };
    }
  }
}

// ---------- Trim preview media ----------

const MEDIA_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "audio/webm",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".opus": "audio/ogg",
  ".ogg": "audio/ogg"
};

/**
 * Serves liner-media://<jobId>/ from the file waiting to be trimmed. Only job ids
 * with a pending trim resolve, so the window can't read arbitrary paths. Range
 * requests are answered by hand because media elements need them to seek.
 */
async function serveTrimMedia(request: Request): Promise<Response> {
  const jobId = new URL(request.url).hostname;
  const filePath = orchestrator.getTrimFilePath(jobId);
  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }

  const { size } = await stat(filePath);
  const type = MEDIA_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  let start = 0;
  let end = size - 1;
  if (range) {
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    } else if (range[2]) {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
  }

  const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {})
    }
  });
}

// ---------- yt-dlp updates ----------

function currentYtDlpVersion(): Promise<string | undefined> {
  return orchestrator.getPreflight().then((report) => {
    const version = report.binaries.find((item) => item.name === "yt-dlp")?.version;
    return version?.replace(/^bundled:\s*/, "").trim();
  });
}

/** Uses a yt-dlp downloaded by an earlier update when it is newer than the bundled one. */
async function preferUpdatedYtDlp(): Promise<void> {
  if (process.env.YAR_YTDLP_USER_OVERRIDE) {
    return;
  }
  const installed = await readInstalledYtDlp(toolsDir);
  if (!installed) {
    return;
  }
  const bundled = await currentYtDlpVersion();
  if (!bundled || compareYtDlpVersions(installed.version, bundled) > 0) {
    process.env.YAR_YTDLP_PATH = installed.executable;
    await orchestrator.getPreflight(true);
  }
}

async function updateYtDlp(): Promise<ToolUpdateStatus> {
  try {
    const result = await checkForYtDlpUpdate({ toolsDir, currentVersion: await currentYtDlpVersion() });
    await mkdir(toolsDir, { recursive: true });
    await writeFile(path.join(toolsDir, "last-check"), String(Date.now()), "utf8");
    if (result.updated && result.executable) {
      process.env.YAR_YTDLP_PATH = result.executable;
      await orchestrator.getPreflight(true);
    }
    const { executable: _executable, ...status } = result;
    return status;
  } catch (error) {
    return { updated: false, message: error instanceof Error ? error.message : "Update failed." };
  }
}

async function updateYtDlpIfStale(): Promise<void> {
  try {
    const last = Number(await readFile(path.join(toolsDir, "last-check"), "utf8"));
    if (Date.now() - last < UPDATE_CHECK_INTERVAL_MS) {
      return;
    }
  } catch {
    // Never checked before.
  }
  await updateYtDlp();
}

// ---------- Window ----------

function overlayColors(): { color: string; symbolColor: string } {
  return nativeTheme.shouldUseDarkColors
    ? { color: "#00000000", symbolColor: "#e8e8ea" }
    : { color: "#00000000", symbolColor: "#1d1d1f" };
}

function windowChrome(): BrowserWindowConstructorOptions {
  if (isMac) {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 20 },
      vibrancy: "sidebar",
      visualEffectState: "followWindow",
      backgroundColor: "#00000000"
    };
  }
  if (isWindows) {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: { ...overlayColors(), height: 52 },
      backgroundMaterial: "mica"
    };
  }
  return {};
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    show: false,
    ...windowChrome(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("Preload failed", { preloadPath, error: error?.message ?? String(error) });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Links dropped on the window should become downloads, not navigate away.
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(getRendererEntryPath());
  }
}

function applyTheme(theme: ThemePreference | undefined): void {
  nativeTheme.themeSource = theme ?? "system";
}

function sendToWindow(channel: string): void {
  mainWindow?.webContents.send(channel);
}

function buildMenu(): void {
  const settingsItem: MenuItemConstructorOptions = {
    label: isMac ? "Settings…" : "Settings",
    accelerator: "CmdOrCtrl+,",
    click: () => sendToWindow("app:open-settings")
  };
  const openFolderItem: MenuItemConstructorOptions = {
    label: "Open Download Folder",
    accelerator: "CmdOrCtrl+Shift+O",
    click: () => void shell.openPath(orchestrator.getSettings().outputRoot)
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            settingsItem,
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" }
          ]
        } satisfies MenuItemConstructorOptions]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Paste Link and Download",
          accelerator: "CmdOrCtrl+Shift+V",
          click: () => sendToWindow("app:paste-and-rip")
        },
        openFolderItem,
        ...(isMac ? [] : [{ type: "separator" } as const, settingsItem, { type: "separator" } as const, { role: "quit" } as const])
      ]
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "Report an Issue", click: () => void shell.openExternal(ISSUES_URL) }]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------

function bindIpc(): void {
  ipcMain.handle("system:preflight", async (_event, force?: boolean) => orchestrator.getPreflight(Boolean(force)));
  ipcMain.handle("system:updateYtDlp", async () => updateYtDlp());
  ipcMain.handle("system:showItem", async (_event, targetPath: string) => revealItem(targetPath));
  ipcMain.handle("system:openFolder", async (_event, folder: string) => {
    await mkdir(folder, { recursive: true }).catch(() => undefined);
    const error = await shell.openPath(folder);
    return error ? { ok: false, message: error } : { ok: true };
  });
  ipcMain.handle("system:chooseFolder", async (event, current?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Choose where downloads are saved",
      defaultPath: current,
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("system:readClipboard", async () => (await clipboard.readText()).trim());
  ipcMain.handle("app:info", async () => ({ version: app.getVersion(), platform: process.platform }));

  ipcMain.handle("job:create", async (_event, payload: CreateJobInput) => orchestrator.createJob(payload));
  ipcMain.handle("job:list", async () => orchestrator.listJobs());
  ipcMain.handle("job:cancel", async (_event, jobId: string) => orchestrator.cancelJob(jobId));
  ipcMain.handle("job:delete", async (_event, jobId: string) => {
    await orchestrator.deleteJob(jobId);
    return orchestrator.listJobs();
  });
  ipcMain.handle("job:trimSource", async (_event, jobId: string) => orchestrator.getTrimSource(jobId));
  ipcMain.handle("job:applyTrim", async (_event, payload: ApplyTrimInput) => orchestrator.applyTrim(payload));
  ipcMain.handle("job:clearFinished", async () => {
    await orchestrator.clearFinished();
    return orchestrator.listJobs();
  });
  ipcMain.handle("job:clearHistory", async () => {
    await orchestrator.clearHistory();
    return orchestrator.listJobs();
  });

  ipcMain.handle("metadata:resolveCandidates", async (_event, payload: ResolveCandidatesInput) =>
    orchestrator.resolveMetadataCandidates(payload)
  );
  ipcMain.handle("metadata:chooseCandidate", async (_event, payload: ChooseMetadataInput) =>
    orchestrator.chooseMetadata(payload)
  );

  ipcMain.handle("settings:get", async () => orchestrator.getSettings());
  ipcMain.handle("settings:update", async (_event, payload: Settings) => {
    await orchestrator.updateSettings(payload);
    applyTheme(payload.theme);
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
    const handler = subscriptions.get(sender.id);
    if (handler) {
      orchestrator.off("event", handler);
      subscriptions.delete(sender.id);
    }
    return true;
  });
}

// ---------- Lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.env.YAR_YTDLP_PATH && process.env.YAR_YTDLP_PATH !== bundledYtDlpPath()) {
    process.env.YAR_YTDLP_USER_OVERRIDE = "1";
  }

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await orchestrator.initialize();
    applyTheme(orchestrator.getSettings().theme);
    protocol.handle(MEDIA_SCHEME, (request) => serveTrimMedia(request));
    bindIpc();
    buildMenu();
    await createMainWindow();

    nativeTheme.on("updated", () => {
      if (isWindows && mainWindow) {
        mainWindow.setTitleBarOverlay({ ...overlayColors(), height: 52 });
      }
    });

    void preferUpdatedYtDlp()
      .then(() => updateYtDlpIfStale())
      .catch((error: unknown) => console.error("yt-dlp update check failed", error));

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
      }
    });
  });

  let flushed = false;
  app.on("before-quit", (event) => {
    if (flushed) {
      return;
    }
    event.preventDefault();
    flushed = true;
    void orchestrator.flush().finally(() => app.quit());
  });

  app.on("window-all-closed", () => {
    if (!isMac) {
      app.quit();
    }
  });
}
