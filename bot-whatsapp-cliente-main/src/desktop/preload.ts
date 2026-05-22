import { contextBridge, ipcRenderer } from "electron";
import {
  BotSnapshot,
  DesktopApi,
  SaveCodesPayload,
  SaveGroupPayload,
  SaveMessageSettingsPayload,
  SaveWarmupMessageSettingsPayload,
  SaveTargetMessageSettingsPayload
} from "../shared/types";

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke("bot:getSnapshot"),
  startBot: () => ipcRenderer.invoke("bot:start"),
  stopBot: () => ipcRenderer.invoke("bot:stop"),
  startMonitoring: () => ipcRenderer.invoke("bot:enableMonitoring"),
  stopMonitoring: () => ipcRenderer.invoke("bot:disableMonitoring"),
  restartBot: () => ipcRenderer.invoke("bot:restart"),
  clearSession: () => ipcRenderer.invoke("bot:clearSession"),
  refreshGroups: () => ipcRenderer.invoke("bot:refreshGroups"),
  saveGroup: (payload: SaveGroupPayload) => ipcRenderer.invoke("bot:saveGroup", payload),
  saveTestGroup: (payload: SaveGroupPayload) => ipcRenderer.invoke("bot:saveTestGroup", payload),
  warmupGroups: () => ipcRenderer.invoke("bot:warmupGroups"),
  saveCodes: (payload: SaveCodesPayload) => ipcRenderer.invoke("bot:saveCodes", payload),
  saveMessageSettings: (payload: SaveMessageSettingsPayload) => ipcRenderer.invoke("bot:saveMessageSettings", payload),
  saveWarmupMessageSettings: (payload: SaveWarmupMessageSettingsPayload) =>
    ipcRenderer.invoke("bot:saveWarmupMessageSettings", payload),
  saveTargetMessageSettings: (payload: SaveTargetMessageSettingsPayload) =>
    ipcRenderer.invoke("bot:saveTargetMessageSettings", payload),
  onSnapshot: (callback: (snapshot: BotSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: BotSnapshot) => callback(snapshot);
    ipcRenderer.on("bot:snapshot", listener);
    return () => ipcRenderer.removeListener("bot:snapshot", listener);
  }
};

contextBridge.exposeInMainWorld("botApi", api);
