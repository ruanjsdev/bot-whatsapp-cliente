import { Boom } from "@hapi/boom";
import P from "pino";
import fs from "fs";
import path from "path";
import { webcrypto } from "crypto";
import { EventEmitter } from "events";
import { ConfigStore, DEFAULT_CONFIG } from "./config";
import { resolveGroup, normalizarTexto } from "./group";
import { BotLogger } from "./logger";
import { BotConfig, BotGroup, BotGroupState, BotReadinessCheck, BotSnapshot, BotStatus } from "../shared/types";

const originalConsoleLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  if (String(args[0] || "").startsWith("Closing session:")) return;
  originalConsoleLog(...args);
};

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true
  });
}

let makeWASocket: any;
let DisconnectReason: any;
let fetchLatestBaileysVersion: any;
let useMultiFileAuthState: any;
let generateMessageIDV2: any;
let generateWAMessageFromContent: any;
let Browsers: any;
let baileysLoadPromise: Promise<void> | undefined;

function loadBaileys(): Promise<void> {
  if (baileysLoadPromise) return baileysLoadPromise;

  baileysLoadPromise = (async () => {
    const importModule = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const baileys = await importModule("@whiskeysockets/baileys");
    makeWASocket = baileys.default || baileys;
    DisconnectReason = baileys.DisconnectReason;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    generateMessageIDV2 = baileys.generateMessageIDV2;
    generateWAMessageFromContent = baileys.generateWAMessageFromContent;
    Browsers = baileys.Browsers;
  })();

  return baileysLoadPromise;
}

type BotServiceOptions = {
  authDir?: string;
  configPath?: string;
  terminalMode?: boolean;
  initialCodes?: string[];
  pairingPhoneNumber?: string;
  autoClearInvalidSession?: boolean;
};

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 3500;
const HEALTH_CHECK_INTERVAL_MS = 25000;
const INSTANT_BURST_DELAY_MS = 0;
const MAX_OUTGOING_MESSAGES = 2;
const WARMUP_MESSAGE_COUNT = 15;

export class BotService extends EventEmitter {
  private sock: any;
  private status: BotStatus = "disconnected";
  private groupState: BotGroupState = "unknown";
  private qrCode = "";
  private pairingPhoneNumber = "";
  private pairingCode = "";
  private pairingCodeRequested = false;
  private error = "";
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;
  private stopping = false;
  private starting?: Promise<void>;
  private activeConnectionId = 0;
  private qrReceivedInCurrentConnection = false;
  private unknownDisconnects = 0;
  private sendCycleId = 0;
  private activeSendCycle?: Promise<void>;
  private monitoringEnabled = false;
  private estadoInicialDoGrupoCapturado = false;
  private grupoJaFechouDepoisDoInicio = false;
  private diagnosedNotAcceptableCycles = new Set<number>();
  private codigosEscolhidos: string[] = [];
  private mensagensProntasAlvo: string[] = [];
  private mensagensProntasTeste: string[] = [];
  private preparedTargetJid = "";
  private preparedMessages: string[] = [];
  private preparedRelayMessages: any[] = []; // esse aqui
  private warmupMessagesSent = 0;
  private warmupCompleted = false;
  private configStore: ConfigStore;
  private logger: BotLogger;
  private authDir: string;
  private autoClearInvalidSession = false;
  private clearedInvalidSessionInCurrentRun = false;
  private groupMetadataCache = new Map<string, any>();
  private currentUserInTargetGroup = false;
  private groups: BotGroup[] = [];

  constructor(options: BotServiceOptions = {}) {
    super();
    this.authDir = options.authDir || path.resolve(process.cwd(), "auth_info");
    this.configStore = new ConfigStore(options.configPath);
    this.logger = new BotLogger(() => this.emitSnapshot());
    this.autoClearInvalidSession = Boolean(options.autoClearInvalidSession);
    this.pairingPhoneNumber = Object.prototype.hasOwnProperty.call(options, "pairingPhoneNumber")
      ? options.pairingPhoneNumber || ""
      : process.env.BOT_PHONE_NUMBER || "";
    const config = this.configStore.load();
    this.codigosEscolhidos = options.initialCodes?.length ? options.initialCodes : [];
    this.montarMensagens();
    this.warmupMessagesSent = 0;
    this.warmupCompleted = false;
  }

  getSnapshot(): BotSnapshot {
    return {
      status: this.status,
      groupState: this.groupState,
      qrCode: this.qrCode,
      pairingCode: this.pairingCode || undefined,
      config: this.configStore.load(),
      groups: this.groups,
      readinessChecks: this.getReadinessChecks(),
      logs: this.logger.all(),
      error: this.error,
      monitoringEnabled: this.monitoringEnabled,
      warmupCompleted: this.warmupCompleted,
      warmupMessagesSent: this.warmupMessagesSent,
      warmupRequiredMessages: WARMUP_MESSAGE_COUNT
    };
  }
  isMonitoringEnabled(): boolean {
    return this.monitoringEnabled;
  }

  async enableMonitoring(): Promise<boolean> {
    if (this.status !== "connected") {
      this.logger.warning("Conecte o WhatsApp antes de ativar o monitoramento.");
      return false;
    }

    if (!this.warmupCompleted) {
      this.logger.error("Pré-aqueça o grupo de teste antes de iniciar o bot.");
      this.emitSnapshot();
      return false;
    }

    if (!this.hasReadyMessages()) {
      this.monitoringEnabled = false;
      this.logger.error("Bot não armado: existe verificação pendente na checklist de prontidão.");
      this.emitSnapshot();
      return false;
    }

    if (!this.prepareSendPlan()) {
      this.monitoringEnabled = false;
      this.logger.error("Bot não armado: não consegui preparar o plano de disparo.");
      this.emitSnapshot();
      return false;
    }

    await this.captureInitialGroupState();
    this.monitoringEnabled = true;
    this.startHealthCheck();
    this.logger.success("✅ Bot ARMADO - Monitoramento ativado. Aguardando abertura do grupo...");
    this.emitSnapshot();
    return true;
  }

  disableMonitoring(): void {
    this.monitoringEnabled = false;
    this.clearHealthCheckTimer();
    this.logger.info("⏹️ Monitoramento desativado (Parou de escutar aberturas).");
    this.emitSnapshot();
  }

  async start() {
    if (this.starting) return this.starting;
    if (this.isRunning()) {
      this.logger.warning("WhatsApp já está em processo de conexão ou conectado.");
      return;
    }

    this.stopping = false;
    this.reconnectAttempts = 0;
    this.clearedInvalidSessionInCurrentRun = false;
    this.starting = this.connect();

    try {
      await this.starting;
    } catch (error) {
      this.error = this.getErrorMessage(error);
      this.setStatus("error");
      this.logger.error(this.error);
    } finally {
      this.starting = undefined;
    }
  }

