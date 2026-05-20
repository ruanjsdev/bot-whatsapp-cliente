import path from "path";
import { app, BrowserWindow, ipcMain } from "electron";
import { BotService } from "../bot/connection";
import {
  BotSnapshot,
  SaveCodesPayload,
  SaveGroupPayload,
  SaveMessageSettingsPayload
} from "../shared/types";

app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | undefined;
let bot: BotService;
let isQuitting = false;

const isDev = !app.isPackaged;

function createBot() {
  const dataDir = isDev ? process.cwd() : app.getPath("userData");

  bot = new BotService({
    authDir: path.join(dataDir, "auth_info"),
    configPath: path.join(dataDir, "config.json")
  });

  bot.on("snapshot", (snapshot: BotSnapshot) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send("bot:snapshot", snapshot);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    title: "Bot WhatsApp",
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function registerIpc() {
  ipcMain.handle("bot:getSnapshot", () => bot.getSnapshot());
  ipcMain.handle("bot:start", async () => {
    await bot.start();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:stop", async () => {
    await bot.stop();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:restart", async () => {
    await bot.restart();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:clearSession", async () => {
    await bot.clearSession();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:refreshGroups", async () => {
    await bot.refreshGroups();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:enableMonitoring", async () => {
    try {
      bot.enableMonitoring();
    } catch (err) {
      // ignore
    }
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:disableMonitoring", async () => {
    try {
      bot.disableMonitoring();
    } catch (err) {
      // ignore
    }
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:saveGroup", async (_event, payload: SaveGroupPayload) => {
    await bot.saveGroup(payload.group, payload.groupId, payload.groupName);
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:saveCodes", async (_event, payload: SaveCodesPayload) => {
    bot.setMessageCodes(payload.codes);
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:saveMessageSettings", async (_event, payload: SaveMessageSettingsPayload) => {
    bot.setMessageSettings(payload.senderName, payload.codes);
    return bot.getSnapshot();
  });
}

app.whenReady().then(() => {
  createBot();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", async (event) => {
  if (!bot || isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  try {
    await bot.stop();
  } finally {
    app.exit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
