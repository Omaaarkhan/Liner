import { contextBridge, ipcRenderer } from "electron";
import type {
  ApplyTrimInput,
  ChooseMetadataInput,
  CreateJobInput,
  JobEvent,
  ResolveCandidatesInput,
  Settings
} from "@audio-ripper/shared";

function onChannel(channel: string, callback: () => void): () => void {
  const listener = (): void => callback();
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api = {
  platform: process.platform,
  appInfo: () => ipcRenderer.invoke("app:info"),
  readClipboard: () => ipcRenderer.invoke("system:readClipboard"),
  preflight: (force?: boolean) => ipcRenderer.invoke("system:preflight", force),
  updateYtDlp: () => ipcRenderer.invoke("system:updateYtDlp"),
  showItem: (targetPath: string) => ipcRenderer.invoke("system:showItem", targetPath),
  openFolder: (folder: string) => ipcRenderer.invoke("system:openFolder", folder),
  chooseFolder: (current?: string) => ipcRenderer.invoke("system:chooseFolder", current),
  createJob: (payload: CreateJobInput) => ipcRenderer.invoke("job:create", payload),
  listJobs: () => ipcRenderer.invoke("job:list"),
  cancelJob: (jobId: string) => ipcRenderer.invoke("job:cancel", jobId),
  deleteJob: (jobId: string) => ipcRenderer.invoke("job:delete", jobId),
  trimSource: (jobId: string) => ipcRenderer.invoke("job:trimSource", jobId),
  applyTrim: (payload: ApplyTrimInput) => ipcRenderer.invoke("job:applyTrim", payload),
  clearFinished: () => ipcRenderer.invoke("job:clearFinished"),
  clearHistory: () => ipcRenderer.invoke("job:clearHistory"),
  resolveCandidates: (payload: ResolveCandidatesInput) => ipcRenderer.invoke("metadata:resolveCandidates", payload),
  chooseMetadata: (payload: ChooseMetadataInput) => ipcRenderer.invoke("metadata:chooseCandidate", payload),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (payload: Settings) => ipcRenderer.invoke("settings:update", payload),
  toggleWindowMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
  onOpenSettings: (callback: () => void) => onChannel("app:open-settings", callback),
  onPasteAndRip: (callback: () => void) => onChannel("app:paste-and-rip", callback),
  subscribeJobEvents: async (callback: (event: JobEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: JobEvent): void => {
      callback(payload);
    };

    ipcRenderer.on("job:event", listener);
    await ipcRenderer.invoke("job:subscribeStatus");

    return async (): Promise<void> => {
      ipcRenderer.removeListener("job:event", listener);
      await ipcRenderer.invoke("job:unsubscribeStatus");
    };
  }
};

contextBridge.exposeInMainWorld("audioRipper", api);