  async stop() {
    this.monitoringEnabled = false;
    this.pairingCode = "";
    this.pairingCodeRequested = false;
    if (!this.isRunning()) {
      this.logger.warning("Não é possível parar: o bot ainda não foi iniciado.");
      return;
    }

    this.stopping = true;
    this.activeConnectionId += 1;
    this.clearReconnectTimer();
    this.clearHealthCheckTimer();
    this.reconnectAttempts = 0;
    this.qrCode = "";

    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners("connection.update");
        this.sock.ev.removeAllListeners("groups.update");
        this.sock.ev.removeAllListeners("messages.upsert");
        this.sock.end?.(undefined);
        this.sock.ws?.close?.();
      } catch (error) {
        this.logger.warning(`Falha ao encerrar conexão antiga: ${this.getErrorMessage(error)}`);
      }
    }

    this.sock = undefined;
    this.groupState = "unknown";
    this.currentUserInTargetGroup = false;
    this.preparedTargetJid = "";
    this.preparedMessages = [];
    this.preparedRelayMessages = []; // esse aqui
    this.setStatus("disconnected");
    this.logger.info("Bot parado.");
  }

  async shutdownAndClearSession() {
    if (this.isRunning()) {
      await this.stop();
    } else {
      this.monitoringEnabled = false;
      this.clearReconnectTimer();
      this.clearHealthCheckTimer();
      this.pairingCode = "";
      this.pairingCodeRequested = false;
    }

    this.qrCode = "";
    this.error = "";
    this.logger.info("Bot encerrado. Sessão/auth preservada para a próxima abertura.");
    this.emitSnapshot();
  }

  async restart() {
    if (!this.isRunning()) {
      this.logger.warning("Não há conexão ativa para reiniciar. Use Conectar WhatsApp.");
      return;
    }

    const shouldRestoreMonitoring = this.monitoringEnabled;
    this.logger.info("Reiniciando conexão...");
    await this.stop();
    this.monitoringEnabled = shouldRestoreMonitoring;
    await this.start();
  }

  async clearSession() {
    await this.logoutAndClearSession();
    this.qrCode = "";
    this.error = "";
    this.logger.warning("Sessão/auth apagada e logout solicitado. Gerando um novo QR Code.");
    this.emitSnapshot();
    await this.start();
  }

  async factoryReset() {
    this.logger.warning("Restaurando padrão de fábrica: limpando sessão, configurações e cache local.");

    if (this.isRunning()) {
      await this.stop();
    } else {
      this.monitoringEnabled = false;
      this.clearReconnectTimer();
      this.clearHealthCheckTimer();
    }

    this.removeAuthDir();
    try {
      if (fs.existsSync(this.configStore.path)) {
        fs.rmSync(this.configStore.path, { force: true });
      }
    } catch (error) {
      this.logger.warning(`Falha ao apagar configuração: ${this.getErrorMessage(error)}`);
    }

    this.configStore.save(DEFAULT_CONFIG);
    this.groupState = "unknown";
    this.qrCode = "";
    this.pairingCode = "";
    this.pairingCodeRequested = false;
    this.error = "";
    this.reconnectAttempts = 0;
    this.unknownDisconnects = 0;
    this.sendCycleId += 1;
    this.monitoringEnabled = false;
    this.estadoInicialDoGrupoCapturado = false;
    this.grupoJaFechouDepoisDoInicio = false;
    this.currentUserInTargetGroup = false;
    this.groups = [];
    this.groupMetadataCache.clear();
    this.preparedTargetJid = "";
    this.preparedMessages = [];
    this.preparedRelayMessages = [];
    this.resetWarmupState();
    this.codigosEscolhidos = [];
    this.montarMensagens();
    this.logger.success("Padrão de fábrica aplicado. Gerando novo QR Code.");
    this.emitSnapshot();
    await this.start();
  }

  async saveGroup(group: string, groupId?: string, groupName?: string) {
    const config = groupId
      ? this.configStore.saveGroupById(groupId, groupName || group)
      : this.configStore.saveGroup(group);
    this.groupState = "unknown";
    this.currentUserInTargetGroup = false;
    this.preparedTargetJid = "";
    this.preparedMessages = [];
    this.preparedRelayMessages = [];
    this.logger.success(`Grupo alterado para: ${config.grupoAlvoNome || config.grupoAlvoJid}`);

    if (this.sock && this.status === "connected") {
      await this.resolveConfiguredGroup();
    }

    this.emitSnapshot();
  }

  async saveTestGroup(group: string, groupId?: string, groupName?: string) {
    this.resetWarmupState();
    const config = groupId
      ? this.configStore.saveTestGroupById(groupId, groupName || group)
      : this.configStore.saveTestGroup(group);
    this.logger.success(`Grupo de teste salvo: ${config.grupoTesteNome || config.grupoTesteJid}`);
    this.emitSnapshot();
  }

  async warmupConnection(message?: string): Promise<boolean> {
    if (!this.sock || this.status !== "connected") {
      this.logger.warning("Conecte o WhatsApp antes de aquecer o bot.");
      return false;
    }

    const config = this.configStore.load();
    if (!config.grupoTesteJid && !config.grupoTesteNome) {
      this.logger.warning("Salve um grupo de teste para aquecimento antes de iniciar.");
      return false;
    }

    if (message) this.logger.info(message);

    const warmupGroup = await this.resolveWarmupTarget(config);
    if (!warmupGroup) {
      this.logger.warning("Não foi possível resolver o grupo de teste para aquecimento.");
      return false;
    }

    // ensure warmup messages are loaded from config
    this.syncMessagesFromConfig();

    const warmupMessages = this.buildWarmupMessages();
    this.warmupMessagesSent = 0;
    this.warmupCompleted = false;

    // send an initial marker message indicating the start of warmup with weekday, date and time
    try {
      const now = new Date();
      const timestamp = now.toLocaleString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
      const initialMsg = `INICIANDO AQUECIMENTO 🔽 ${timestamp}`;
      await this.relayTextMessage(this.sock, warmupGroup.jid, initialMsg);
      this.logger.info("Mensagem inicial de aquecimento enviada.");
    } catch (err) {
      this.logger.warning(`Falha ao enviar mensagem inicial de aquecimento: ${this.getErrorMessage(err)}`);
    }

    // send warmup messages as fast as possible using low-level relay messages
    const relayMessages = warmupMessages.map((mensagem) => this.buildRelayTextMessage(this.sock, warmupGroup.jid, mensagem));

    for (const [index, fullMessage] of relayMessages.entries()) {
      const messageNumber = index + 1;
      this.logger.info(`Enviando (rápido) mensagem de aquecimento ${messageNumber}/${WARMUP_MESSAGE_COUNT} para o grupo de teste.`);
      try {
        // send without retries/delays to be as fast as possible
        await this.relayPreparedMessage(this.sock, warmupGroup.jid, fullMessage);
        this.warmupMessagesSent += 1;
        this.logger.success(`Aquecimento ${messageNumber} enviado (rápido).`);
      } catch (err) {
        this.logger.warning(`Falha no envio de aquecimento ${messageNumber}: ${this.getErrorMessage(err)}. Continuando...`);
      }

      // emit progress after each send
      this.emitSnapshot();
    }

    if (config.grupoAlvoJid) {
      await this.refreshGroupMetadata(config.grupoAlvoJid);
    }

    this.warmupCompleted = this.warmupMessagesSent >= WARMUP_MESSAGE_COUNT;
    if (this.warmupCompleted) {
      this.logger.success(`Aquecimento concluído: ${this.warmupMessagesSent}/${WARMUP_MESSAGE_COUNT} mensagens enviadas no grupo de teste.`);
    } else {
      this.logger.warning(`Aquecimento incompleto: ${this.warmupMessagesSent}/${WARMUP_MESSAGE_COUNT} mensagens enviadas.`);
    }

    this.emitSnapshot();
    return this.warmupCompleted;
  }

  private async resolveWarmupTarget(config: BotConfig) {
    try {
      const resolved = await resolveGroup(this.sock, {
        jid: config.grupoTesteJid,
        name: config.grupoTesteNome
      });

      if (resolved.jid) {
        return { jid: resolved.jid, label: "grupo de teste" };
      }
    } catch (error) {
      this.logger.warning(`Não consegui resolver o grupo de teste: ${this.getErrorMessage(error)}`);
    }

    return undefined;
  }

  private buildWarmupMessages() {
    const baseMessages = this.mensagensProntasTeste.length
      ? this.mensagensProntasTeste
      : ["Aquecimento"].map((item) => item);

    return Array.from({ length: WARMUP_MESSAGE_COUNT }, (_, index) => {
      const message = baseMessages[index % baseMessages.length];
      return `${message} (aquecimento ${index + 1})`;
    });
  }

  private async sendWarmupMessage(jid: string, mensagem: string, messageNumber: number) {
    const maxAttempts = 3;
    const delays = [75, 150, 250];

    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.relayTextMessage(this.sock, jid, mensagem);
        this.logger.success(`Aquecimento ${messageNumber} enviado.`);
        return true;
      } catch (error) {
        const message = this.getErrorMessage(error);
        if (attempt === maxAttempts) {
          this.logger.error(`Falha no aquecimento ${messageNumber}: ${message}`);
          return false;
        }

        this.logger.warning(`Aquecimento ${messageNumber} falhou (${message}). Retentando...`);
        await this.delay(delays[attempt] || 150);
      }
    }

    return false;
  }

  private async prewarmGroup(jid: string, label: string) {
    const config = this.configStore.load();
    this.logger.info(`Aquecer ${label}: ${jid}`);

    const metadata = await this.refreshGroupMetadata(jid);
    if (!metadata) {
      throw new Error(`Não foi possível obter metadata do ${label}.`);
    }

    if (label === "grupo alvo") {
      const currentUserIds = this.getCurrentUserIds();
      const participant = metadata.participants?.find((item: any) => {
        const id = String(item.id || "");
        const number = id.split(":")[0].split("@")[0];
        return currentUserIds.includes(id) || currentUserIds.includes(`${number}@s.whatsapp.net`);
      });

      if (!participant) {
        this.currentUserInTargetGroup = false;
        this.logger.warning("A conta conectada não está no grupo alvo. Verifique a participação antes de enviar.");
      } else {
        this.currentUserInTargetGroup = true;
      }

      this.groupState = metadata.announce === true ? "closed" : "open";
    }

    this.logger.success(`Aquecimento concluído para ${label}: ${metadata.subject || jid}`);
    return true;
  }

  async refreshGroups() {
    if (!this.sock || this.status !== "connected") {
      this.logger.warning("Conecte o WhatsApp antes de carregar a lista de grupos.");
      this.emitSnapshot();
      return;
    }

    await this.loadGroups();
    this.emitSnapshot();
  }

  setMessageCodes(codes: string[]) {
    // Set target (alvo) message codes. Do NOT reset warmup completion.
    this.codigosEscolhidos = codes.map((item) => item.trim().toUpperCase()).filter(Boolean);
    this.montarMensagens();
    this.configStore.save({ codigosMensagensAlvo: this.codigosEscolhidos });
    this.prepareSendPlan();
    this.logger.success("Mensagens do grupo alvo atualizadas.");
  }

  setMessageSettings(senderName: string, codes: string[]) {
    // Update target (alvo) message settings. Do NOT reset warmup completion.
    this.codigosEscolhidos = codes.map((item) => item.trim().toUpperCase()).filter(Boolean);
    this.configStore.save({
      nomeEnvio: senderName.trim(),
      codigosMensagensAlvo: this.codigosEscolhidos
    });
    this.montarMensagens();
    this.prepareSendPlan();
    this.logger.success(
      `Nome e mensagens do grupo alvo atualizados: ${this.codigosEscolhidos.length} mensagens prontas (${this.codigosEscolhidos.join(", ")}).`
    );
  }

  // Save warmup (teste) message settings. This resets the warmup state.
  setWarmupMessageSettings(senderName: string, codes: string[]) {
    this.resetWarmupState();
    const nextCodes = codes.map((item) => item.trim().toUpperCase()).filter(Boolean);
    this.configStore.save({ nomeEnvio: senderName.trim(), codigosMensagensTeste: nextCodes });
    this.montarMensagens();
    this.logger.success(`Mensagens de aquecimento atualizadas: ${nextCodes.length} mensagens.`);
  }

  private async connect() {
    const connectionId = ++this.activeConnectionId;
    this.qrReceivedInCurrentConnection = false;
    this.pairingCode = "";
    this.pairingCodeRequested = false;
    this.estadoInicialDoGrupoCapturado = false;
    this.grupoJaFechouDepoisDoInicio = false;
    this.clearReconnectTimer();
    this.setStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");
    this.error = "";
    this.logger.info(this.reconnectAttempts > 0 ? "Tentando reconectar..." : "Bot iniciado.");

    await loadBaileys();
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const version = await this.getWhatsAppVersion();

    this.sock = makeWASocket({
      auth: state,
      version,
      logger: P({ level: "silent" }),
      printQRInTerminal: false,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      browser: Browsers?.ubuntu?.("Bot Rota Rapida") || ["Ubuntu", "Chrome", "1.0.0"],
      cachedGroupMetadata: async (jid: string) => this.groupMetadataCache.get(jid)
    });

    this.sock.ev.on("creds.update", saveCreds);
    this.sock.ev.on("connection.update", (update: any) =>
      this.handleConnectionUpdate(update, connectionId)
    );
    this.sock.ev.on("groups.update", (updates: any[]) =>
      this.handleGroupsUpdate(updates, connectionId)
    );
    this.sock.ev.on("messages.upsert", ({ messages }: any) =>
      this.handleMessages(messages, connectionId)
    );

    // Baileys requires waiting for the QR event before requesting a pairing code.
  }

  private async requestPairingCodeIfNeeded(connectionId: number): Promise<void> {
    if (!this.sock) return;
    if (connectionId !== this.activeConnectionId) return;
    if (!this.pairingPhoneNumber) return;
    if (this.pairingCodeRequested) return;
    if (!this.qrReceivedInCurrentConnection) return;
    if (this.sock.authState?.creds?.registered) return;

    const phone = this.pairingPhoneNumber.replace(/\D/g, "");
    if (phone.length < 10) {
      this.logger.warning("Número de pareamento inválido. Use formato 55 + DDD + número, sem +.");
      return;
    }

    this.logger.info(`Solicitando código de pareamento para: +${phone}`);
    console.log(`📞 Número usado no pareamento: +${phone}`);

    this.pairingCodeRequested = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (!this.sock || connectionId !== this.activeConnectionId) return;

      const code = await this.sock.requestPairingCode(phone);
      this.pairingCode = code;

      this.logger.success(`Código de pareamento gerado: ${code}`);
      console.log(`\n🔐 CÓDIGO DE PAREAMENTO WHATSAPP: ${code}\n`);
      this.emitSnapshot();
    } catch (error) {
      this.pairingCodeRequested = false;
      this.logger.warning(`Falha ao gerar código de pareamento: ${this.getErrorMessage(error)}`);
      console.log("PAIRING CODE ERROR:", error);
      this.emitSnapshot();
    }
  }

  private async handleConnectionUpdate(update: any, connectionId: number) {
    if (connectionId !== this.activeConnectionId) return;

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.unknownDisconnects = 0;
      this.qrReceivedInCurrentConnection = true;
      this.qrCode = qr;
      this.setStatus("waiting_qr");
      this.logger.info("QR Code gerado.");
      void this.requestPairingCodeIfNeeded(connectionId);
    }

    if (connection === "open") {
      this.unknownDisconnects = 0;
      this.reconnectAttempts = 0;
      this.qrCode = "";
      this.pairingCode = "";
      this.pairingCodeRequested = false;
      this.setStatus("connected");
      this.logger.success("WhatsApp conectado.");

      try {
        await this.loadGroups();
        await this.resolveConfiguredGroup();
        void this.prewarmConnection("Pré-aquecendo sessão após conexão...");
        if (this.monitoringEnabled) {
          await this.captureInitialGroupState();
          this.startHealthCheck();
          this.logger.success("Monitoramento restaurado após reconexão.");
        }
        this.logger.info("Aguardando abertura do grupo.");
      } catch (error) {
        this.error = this.getErrorMessage(error);
        this.setStatus("error");
        this.logger.error(this.error);
      }
    }

    if (connection === "close") {
      this.sock = undefined;
      this.clearHealthCheckTimer();
      if (this.stopping) return;

      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const errorMessage = this.getErrorMessage(lastDisconnect?.error);
      const disconnectDescription = this.getDisconnectDescription(statusCode, errorMessage);
      this.logger.warning(`Conexão fechada. Código: ${statusCode || "sem código"} | Erro: ${errorMessage}`);
      console.log("WA CLOSE DEBUG:", {
        statusCode,
        errorMessage,
        lastDisconnect
      });

      if (this.isFatalRuntimeError(errorMessage)) {
        this.error = `Erro interno ao iniciar WhatsApp: ${errorMessage}`;
        this.setStatus("error");
        this.logger.error(this.error);
        return;
      }

      if (this.isInvalidSession(statusCode, errorMessage)) {
        if (this.autoClearInvalidSession && !this.clearedInvalidSessionInCurrentRun) {
          this.clearedInvalidSessionInCurrentRun = true;
          this.logger.warning(
            `Sessão inválida ou logout detectado (${statusCode || "sem código"}). Limpando auth_info e gerando QR novo.`
          );
          this.removeAuthDir();
          this.reconnectAttempts = 0;
          this.unknownDisconnects = 0;
          this.qrCode = "";
          this.pairingCode = "";
          this.pairingCodeRequested = false;
          this.scheduleReconnect(true);
          return;
        }

        this.failConnectionWithoutReconnect(
          `Sessão inválida ou logout detectado (${statusCode || "sem código"}). Parei para evitar loop de reconexão. Use Limpar sessão para gerar um novo QR Code/código de pareamento.`
        );
        return;
      }

      if (!statusCode) {
        this.unknownDisconnects += 1;

        if (
          this.hasAuthSession() &&
          !this.qrReceivedInCurrentConnection &&
          this.unknownDisconnects >= 2
        ) {
          this.failConnectionWithoutReconnect(
            "A sessão local fechou sem motivo claro antes de conectar. Parei para evitar loop de reconexão. Use Limpar sessão para gerar um novo QR Code/código de pareamento."
          );
          this.unknownDisconnects = 0;
          return;
        }
      }

      this.logger.warning(`WhatsApp desconectado. ${disconnectDescription}.`);
      this.scheduleReconnect(false);
    }
  }

  private failConnectionWithoutReconnect(message: string) {
    this.clearReconnectTimer();
    this.clearHealthCheckTimer();
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
    this.error = message;
    this.pairingCodeRequested = false;
    this.setStatus("error");
    this.logger.error(message);
  }

  private async resolveConfiguredGroup() {
    const config = this.configStore.load();
    const group = await this.resolveConfiguredTargetGroup(config);

    if (!group.jid) {
      this.logger.warning("Nenhum grupo configurado. Informe o nome ou ID na interface.");
      return;
    }

    const nextConfig: BotConfig = this.configStore.save({
      grupoAlvoJid: group.jid,
      grupoAlvoNome: group.name
    });

    await this.refreshGroupMetadata(nextConfig.grupoAlvoJid);
    this.prepareSendPlan();

    this.logger.success(`Grupo configurado: ${nextConfig.grupoAlvoNome}`);
  }

  private async resolveConfiguredTargetGroup(config: BotConfig) {
    if (config.grupoAlvoJid && this.groupMetadataCache.has(config.grupoAlvoJid)) {
      const metadata = this.groupMetadataCache.get(config.grupoAlvoJid);
      return {
        jid: config.grupoAlvoJid,
        name: String(metadata?.subject || config.grupoAlvoNome || "Grupo salvo")
      };
    }

    if (config.grupoAlvoNome) {
      const wanted = normalizarTexto(config.grupoAlvoNome);
      const foundByName = this.groups.find((group) => normalizarTexto(group.name) === wanted);

      if (foundByName) {
        this.logger.info("Grupo salvo por ID não foi encontrado. Revalidando pelo nome do grupo.");
        return {
          jid: foundByName.id,
          name: foundByName.name
        };
      }
    }

    if (config.grupoAlvoJid) {
      this.logger.warning(
        "O ID do grupo salvo não apareceu na lista atual do WhatsApp. Atualize a lista e salve o grupo novamente."
      );
      return {
        jid: "",
        name: config.grupoAlvoNome
      };
    }

    return resolveGroup(this.sock, {
      jid: config.grupoAlvoJid,
      name: config.grupoAlvoNome
    });
  }

  private async loadGroups() {
    const grupos = await this.sock.groupFetchAllParticipating();
    const listaGrupos = (Object.values(grupos) as any[])
      .map((grupo) => ({
        id: String(grupo.id || ""),
        name: String(grupo.subject || "Grupo sem nome")
      }))
      .filter((grupo) => grupo.id)
      .sort((a, b) => normalizarTexto(a.name).localeCompare(normalizarTexto(b.name)));

    this.groups = listaGrupos;

    for (const grupo of Object.values(grupos) as any[]) {
      if (grupo?.id) {
        this.groupMetadataCache.set(grupo.id, grupo);
      }
    }

    this.logger.success(`${this.groups.length} grupos carregados do WhatsApp.`);
  }

  private async captureInitialGroupState(): Promise<void> {
    try {
      const config = this.configStore.load();
      if (!config.grupoAlvoJid || !this.sock) return;

      const metadata = await this.refreshGroupMetadata(config.grupoAlvoJid);
      if (!metadata) return;

      const isGroupClosed = metadata.announce === true;
      this.groupState = isGroupClosed ? "closed" : "open";
      
      if (isGroupClosed) {
        this.estadoInicialDoGrupoCapturado = true;
        this.grupoJaFechouDepoisDoInicio = true;
        this.logger.info("📌 Estado inicial do grupo: FECHADO. Aguardando abertura...");
      } else {
        this.estadoInicialDoGrupoCapturado = true;
        this.grupoJaFechouDepoisDoInicio = false;
        this.logger.info("📌 Estado inicial do grupo: ABERTO. Aguardando fechamento e reabertura...");
      }
    } catch (error) {
      this.logger.warning(`Não foi possível capturar estado inicial do grupo: ${this.getErrorMessage(error)}`);
    }
  }

  private scheduleReconnect(forceNewQr: boolean) {
    this.clearReconnectTimer();

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.clearReconnectTimer();
      this.clearHealthCheckTimer();
      this.error =
        "Limite de reconexão atingido. A internet pode estar instável ou a sessão pode estar inválida. Use Limpar sessão para gerar um novo QR Code.";
      this.setStatus("error");
      this.logger.error(this.error);
      return;
    }

    this.reconnectAttempts += 1;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.error = this.getErrorMessage(error);
        this.setStatus("error");
        this.logger.error(this.error);
      });
    }, forceNewQr ? 500 : RECONNECT_DELAY_MS);
  }

  private handleGroupsUpdate(updates: any[], connectionId: number) {
    if (connectionId !== this.activeConnectionId) return;
    if (!this.monitoringEnabled) return;

    const config = this.configStore.load();
    if (!config.grupoAlvoJid) return;

    for (const update of updates) {
      if (!update?.id || update.id !== config.grupoAlvoJid) continue;

      if (update.announce === true) {
        this.groupState = "closed";
        this.grupoJaFechouDepoisDoInicio = true;
        this.sendCycleId += 1;
        this.logger.info("🔒 Grupo FECHADO. Bot armado para próxima abertura.");
        this.prepareSendPlan();
        this.logger.info("Plano de disparo preparado em memória para a próxima abertura.");
        return;
      }

      if (update.announce === false) {
        this.groupState = "open";
        if (!this.grupoJaFechouDepoisDoInicio) {
          this.logger.info("⚠️ Grupo já estava aberto desde o início. Aguardando próximo ciclo de fechamento e reabertura...");
          return;
        }

        const cycleId = ++this.sendCycleId;
        this.grupoJaFechouDepoisDoInicio = false;
        this.enviarMensagensRapidas(cycleId);
        this.logger.info("⚡ GRUPO ABRIU! Rajada instantânea acionada.");
        return;
      }
    }
  }
  private handleMessages(messages: any[], connectionId: number) {
    if (connectionId !== this.activeConnectionId) return;
    if (!this.monitoringEnabled) return;

    const config = this.configStore.load();

    if (!config.grupoAlvoJid) return;

    for (const msg of messages || []) {
      if (!msg?.message || !msg.key?.remoteJid) continue;
      if (msg.key.remoteJid !== config.grupoAlvoJid) continue;

      const texto =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";

      if (!texto) continue;

      const palavrasAbertura = [
        "abriu",
        "aberto",
        "liberado",
        "liberou",
        "pode mandar",
        "podem mandar",
        "grupo aberto"
      ];

      const detectouAbertura = palavrasAbertura.some((palavra) =>
        normalizarTexto(texto).includes(normalizarTexto(palavra))
      );

      if (detectouAbertura) {
        if (!this.grupoJaFechouDepoisDoInicio) {
          this.logger.info(
            "Palavra de abertura detectada, mas o grupo ainda não fechou após o bot iniciar. Nenhuma mensagem enviada."
          );
          return;
        }

        const cycleId = ++this.sendCycleId;
        this.grupoJaFechouDepoisDoInicio = false;
        this.enviarMensagensRapidas(cycleId);
        this.logger.info("Palavra de abertura detectada. Rajada instantânea acionada.");
        return;
      }
    }
  }
  private enviarMensagensRapidas(cycleId: number) {
    if (!this.preparedTargetJid || !this.preparedMessages.length) {
      this.prepareSendPlan();
    }

    if (!this.preparedTargetJid) {
      this.logger.error("Grupo alvo ainda não foi configurado.");
      return;
    }

    if (!this.preparedMessages.length) {
      this.logger.error("Nenhuma mensagem está pronta.");
      return;
    }

    let mensagens = [...this.preparedMessages];

    if (mensagens.length > MAX_OUTGOING_MESSAGES) {
      mensagens = mensagens.slice(0, MAX_OUTGOING_MESSAGES);
      this.logger.warning(
        `Limite máximo de ${MAX_OUTGOING_MESSAGES} mensagens ativo. Enviando apenas as duas primeiras.`
      );
    }

    if (this.activeSendCycle) {
      this.logger.warning("Já existe um disparo em andamento. Mantendo apenas o ciclo mais novo.");
    }

    this.activeSendCycle = this.sendAggressiveTargetSequence(this.preparedTargetJid, mensagens, cycleId).finally(() => {
      if (cycleId === this.sendCycleId) {
        this.activeSendCycle = undefined;
      }
    });

    this.logger.info(
      `Modo instantâneo agressivo: ${mensagens.length} mensagens disparadas juntas com ${INSTANT_BURST_DELAY_MS}ms: ${mensagens.join(" | ")}`
    );
  }

  private async sendFastSequence(jid: string, mensagens: string[], cycleId: number) {
    try {
      const sock = this.sock;
      if (!sock) {
        this.logger.error("Não há conexão ativa no momento do disparo.");
        return;
      }

      if (mensagens.length === 1) {
        const sent = await this.sendSingleInstant(sock, jid, mensagens[0], cycleId);
        if (sent) {
          this.logger.success("Disparo concluído: 1/1 mensagem confirmada.");
        } else {
          this.logger.warning("Disparo terminou com atenção: 0/1 mensagem confirmada.");
        }
        return;
      }

      let confirmed = 0;

      for (const [index, mensagem] of mensagens.entries()) {
        const messageNumber = index + 1;
        if (cycleId !== this.sendCycleId) break;

        try {
          await this.relayPreparedTextMessage(sock, jid, mensagem, index);
          this.logger.success(`Mensagem ${messageNumber} confirmada: ${mensagem}`);
          confirmed += 1;
        } catch (error) {
          const message = this.getErrorMessage(error);
          this.logger.warning(`Mensagem ${messageNumber} falhou no tiro instantâneo (${message}). Retentando...`);

          if (!this.isRetryableSendError(message)) {
            this.logger.error(`Erro ao enviar mensagem ${messageNumber}: ${message}`);
            break;
          }

          const retried = await this.sendMessageWithRetry(jid, mensagem, messageNumber, cycleId, true);
          if (!retried) {
            break;
          }

          confirmed += 1;
        }

        if (messageNumber === 1 && confirmed === 1 && mensagens.length > 1) {
          this.logger.info("Mensagem 1 confirmada. Enviando mensagem 2 imediatamente.");
        }
      }

      if (confirmed === mensagens.length) {
        this.logger.success(`Disparo concluído: ${confirmed}/${mensagens.length} mensagens confirmadas.`);
      } else {
        this.logger.warning(`Disparo terminou com atenção: ${confirmed}/${mensagens.length} mensagens confirmadas.`);
      }
    } catch (error) {
      this.logger.error(`Erro inesperado no disparo turbo: ${this.getErrorMessage(error)}`);
    }
  }

  private async sendAggressiveTargetSequence(jid: string, mensagens: string[], cycleId: number) {
    // aggressive, low-latency send for the real target group
    try {
      const sock = this.sock;
      if (!sock) {
        this.logger.error("Não há conexão ativa no momento do disparo.");
        return;
      }

      const relayMessages = this.preparedRelayMessages && this.preparedRelayMessages.length
        ? this.preparedRelayMessages
        : mensagens.map((m) => this.buildRelayTextMessage(sock, jid, m));

      const startedAt = Date.now();
      const results = await Promise.allSettled(
        relayMessages.map((fullMessage) => {
          if (cycleId !== this.sendCycleId) {
            return Promise.reject(new Error("Ciclo cancelado por nova abertura."));
          }
          return this.relayPreparedMessage(sock, jid, fullMessage);
        })
      );

      let confirmed = 0;
      results.forEach((result, index) => {
        const messageNumber = index + 1;
        if (result.status === "fulfilled") {
          confirmed += 1;
          this.logger.success(`Mensagem alvo ${messageNumber} enviada na rajada instantânea.`);
          return;
        }

        const message = this.getErrorMessage(result.reason);
        this.logger.warning(`Mensagem alvo ${messageNumber} falhou na rajada instantânea: ${message}`);
        if (message.toLowerCase().includes("not-acceptable")) {
          void this.diagnoseNotAcceptable(jid, cycleId);
        }
      });

      if (confirmed === mensagens.length) {
        this.logger.success(`Disparo instantâneo concluído em ${Date.now() - startedAt}ms: ${confirmed}/${mensagens.length}.`);
      } else {
        this.logger.warning(`Disparo instantâneo terminou com atenção em ${Date.now() - startedAt}ms: ${confirmed}/${mensagens.length}.`);
      }

      this.emitSnapshot();
    } catch (error) {
      this.logger.error(`Erro inesperado no disparo agressivo: ${this.getErrorMessage(error)}`);
    }
  }

  private async sendSingleInstant(sock: any, jid: string, mensagem: string, cycleId: number) {
    if (cycleId !== this.sendCycleId) return false;

    try {
      await this.relayPreparedTextMessage(sock, jid, mensagem, 0);
      this.logger.success(`Mensagem 1 confirmada: ${mensagem}`);
      return true;
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.logger.warning(`Mensagem 1 falhou no tiro instantâneo (${message}). Retentando...`);

      if (!this.isRetryableSendError(message)) {
        this.logger.error(`Erro ao enviar mensagem 1: ${message}`);
        return false;
      }

      return this.sendMessageWithRetry(jid, mensagem, 1, cycleId, true);
    }
  }

  private async sendBurstMessage(
    jid: string,
    mensagem: string,
    messageNumber: number,
    cycleId: number,
    initialDelay: number
  ) {
    if (initialDelay > 0) {
      await this.delay(initialDelay);
    }

    if (cycleId !== this.sendCycleId) return false;

    const sent = await this.sendMessageWithRetry(jid, mensagem, messageNumber, cycleId);
    if (!sent) {
      this.logger.warning(
        `Mensagem ${messageNumber} não confirmou mesmo na rajada instantânea.`
      );
    }

    return sent;
  }

  private async relayTextMessage(sock: any, jid: string, mensagem: string) {
    const fullMessage = this.buildRelayTextMessage(sock, jid, mensagem);
    await this.relayPreparedMessage(sock, jid, fullMessage);
    return fullMessage;
  }

  private async relayPreparedTextMessage(sock: any, jid: string, mensagem: string, index: number) {
    const fullMessage = this.preparedRelayMessages[index] || this.buildRelayTextMessage(sock, jid, mensagem);
    await this.relayPreparedMessage(sock, jid, fullMessage);
    return fullMessage;
  }

  private buildRelayTextMessage(sock: any, jid: string, mensagem: string) {
    const messageId = generateMessageIDV2(sock.user?.id);
    return generateWAMessageFromContent(
      jid,
      { conversation: mensagem },
      {
        userJid: sock.user?.id,
        messageId,
        timestamp: new Date()
      }
    );
  }

  private async relayPreparedMessage(sock: any, jid: string, fullMessage: any) {
    await sock.relayMessage(jid, fullMessage.message, {
      messageId: fullMessage.key.id,
      useCachedGroupMetadata: true
    });
  }

  private montarMensagens() {
    const { nomeEnvio, codigosMensagensAlvo, codigosMensagensTeste } = this.configStore.load();
    this.mensagensProntasAlvo = (codigosMensagensAlvo || [])
      .map((codigo) => `${nomeEnvio} ${codigo}`)
      .filter(Boolean);
    this.mensagensProntasTeste = (codigosMensagensTeste || [])
      .map((codigo) => `${nomeEnvio} ${codigo}`)
      .filter(Boolean);
  }

  private syncMessagesFromConfig() {
    // reload messages from config for both alvo and teste
    this.montarMensagens();
  }

  private prepareSendPlan() {
    const config = this.configStore.load();
    this.syncMessagesFromConfig();

    this.preparedTargetJid = config.grupoAlvoJid;
    this.preparedMessages = [...this.mensagensProntasAlvo];

    if (this.preparedMessages.length > MAX_OUTGOING_MESSAGES) {
      this.preparedMessages = this.preparedMessages.slice(0, MAX_OUTGOING_MESSAGES);
      this.logger.warning(
        `Limite máximo de ${MAX_OUTGOING_MESSAGES} mensagens ativo. As duas primeiras mensagens serão preparadas para envio.`
      );
    }

    this.preparedRelayMessages =
      this.sock && this.preparedTargetJid
        ? this.preparedMessages.map((mensagem) => this.buildRelayTextMessage(this.sock, this.preparedTargetJid, mensagem))
        : [];

    return Boolean(this.preparedTargetJid && this.preparedMessages.length);
  }

  private resetWarmupState() {
    this.warmupMessagesSent = 0;
    this.warmupCompleted = false;
    this.emitSnapshot();
  }

  private async sendMessageWithRetry(
    jid: string,
    mensagem: string,
    messageNumber: number,
    cycleId: number,
    skipInstantAttempt = false
  ) {
    const delays = [15, 25, 40, 65, 95, 140, 210, 320, 480, 720, 1100, 1700, 2600];

    for (let attempt = skipInstantAttempt ? 1 : 0; attempt <= delays.length; attempt += 1) {
      if (cycleId !== this.sendCycleId) {
        this.logger.warning(`Mensagem ${messageNumber} cancelada porque começou outro ciclo de abertura.`);
        return false;
      }

      if (attempt > 0) {
        await this.delay(delays[attempt - 1]);
      }

      if (cycleId !== this.sendCycleId) {
        this.logger.warning(`Mensagem ${messageNumber} cancelada porque começou outro ciclo de abertura.`);
        return false;
      }

      try {
        if (attempt > 0) {
          this.logger.info(`Tentando novamente mensagem ${messageNumber} (${attempt + 1}/${delays.length + 1}).`);
        }

        await this.relayTextMessage(this.sock, jid, mensagem);
        this.logger.success(`Mensagem ${messageNumber} confirmada: ${mensagem}`);
        return true;
      } catch (error) {
        const message = this.getErrorMessage(error);

        if (!this.isRetryableSendError(message) || attempt === delays.length) {
          this.logger.error(`Erro ao enviar mensagem ${messageNumber}: ${message}`);
          if (message.toLowerCase().includes("not-acceptable")) {
            void this.diagnoseNotAcceptable(jid, cycleId);
          }
          return false;
        }

        this.logger.warning(`WhatsApp ainda não aceitou mensagem ${messageNumber} (${message}). Retentando...`);
        if (message.toLowerCase().includes("not-acceptable") && attempt === 0) {
          void this.diagnoseNotAcceptable(jid, cycleId);
        }
      }
    }

    return false;
  }

  private isRetryableSendError(errorMessage: string) {
    const normalizedMessage = errorMessage.toLowerCase();
    return (
      normalizedMessage.includes("not-acceptable") ||
      normalizedMessage.includes("timed out") ||
      normalizedMessage.includes("timeout") ||
      normalizedMessage.includes("temporarily")
    );
  }

  private startHealthCheck() {
    this.clearHealthCheckTimer();
    this.healthCheckTimer = setInterval(() => {
      void this.runHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private async runHealthCheck() {
    if (!this.monitoringEnabled || this.status !== "connected" || !this.sock) return;

    try {
      await this.prewarmConnection();
    } catch (error) {
      this.logger.warning(`Health check falhou: ${this.getErrorMessage(error)}. Reiniciando conexão.`);
      await this.restart();
    }
  }

  private async prewarmConnection(message?: string) {
    if (!this.sock || this.status !== "connected") return false;

    const config = this.configStore.load();
    if (!config.grupoAlvoJid) return false;

    if (message) this.logger.info(message);

    this.syncMessagesFromConfig();
    const metadata = await this.refreshGroupMetadata(config.grupoAlvoJid);
    if (metadata?.announce === true) {
      this.groupState = "closed";
    } else if (metadata?.announce === false) {
      this.groupState = "open";
    }
    const currentUserIds = this.getCurrentUserIds();
    const currentUserNumbers = currentUserIds.map((id) => id.split(":")[0].split("@")[0]).filter(Boolean);
    const participant = metadata?.participants?.find((item: any) => {
      const id = String(item.id || "");
      const number = id.split(":")[0].split("@")[0];
      return currentUserIds.includes(id) || currentUserNumbers.includes(number);
    });

    if (!participant) {
      this.currentUserInTargetGroup = false;
      this.logger.warning("A conta conectada não apareceu na lista do grupo alvo. Verifique se ela ainda está no grupo.");
      return false;
    }

    this.currentUserInTargetGroup = true;
    return true;
  }

  private getReadinessChecks(): BotReadinessCheck[] {
    const config = this.configStore.load();

    return [
      {
        id: "whatsapp",
        label: "WhatsApp conectado",
        ok: this.status === "connected"
      },
      {
        id: "test_group",
        label: "Grupo de teste configurado",
        ok: Boolean(config.grupoTesteJid)
      },
      {
        id: "group",
        label: "Grupo configurado",
        ok: Boolean(config.grupoAlvoJid)
      },
      {
        id: "participant",
        label: "Conta confirmada no grupo",
        ok: this.currentUserInTargetGroup
      },
      {
        id: "messages",
        label: "Mensagens prontas",
        ok: this.hasReadyMessages()
      },
      {
        id: "group_state",
        label: "Estado do grupo validado",
        ok: this.groupState !== "unknown"
      },
      {
        id: "armed",
        label: "Bot armado para disparar",
        ok: this.monitoringEnabled
      }
    ];
  }

  private hasReadyMessages() {
    const config = this.configStore.load();
    return (config.codigosMensagensAlvo || []).some((item) => item.trim());
  }

  private async waitUntilGroupAcceptsMessages(jid: string, cycleId: number) {
    const checks = [0, 60, 90, 120, 180, 240, 320, 420, 560];

    for (const wait of checks) {
      if (cycleId !== this.sendCycleId) return false;
      if (wait > 0) await this.delay(wait);

      try {
        const metadata = await this.refreshGroupMetadata(jid);
        if (metadata?.announce === false) return true;
      } catch {
        return true;
      }
    }

    this.logger.warning("O evento de abertura chegou, mas o servidor ainda pode estar atualizando o grupo.");
    return false;
  }

  private async diagnoseNotAcceptable(jid: string, cycleId: number) {
    if (this.diagnosedNotAcceptableCycles.has(cycleId)) return;
    this.diagnosedNotAcceptableCycles.add(cycleId);

    try {
      const metadata = await this.refreshGroupMetadata(jid);
      const currentUserIds = this.getCurrentUserIds();
      const currentUserNumbers = currentUserIds.map((id) => id.split(":")[0].split("@")[0]).filter(Boolean);
      const participant = metadata?.participants?.find((item: any) => {
        const id = String(item.id || "");
        const number = id.split(":")[0].split("@")[0];
        return currentUserIds.includes(id) || currentUserNumbers.includes(number);
      });

      const groupState = metadata?.announce === false ? "aberto para todos" : "fechado/somente admins";
      const participantState = participant
        ? `conta encontrada no grupo (${participant.admin || "membro"})`
        : "conta não encontrada na lista de participantes";

      this.logger.warning(
        `Diagnóstico not-acceptable: WhatsApp informa grupo ${groupState}; ${participantState}.`
      );

      if (metadata?.announce !== false) {
        this.logger.error(
          "O WhatsApp ainda está vendo o grupo como fechado no momento do disparo. Nesse estado o servidor recusa a mensagem."
        );
      }
    } catch (error) {
      this.logger.warning(`Não consegui diagnosticar o grupo após not-acceptable: ${this.getErrorMessage(error)}`);
    }
  }

  private isInvalidSession(statusCode?: number, errorMessage = "") {
    const normalizedMessage = errorMessage.toLowerCase();

    return [
      DisconnectReason.loggedOut,
      DisconnectReason.badSession,
      DisconnectReason.connectionReplaced,
      DisconnectReason.multideviceMismatch
    ].includes(statusCode) ||
      normalizedMessage.includes("logged out") ||
      normalizedMessage.includes("bad session") ||
      normalizedMessage.includes("connection replaced") ||
      normalizedMessage.includes("multidevice mismatch") ||
      normalizedMessage.includes("invalid");
  }

  private hasAuthSession() {
    return fs.existsSync(path.join(this.authDir, "creds.json"));
  }

  private async logoutAndClearSession() {
    if (this.sock) {
      try {
        this.logger.info("Solicitando logout ao WhatsApp para remover este dispositivo conectado...");
        await this.sock.logout?.();
        this.logger.success("Logout solicitado ao WhatsApp.");
      } catch (error) {
        this.logger.warning(
          `Não foi possível confirmar logout no WhatsApp: ${this.getErrorMessage(error)}. Limpando sessão local mesmo assim.`
        );
      }
    }

    if (this.isRunning()) {
      await this.stop();
    } else {
      this.monitoringEnabled = false;
      this.clearReconnectTimer();
      this.clearHealthCheckTimer();
    }

    this.pairingCode = "";
    this.pairingCodeRequested = false;
    this.removeAuthDir();
    this.groupState = "unknown";
    this.currentUserInTargetGroup = false;
    this.preparedTargetJid = "";
    this.preparedMessages = [];
    this.preparedRelayMessages = [];
  }

  private isFatalRuntimeError(errorMessage = "") {
    const normalizedMessage = errorMessage.toLowerCase();
    return (
      normalizedMessage.includes("crypto is not defined") ||
      normalizedMessage.includes("referenceerror")
    );
  }

  private async getWhatsAppVersion() {
    try {
      await loadBaileys();
      const { version } = await fetchLatestBaileysVersion();
      return version;
    } catch (error) {
      this.logger.warning(
        `Não foi possível consultar a versão mais recente do WhatsApp Web: ${this.getErrorMessage(error)}`
      );
      return undefined;
    }
  }

  private getDisconnectDescription(statusCode?: number, errorMessage = "") {
    const code = statusCode || "desconhecido";
    const message = errorMessage && errorMessage !== "undefined" ? ` Erro: ${errorMessage}` : "";
    return `Código: ${code}.${message}`;
  }

  private getCurrentUserIds() {
    return [
      this.sock?.user?.id,
      this.sock?.user?.lid,
      this.sock?.authState?.creds?.me?.id,
      this.sock?.authState?.creds?.me?.lid
    ]
      .map((id) => String(id || ""))
      .filter(Boolean);
  }

  private async refreshGroupMetadata(jid: string) {
    try {
      const metadata = await this.sock.groupMetadata(jid);
      if (metadata) {
        this.groupMetadataCache.set(jid, metadata);
      }

      return metadata;
    } catch (error) {
      const message = this.getErrorMessage(error);
      if (message.toLowerCase().includes("item-not-found")) {
        this.logger.warning("Grupo salvo não foi encontrado pelo WhatsApp. Atualize a lista e salve o grupo novamente.");
        return undefined;
      }

      throw error;
    }
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRunning() {
    return Boolean(this.sock) || ["connecting", "connected", "waiting_qr", "reconnecting"].includes(this.status);
  }

  private removeAuthDir() {
    try {
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
      }
    } catch (error) {
      this.logger.error(`Erro ao apagar auth: ${this.getErrorMessage(error)}`);
    }
  }

  private setStatus(status: BotStatus) {
    this.status = status;
    this.emitSnapshot();
  }

  private emitSnapshot() {
    this.emit("snapshot", this.getSnapshot());
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private clearHealthCheckTimer() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
