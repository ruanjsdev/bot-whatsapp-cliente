import { Boom } from "@hapi/boom";
import P from "pino";
import fs from "fs";
import path from "path";
import { webcrypto } from "crypto";
import { EventEmitter } from "events";
import { ConfigStore } from "./config";
import { resolveGroup, normalizarTexto } from "./group";
import { BotLogger } from "./logger";
import { BotConfig, BotGroup, BotSnapshot, BotStatus } from "../shared/types";

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

const baileys = require("@whiskeysockets/baileys");
const makeWASocket = baileys.default || baileys;
const DisconnectReason = baileys.DisconnectReason;
const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
const useMultiFileAuthState = baileys.useMultiFileAuthState;

type BotServiceOptions = {
  authDir?: string;
  configPath?: string;
  terminalMode?: boolean;
  initialCodes?: string[];
};

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 3500;

export class BotService extends EventEmitter {
  private sock: any;
  private status: BotStatus = "disconnected";
  private qrCode = "";
  private error = "";
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;
  private starting?: Promise<void>;
  private activeConnectionId = 0;
  private qrReceivedInCurrentConnection = false;
  private unknownDisconnects = 0;
  private mensagemJaEnviadaNestaAbertura = false;
  private sendCycleId = 0;
  private monitoringEnabled = false;
  private estadoInicialDoGrupoCapturado = false;
  private grupoJaFechouDepoisDoInicio = false;
  private diagnosedNotAcceptableCycles = new Set<number>();
  private codigosEscolhidos: string[] = [];
  private mensagensProntas: string[] = [];
  private configStore: ConfigStore;
  private logger: BotLogger;
  private authDir: string;
  private groupMetadataCache = new Map<string, any>();
  private groups: BotGroup[] = [];

