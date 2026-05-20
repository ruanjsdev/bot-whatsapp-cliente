export type BotStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "waiting_qr"
  | "reconnecting"
  | "error";

export type LogLevel = "info" | "success" | "warning" | "error";

export type BotLog = {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
};

export type BotGroup = {
  id: string;
  name: string;
};

export type BotConfig = {
  grupoAlvoJid: string;
  grupoAlvoNome: string;
  nomeEnvio: string;
  codigosMensagens: string[];
};

export type BotSnapshot = {
  status: BotStatus;
  qrCode: string;
  config: BotConfig;
  groups: BotGroup[];
  logs: BotLog[];
  error?: string;
  monitoringEnabled?: boolean;
};

export type SaveGroupPayload = {
  group: string;
  groupId?: string;
  groupName?: string;
};

export type SaveCodesPayload = {
  codes: string[];
};

export type SaveMessageSettingsPayload = {
  senderName: string;
  codes: string[];
};

export type DesktopApi = {
  getSnapshot: () => Promise<BotSnapshot>;
  startBot: () => Promise<BotSnapshot>;
  stopBot: () => Promise<BotSnapshot>;
  restartBot: () => Promise<BotSnapshot>;
  clearSession: () => Promise<BotSnapshot>;
  refreshGroups: () => Promise<BotSnapshot>;
  startMonitoring: () => Promise<BotSnapshot>;
  stopMonitoring: () => Promise<BotSnapshot>;
  saveGroup: (payload: SaveGroupPayload) => Promise<BotSnapshot>;
  saveCodes: (payload: SaveCodesPayload) => Promise<BotSnapshot>;
  saveMessageSettings: (payload: SaveMessageSettingsPayload) => Promise<BotSnapshot>;
  onSnapshot: (callback: (snapshot: BotSnapshot) => void) => () => void;
};
