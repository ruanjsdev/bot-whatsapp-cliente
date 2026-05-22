import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  generateMessageIDV2,
  generateWAMessageFromContent
} from "@whiskeysockets/baileys";

import P from "pino";
import qrcode from "qrcode-terminal";
import { Boom } from "@hapi/boom";
import readline from "readline";
import fs from "fs";

const MEU_NOME_COMPLETO = "Alan da Silva Alves";
const CONFIG_PATH = "config.json";

type BotConfig = {
  grupoAlvoJid?: string;
  grupoAlvoNome?: string;
};

let GRUPO_ALVO_JID = "";
let GRUPO_ALVO_NOME = "";

let codigosEscolhidos: string[] = [];
let mensagensProntas: string[] = [];

let mensagemJaEnviadaNestaAbertura = false;
let terminalIniciado = false;
let grupoEstadoAtual: boolean | null = null;

function normalizarTexto(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function montarMensagens() {
  mensagensProntas = codigosEscolhidos.map(
    (codigo) => `${MEU_NOME_COMPLETO} ${codigo}`
  );
}

function carregarConfig(): BotConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {};
  }

  try {
    const conteudo = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(conteudo);
  } catch {
    return {};
  }
}

function salvarConfig(config: BotConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function apagarConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    fs.unlinkSync(CONFIG_PATH);
  }
}

function perguntarNoTerminal(pergunta: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(pergunta, (resposta) => {
      rl.close();
      resolve(resposta.trim());
    });
  });
}

async function escolherMensagensIniciais() {
  console.clear();

  console.log("======================================");
  console.log("⚡ BOT DE ROTA ULTRA RÁPIDA");
  console.log("======================================");
  console.log("");

  let quantidade = 0;

  while (!quantidade || quantidade < 1) {
    const resposta = await perguntarNoTerminal(
      "Quantas mensagens vai enviar? Exemplo: 1, 2, 3: "
    );

    quantidade = Number(resposta);

    if (!quantidade || quantidade < 1) {
      console.log("❌ Digite uma quantidade válida. Exemplo: 1 ou 2");
      quantidade = 0;
      continue;
    }

    if (quantidade > 20) {
      console.log("⚠️ Por segurança, use no máximo 20 mensagens.");
      quantidade = 0;
      continue;
    }
  }

  codigosEscolhidos = [];

  for (let i = 1; i <= quantidade; i++) {
    let codigo = "";

    while (!codigo) {
      codigo = await perguntarNoTerminal(
        `Digite o código/rota da mensagem ${i}. Exemplo: F-14: `
      );

      if (!codigo) {
        console.log("❌ Digite um código válido.");
        continue;
      }

      codigo = codigo.toUpperCase();
    }

    codigosEscolhidos.push(codigo);
  }

  montarMensagens();

  console.log("");
  console.log("✅ Mensagens prontas:");
  mensagensProntas.forEach((mensagem, index) => {
    console.log(`${index + 1}. ${mensagem}`);
  });
  console.log("");
}

async function escolherGrupoPeloTerminal(sock: any): Promise<BotConfig> {
  console.log("⚠️ Nenhum grupo configurado ainda.");
  console.log("🔎 Buscando grupos do WhatsApp...");
  console.log("");

  const grupos = await sock.groupFetchAllParticipating();
  const listaGrupos = Object.values(grupos) as any[];

  if (!listaGrupos.length) {
    throw new Error("Nenhum grupo encontrado nesse WhatsApp.");
  }

  listaGrupos.sort((a, b) => {
    const nomeA = normalizarTexto(a.subject || "");
    const nomeB = normalizarTexto(b.subject || "");
    return nomeA.localeCompare(nomeB);
  });

  console.log("Escolha o grupo onde o bot deve enviar:");
  console.log("");

  listaGrupos.forEach((grupo, index) => {
    console.log(`[${index + 1}] ${grupo.subject}`);
  });

  console.log("");

  while (true) {
    const resposta = await perguntarNoTerminal("Digite o número do grupo: ");
    const numero = Number(resposta);

    if (!numero || numero < 1 || numero > listaGrupos.length) {
      console.log("❌ Número inválido. Tente novamente.");
      continue;
    }

    const grupoEscolhido = listaGrupos[numero - 1];

    return {
      grupoAlvoJid: grupoEscolhido.id,
      grupoAlvoNome: grupoEscolhido.subject || "Grupo sem nome"
    };
  }
}