  constructor(options: BotServiceOptions = {}) {
    super();
    this.authDir = options.authDir || path.resolve(process.cwd(), "auth_info");
    this.configStore = new ConfigStore(options.configPath);
    this.logger = new BotLogger(() => this.emitSnapshot());
    const config = this.configStore.load();
    this.codigosEscolhidos = options.initialCodes?.length
      ? options.initialCodes
      : config.codigosMensagens;
    this.montarMensagens();
  }

getSnapshot(): BotSnapshot {
  return {
    status: this.status,
    qrCode: this.qrCode,
    config: this.configStore.load(),
    groups: this.groups,
    logs: this.logger.all(),
    error: this.error,
    monitoringEnabled: this.monitoringEnabled  
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

    await this.captureInitialGroupState();
    this.monitoringEnabled = true;
    this.logger.success("✅ Bot ARMADO - Monitoramento ativado. Aguardando abertura do grupo...");
    this.emitSnapshot();
    return true;
  }

  disableMonitoring(): void {
    this.monitoringEnabled = false;
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
    if (!this.isRunning()) {
      this.logger.warning("Não é possível parar: o bot ainda não foi iniciado.");
      return;
    }

    this.stopping = true;
    this.activeConnectionId += 1;
    this.clearReconnectTimer();
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
    this.setStatus("disconnected");
    this.logger.info("Bot parado.");
  }

  async restart() {
    if (!this.isRunning()) {
      this.logger.warning("Não há conexão ativa para reiniciar. Use Conectar WhatsApp.");
      return;
    }

    this.logger.info("Reiniciando conexão...");
    await this.stop();
    await this.start();
  }

  async clearSession() {
    await this.stop();
    this.removeAuthDir();
    this.qrCode = "";
    this.error = "";
    this.logger.warning("Sessão/auth apagada. Gerando um novo QR Code.");
    this.emitSnapshot();
    await this.start();
  }

  async saveGroup(group: string, groupId?: string, groupName?: string) {
    const config = groupId
      ? this.configStore.saveGroupById(groupId, groupName || group)
      : this.configStore.saveGroup(group);
    this.logger.success(`Grupo alterado para: ${config.grupoAlvoNome || config.grupoAlvoJid}`);

    if (this.sock && this.status === "connected") {
      await this.resolveConfiguredGroup();
    }

    this.emitSnapshot();
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
    this.codigosEscolhidos = codes.map((item) => item.trim().toUpperCase()).filter(Boolean);
    this.montarMensagens();
    this.configStore.save({ codigosMensagens: this.codigosEscolhidos });
    this.mensagemJaEnviadaNestaAbertura = false;
    this.logger.success("Mensagens atualizadas.");
  }

  setMessageSettings(senderName: string, codes: string[]) {
    this.codigosEscolhidos = codes.map((item) => item.trim().toUpperCase()).filter(Boolean);
    this.configStore.save({
      nomeEnvio: senderName.trim(),
      codigosMensagens: this.codigosEscolhidos
    });
    this.montarMensagens();
    this.mensagemJaEnviadaNestaAbertura = false;
    this.logger.success(
      `Nome e mensagens atualizados: ${this.codigosEscolhidos.length} mensagens prontas (${this.codigosEscolhidos.join(", ")}).`
    );
  }

  resetSendingLock() {
    this.mensagemJaEnviadaNestaAbertura = false;
    this.logger.info("Envio resetado. O bot pode enviar novamente.");
  }

  private async connect() {
    const connectionId = ++this.activeConnectionId;
    this.qrReceivedInCurrentConnection = false;
    this.estadoInicialDoGrupoCapturado = false;
    this.grupoJaFechouDepoisDoInicio = false;
    this.mensagemJaEnviadaNestaAbertura = false;
    this.monitoringEnabled = false;
    this.clearReconnectTimer();
    this.setStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");
    this.error = "";
    this.logger.info(this.reconnectAttempts > 0 ? "Tentando reconectar..." : "Bot iniciado.");

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const version = await this.getWhatsAppVersion();

    this.sock = makeWASocket({
      auth: state,
      version,
      logger: P({ level: "silent" }),
      printQRInTerminal: false,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      browser: ["Bot Rota Rapida", "Chrome", "1.0.0"],
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
    }

    if (connection === "open") {
      this.unknownDisconnects = 0;
      this.reconnectAttempts = 0;
      this.qrCode = "";
      this.setStatus("connected");
      this.logger.success("WhatsApp conectado.");

      try {
        await this.loadGroups();
        await this.resolveConfiguredGroup();
        this.logger.info("Aguardando abertura do grupo.");
      } catch (error) {
        this.error = this.getErrorMessage(error);
        this.setStatus("error");
        this.logger.error(this.error);
      }
    }

    if (connection === "close") {
      this.sock = undefined;
      if (this.stopping) return;

      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const errorMessage = this.getErrorMessage(lastDisconnect?.error);
      const disconnectDescription = this.getDisconnectDescription(statusCode, errorMessage);

      if (this.isFatalRuntimeError(errorMessage)) {
        this.error = `Erro interno ao iniciar WhatsApp: ${errorMessage}`;
        this.setStatus("error");
        this.logger.error(this.error);
        return;
      }

      if (this.isInvalidSession(statusCode, errorMessage)) {
        this.logger.warning(
          `Sessão inválida ou logout detectado (${statusCode || "sem código"}). Limpando auth para gerar novo QR Code.`
        );
        this.removeAuthDir();
        this.reconnectAttempts = 0;
        this.scheduleReconnect(true);
        return;
      }

      if (!statusCode) {
        this.unknownDisconnects += 1;

        if (
          this.hasAuthSession() &&
          !this.qrReceivedInCurrentConnection &&
          this.unknownDisconnects >= 2
        ) {
          this.logger.warning(
            "A sessão local fechou sem motivo claro antes de conectar. Limpando auth para gerar um QR Code novo."
          );
          this.removeAuthDir();
          this.reconnectAttempts = 0;
          this.unknownDisconnects = 0;
          this.scheduleReconnect(true);
          return;
        }
      }

      this.logger.warning(`WhatsApp desconectado. ${disconnectDescription}.`);
      this.scheduleReconnect(false);
    }
  }

  private async resolveConfiguredGroup() {
    const config = this.configStore.load();
    const group = await resolveGroup(this.sock, {
      jid: config.grupoAlvoJid,
      name: config.grupoAlvoNome
    });

    if (!group.jid) {
      this.logger.warning("Nenhum grupo configurado. Informe o nome ou ID na interface.");
      return;
    }

    const nextConfig: BotConfig = this.configStore.save({
      grupoAlvoJid: group.jid,
      grupoAlvoNome: group.name
    });

    await this.refreshGroupMetadata(nextConfig.grupoAlvoJid);

    this.logger.success(`Grupo configurado: ${nextConfig.grupoAlvoNome}`);
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

      const metadata = await this.sock.groupMetadata(config.grupoAlvoJid);
      if (!metadata) return;

      const isGroupClosed = metadata.announce === true;
      
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

    if (!forceNewQr && this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
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
        this.grupoJaFechouDepoisDoInicio = true;
        this.sendCycleId += 1;
        this.mensagemJaEnviadaNestaAbertura = false;
        this.logger.info("🔒 Grupo FECHADO. Bot armado para próxima abertura.");
        return;
      }

      if (update.announce === false) {
        if (!this.grupoJaFechouDepoisDoInicio) {
          this.logger.info("⚠️ Grupo já estava aberto desde o início. Aguardando próximo ciclo de fechamento e reabertura...");
          return;
        }

        const cycleId = ++this.sendCycleId;
        this.grupoJaFechouDepoisDoInicio = false;
        this.logger.info("⚡ GRUPO ABRIU! Disparando mensagens...");
        this.enviarMensagensRapidas(cycleId);
        return;
      }
    }
  }
  private handleMessages(messages: any[], connectionId: number) {
    if (connectionId !== this.activeConnectionId) return;
    if (!this.monitoringEnabled) return;

    const msg = messages?.[0];
    const config = this.configStore.load();

    if (!msg?.message || !msg.key?.remoteJid || !config.grupoAlvoJid) return;
    if (msg.key.remoteJid !== config.grupoAlvoJid) return;

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      "";

    if (!texto) return;

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
      this.logger.info("Palavra de abertura detectada após fechamento. Disparando mensagens.");
      this.enviarMensagensRapidas(cycleId);
    }
  }
  private enviarMensagensRapidas(cycleId: number) {
    const config = this.configStore.load();
    this.syncMessagesFromConfig();

    if (!config.grupoAlvoJid) {
      this.logger.error("Grupo alvo ainda não foi configurado.");
      return;
    }

    if (!this.mensagensProntas.length) {
      this.logger.error("Nenhuma mensagem está pronta.");
      return;
    }

    if (this.mensagemJaEnviadaNestaAbertura) {
      this.logger.warning("Já enviei nesta abertura. Bloqueando duplicidade.");
      return;
    }

    this.mensagemJaEnviadaNestaAbertura = true;
    const mensagens = [...this.mensagensProntas];

    mensagens.forEach((mensagem, index) => {
      setTimeout(() => {
        if (cycleId !== this.sendCycleId) return;
        this.sendMessageWithRetry(config.grupoAlvoJid, mensagem, index + 1, cycleId).catch((error) =>
          this.logger.error(`Erro inesperado no envio ${index + 1}: ${this.getErrorMessage(error)}`)
        );
      }, index * 80);
    });

    this.logger.info(
      `Modo ultra rápido: ${mensagens.length} mensagens separadas disparadas com intervalo de 40ms: ${mensagens.join(" | ")}`
    );
  }

  private montarMensagens() {
    const { nomeEnvio } = this.configStore.load();
    this.mensagensProntas = this.codigosEscolhidos.map((codigo) => `${nomeEnvio} ${codigo}`);
  }

  private syncMessagesFromConfig() {
    const config = this.configStore.load();
    this.codigosEscolhidos = config.codigosMensagens;
    this.montarMensagens();
  }

  private async sendMessageWithRetry(
    jid: string,
    mensagem: string,
    messageNumber: number,
    cycleId: number
  ) {
    const delays = [100, 120, 160, 240, 320, 520, 760, 1100, 1600, 2400, 3200, 6400];

    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
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

        await this.sock.sendMessage(jid, { text: mensagem });
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

  private isFatalRuntimeError(errorMessage = "") {
    const normalizedMessage = errorMessage.toLowerCase();
    return (
      normalizedMessage.includes("crypto is not defined") ||
      normalizedMessage.includes("referenceerror")
    );
  }

  private async getWhatsAppVersion() {
    try {
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
    const metadata = await this.sock.groupMetadata(jid);
    if (metadata) {
      this.groupMetadataCache.set(jid, metadata);
    }

    return metadata;
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

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
