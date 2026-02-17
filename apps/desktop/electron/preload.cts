import { contextBridge, ipcRenderer } from "electron";
import type {
  ChooseMetadataInput,
  CreateJobInput,
  JobEvent,
  ResolveCandidatesInput,
  Settings
} from "@audio-ripper/shared";

interface RevealInFinderResult {
  ok: boolean;
  message?: string;
}

const api = {
  preflight: () => ipcRenderer.invoke("system:preflight"),
  showInFinder: (targetPath: string): Promise<RevealInFinderResult> => ipcRenderer.invoke("system:showInFinder", targetPath),
  createJob: (payload: CreateJobInput) => ipcRenderer.invoke("job:create", payload),
  listJobs: () => ipcRenderer.invoke("job:list"),
  cancelJob: (jobId: string) => ipcRenderer.invoke("job:cancel", jobId),
  deleteJob: (jobId: string) => ipcRenderer.invoke("job:delete", jobId),
  clearHistory: () => ipcRenderer.invoke("job:clearHistory"),
  resolveCandidates: (payload: ResolveCandidatesInput) => ipcRenderer.invoke("metadata:resolveCandidates", payload),
  chooseMetadata: (payload: ChooseMetadataInput) => ipcRenderer.invoke("metadata:chooseCandidate", payload),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (payload: Settings) => ipcRenderer.invoke("settings:update", payload),
  toggleWindowMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
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