async function configurarGrupoSeNecessario(sock: any) {
  const config = carregarConfig();

  if (config.grupoAlvoJid) {
    GRUPO_ALVO_JID = config.grupoAlvoJid;
    GRUPO_ALVO_NOME = config.grupoAlvoNome || "Grupo salvo";

    console.log("✅ Grupo carregado do config.json:");
    console.log(GRUPO_ALVO_NOME);
    console.log(GRUPO_ALVO_JID);
    console.log("");
    
    await inicializarEstadoDoGrupo(sock);
    return;
  }

  const novoConfig = await escolherGrupoPeloTerminal(sock);

  salvarConfig(novoConfig);

  GRUPO_ALVO_JID = novoConfig.grupoAlvoJid || "";
  GRUPO_ALVO_NOME = novoConfig.grupoAlvoNome || "Grupo salvo";

  console.log("");
  console.log("✅ Grupo configurado e salvo com sucesso:");
  console.log(GRUPO_ALVO_NOME);
  console.log(GRUPO_ALVO_JID);
  console.log("");
  
  await inicializarEstadoDoGrupo(sock);
}

async function enviarMensagensRapidas(sock: any) {
  if (!GRUPO_ALVO_JID) {
    console.log("❌ Grupo alvo ainda não foi configurado.");
    return;
  }

  if (!mensagensProntas.length) {
    console.log("❌ Nenhuma mensagem está pronta.");
    return;
  }

  if (mensagemJaEnviadaNestaAbertura) {
    console.log("⚠️ Já enviei nesta abertura. Bloqueando duplicidade.");
    return;
  }

  mensagemJaEnviadaNestaAbertura = true;

  console.log("⚡ DISPARANDO MENSAGENS O MAIS RÁPIDO POSSÍVEL:");
  console.log("");

  for (const [index, mensagem] of mensagensProntas.entries()) {
    const messageNumber = index + 1;

    try {
      await relayTextMessage(sock, GRUPO_ALVO_JID, mensagem);
      console.log(`✅ Mensagem ${messageNumber} confirmada:`);
      console.log(mensagem);
      console.log("");
    } catch (error: any) {
      console.log(`❌ Erro ao enviar mensagem ${messageNumber}:`);
      console.log(error);
      console.log("");
    }

    console.log(`🚀 Disparada ${messageNumber}: ${mensagem}`);
  }

  console.log("");
}

async function relayTextMessage(sock: any, jid: string, mensagem: string) {
  const messageId = generateMessageIDV2(sock.user?.id);
  const fullMessage = generateWAMessageFromContent(
    jid,
    { conversation: mensagem },
    {
      userJid: sock.user?.id,
      messageId,
      timestamp: new Date()
    }
  );

  await sock.relayMessage(jid, fullMessage.message, {
    messageId: fullMessage.key.id,
    useCachedGroupMetadata: true
  });

  return fullMessage;
}

