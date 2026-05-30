export type BotStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "waiting_qr"
  | "reconnecting"
  | "error";

export type BotGroupState = "unknown" | "open" | "closed";

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

export type BotReadinessCheck = {
  id: string;
  label: string;
  ok: boolean;
};

export type BotConfig = {
  grupoAlvoJid: string;
  grupoAlvoNome: string;
  grupoTesteJid: string;
  grupoTesteNome: string;
  nomeEnvio: string;
  // mensagens específicas para o uso do bot
  // mensagens enviadas no grupo alvo
  codigosMensagensAlvo: string[];
  // mensagens enviadas durante o aquecimento (grupo de teste)
  codigosMensagensTeste: string[];
};

export type BotSnapshot = {
  status: BotStatus;
  groupState: BotGroupState;
  qrCode: string;
  pairingCode?: string;
  config: BotConfig;
  groups: BotGroup[];
  readinessChecks: BotReadinessCheck[];
  logs: BotLog[];
  error?: string;
  monitoringEnabled?: boolean;
  warmupCompleted?: boolean;
  warmupMessagesSent?: number;
  warmupRequiredMessages?: number;
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

export type SaveWarmupMessageSettingsPayload = {
  senderName: string;
  codes: string[];
};

export type SaveTargetMessageSettingsPayload = {
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
  saveTestGroup: (payload: SaveGroupPayload) => Promise<BotSnapshot>;
  warmupGroups: () => Promise<BotSnapshot>;
  saveCodes: (payload: SaveCodesPayload) => Promise<BotSnapshot>;
  saveMessageSettings: (payload: SaveMessageSettingsPayload) => Promise<BotSnapshot>;
  saveWarmupMessageSettings: (payload: SaveWarmupMessageSettingsPayload) => Promise<BotSnapshot>;
  saveTargetMessageSettings: (payload: SaveTargetMessageSettingsPayload) => Promise<BotSnapshot>;
  onSnapshot: (callback: (snapshot: BotSnapshot) => void) => () => void;
};