async function reconfigurarMensagens() {
  let quantidade = 0;

  while (!quantidade || quantidade < 1) {
    const resposta = await perguntarNoTerminal(
      "Quantas mensagens vai enviar? Exemplo: 1, 2, 3: "
    );

    quantidade = Number(resposta);

    if (!quantidade || quantidade < 1) {
      console.log("❌ Digite uma quantidade válida.");
      quantidade = 0;
      continue;
    }

    if (quantidade > 20) {
      console.log("⚠️ Por segurança, use no máximo 20 mensagens.");
      quantidade = 0;
      continue;
    }
  }

  codigosEscolhidos = [];

  for (let i = 1; i <= quantidade; i++) {
    let codigo = "";

    while (!codigo) {
      codigo = await perguntarNoTerminal(
        `Digite o código/rota da mensagem ${i}. Exemplo: F-14: `
      );

      if (!codigo) {
        console.log("❌ Digite um código válido.");
        continue;
      }

      codigo = codigo.toUpperCase();
    }

    codigosEscolhidos.push(codigo);
  }

  montarMensagens();
  mensagemJaEnviadaNestaAbertura = false;

  console.log("");
  console.log("✅ Mensagens atualizadas:");
  mensagensProntas.forEach((mensagem, index) => {
    console.log(`${index + 1}. ${mensagem}`);
  });
  console.log("");
}

async function inicializarEstadoDoGrupo(sock: any) {
  try {
    const grupoMetadata = await sock.groupMetadata(GRUPO_ALVO_JID);
    
    if (grupoMetadata) {
      grupoEstadoAtual = grupoMetadata.announce === true;
      
      if (grupoEstadoAtual) {
        console.log("📌 Estado inicial: Grupo FECHADO");
        mensagemJaEnviadaNestaAbertura = true;
      } else {
        console.log("📌 Estado inicial: Grupo ABERTO");
        mensagemJaEnviadaNestaAbertura = false;
      }
    }
  } catch (error) {
    console.log("⚠️ Não foi possível inicializar o estado do grupo:", error);
    grupoEstadoAtual = null;
  }
}

function iniciarComandosDoTerminal(sock: any) {
  if (terminalIniciado) return;
  terminalIniciado = true;

  console.log("Comandos disponíveis:");
  console.log("mensagens       -> escolher novamente quantas mensagens e códigos");
  console.log("codigo 1 F-14   -> troca só o código da mensagem 1");
  console.log("ver             -> mostra as mensagens prontas");
  console.log("grupo           -> mostra o grupo configurado");
  console.log("reconfigurar    -> apaga o grupo salvo e pede para reiniciar");
  console.log("reset           -> libera envio novamente");
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on("line", async (linha) => {
    const comando = linha.trim();
    const comandoNormalizado = normalizarTexto(comando);

    if (!comando) return;

    if (comandoNormalizado === "ver") {
      console.log("");
      console.log("📨 Mensagens prontas:");

      if (!mensagensProntas.length) {
        console.log("Nenhuma mensagem pronta ainda.");
      } else {
        mensagensProntas.forEach((mensagem, index) => {
          console.log(`${index + 1}. ${mensagem}`);
        });
      }

      console.log("");
      return;
    }

    if (comandoNormalizado === "grupo") {
      console.log("");
      console.log("🎯 Grupo configurado:");
      console.log(GRUPO_ALVO_NOME || "Sem nome salvo");
      console.log(GRUPO_ALVO_JID || "Nenhum ID salvo");
      console.log("");
      return;
    }

    if (comandoNormalizado === "reset") {
      mensagemJaEnviadaNestaAbertura = false;
      console.log("");
      console.log("🔄 Envio resetado. O bot pode enviar novamente.");
      console.log("");
      return;
    }

    if (comandoNormalizado === "mensagens") {
      console.log("");
      await reconfigurarMensagens();
      return;
    }

    if (comandoNormalizado === "reconfigurar") {
      apagarConfig();
      console.log("");
      console.log("🗑️ config.json apagado.");
      console.log("Feche o bot com CTRL + C e rode npm run dev novamente para escolher outro grupo.");
      console.log("");
      return;
    }

    if (comandoNormalizado.startsWith("codigo ")) {
      const partes = comando.split(/\s+/);

      const posicao = Number(partes[1]);
      const novoCodigo = partes.slice(2).join(" ").trim();

      if (!posicao || posicao < 1 || posicao > codigosEscolhidos.length) {
        console.log("");
        console.log("❌ Número inválido.");
        console.log("Exemplo: codigo 1 F-14");
        console.log("");
        return;
      }

      if (!novoCodigo) {
        console.log("");
        console.log("❌ Digite o novo código.");
        console.log("Exemplo: codigo 1 F-14");
        console.log("");
        return;
      }

      codigosEscolhidos[posicao - 1] = novoCodigo.toUpperCase();
      montarMensagens();
      mensagemJaEnviadaNestaAbertura = false;

      console.log("");
      console.log(`✅ Código da mensagem ${posicao} alterado para:`);
      console.log(codigosEscolhidos[posicao - 1]);
      console.log("");
      console.log("📨 Mensagens prontas:");
      mensagensProntas.forEach((mensagem, index) => {
        console.log(`${index + 1}. ${mensagem}`);
      });
      console.log("");
      return;
    }

    console.log("❌ Comando não reconhecido.");
    console.log("Use: mensagens, codigo 1 F-14, ver, grupo, reset ou reconfigurar");
    console.log("");
  });
}

async function conectarBot() {
  await escolherMensagensIniciais();

  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    browser: ["Bot Rota Rapida", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update: any) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📱 Escaneie o QR Code com seu WhatsApp:");
      qrcode.generate(qr, { small: true });
      console.log("");
    }

    if (connection === "open") {
      console.log("✅ Bot conectado!");
      console.log("");

      try {
        await configurarGrupoSeNecessario(sock);

        console.log("⚡ Modo ultra rápido ativado.");
        console.log("🎯 Grupo alvo:");
        console.log(GRUPO_ALVO_NOME);
        console.log(GRUPO_ALVO_JID);
        console.log("");
        console.log("📨 Mensagens prontas:");
        mensagensProntas.forEach((mensagem, index) => {
          console.log(`${index + 1}. ${mensagem}`);
        });
        console.log("");
        console.log("👀 Aguardando o grupo abrir...");
        console.log("");

        iniciarComandosDoTerminal(sock);
      } catch (error) {
        console.log("❌ Erro ao configurar grupo:");
        console.log(error);
      }
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const deveReconectar = statusCode !== DisconnectReason.loggedOut;

      console.log("❌ Conexão fechada. Reconectar?", deveReconectar);

      if (deveReconectar) {
        conectarBot();
      } else {
        console.log("⚠️ Sessão encerrada. Apague a pasta auth_info e conecte de novo.");
      }
    }
  });

  sock.ev.on("groups.update", (updates: any[]) => {
    for (const update of updates) {
      if (!update || !update.id) continue;
      if (!GRUPO_ALVO_JID) continue;

      if (update.id !== GRUPO_ALVO_JID) continue;

      const estadoAnnounce = update.announce;
      
      if (estadoAnnounce !== undefined && estadoAnnounce !== null) {
        const grupoFechado = estadoAnnounce === true;
        
        if (grupoFechado && grupoEstadoAtual !== true) {
          grupoEstadoAtual = true;
          mensagemJaEnviadaNestaAbertura = true;
          console.log("🔒 Grupo FECHADO. Bot armado para próxima abertura.");
          return;
        }

        if (!grupoFechado && grupoEstadoAtual !== false) {
          grupoEstadoAtual = false;
          console.log("⚡ GRUPO ABRIU! Disparando agora...");
          enviarMensagensRapidas(sock);
          return;
        }
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages }: any) => {
    const msg = messages?.[0];

    if (!msg || !msg.message || !msg.key.remoteJid) return;
    if (!GRUPO_ALVO_JID) return;

    const jid = msg.key.remoteJid;

    if (jid !== GRUPO_ALVO_JID) return;

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      "";

    if (!texto) return;

    const textoNormalizado = normalizarTexto(texto);

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
      textoNormalizado.includes(normalizarTexto(palavra))
    );

    if (detectouAbertura) {
      console.log("🚨 Palavra de abertura detectada. Disparando...");
      enviarMensagensRapidas(sock);
    }
  });
}

conectarBot();
