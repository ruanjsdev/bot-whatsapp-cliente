import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import qrcode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { BotService } from "./bot/connection";
import { BotSnapshot } from "./shared/types";

const authDir = path.join(process.cwd(), "auth_info");
const pairingPhoneNumber = process.env.BOT_PHONE_NUMBER;
const qrImagePath = path.join(process.cwd(), "whatsapp-qr.png");
const mobileSettingsPath = path.join(process.cwd(), "mobile-settings.json");
let mobilePort = Number(process.env.MOBILE_PORT || process.env.PORT || 3000);

type MobileSettings = {
  hideLogs: boolean;
  confirmDangerousActions: boolean;
};

const DEFAULT_MOBILE_SETTINGS: MobileSettings = {
  hideLogs: false,
  confirmDangerousActions: true
};

if (pairingPhoneNumber && fs.existsSync(authDir)) {
  fs.rmSync(authDir, { recursive: true, force: true });
  console.log("🧹 Sessão antiga removida. Gerando pareamento novo.");
}

const bot = new BotService({
  authDir,
  configPath: path.join(process.cwd(), "config.json"),
  pairingPhoneNumber,
  autoClearInvalidSession: true
});

let lastStatus = "";
let lastMonitoring = false;
let lastPairingCode = "";
let lastError = "";
let lastLogId = "";
let lastQrCode = "";

function printSnapshot(snapshot: BotSnapshot) {
  const lastLog = snapshot.logs?.[snapshot.logs.length - 1];
  const statusChanged =
    snapshot.status !== lastStatus ||
    snapshot.monitoringEnabled !== lastMonitoring ||
    snapshot.pairingCode !== lastPairingCode ||
    snapshot.qrCode !== lastQrCode ||
    (snapshot.error || "") !== lastError ||
    (lastLog?.id || "") !== lastLogId;

  if (!statusChanged) return;

  lastStatus = snapshot.status;
  lastMonitoring = snapshot.monitoringEnabled;
  lastPairingCode = snapshot.pairingCode || "";
  lastQrCode = snapshot.qrCode || "";
  lastError = snapshot.error || "";
  lastLogId = lastLog?.id || "";

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🤖 BOT ROTAS - MODO SERVIDOR");
  console.log("Status:", snapshot.status);
  console.log("Monitoramento:", snapshot.monitoringEnabled ? "ATIVADO" : "DESATIVADO");

  if (snapshot.config?.grupoAlvoNome || snapshot.config?.grupoAlvoJid) {
    console.log("Grupo alvo:", snapshot.config.grupoAlvoNome || snapshot.config.grupoAlvoJid);
  }

  if (snapshot.error) {
    console.log("Erro:", snapshot.error);
  }

  if (snapshot.qrCode) {
    console.log("QR Code gerado. Escaneie pelo WhatsApp no celular.");
    console.log("Arquivo do QR:", qrImagePath);
    qrcodeTerminal.generate(snapshot.qrCode, { small: true });
    qrcode.toFile(qrImagePath, snapshot.qrCode, { width: 420 }).catch((error) => {
      console.log("Falha ao salvar QR em imagem:", error);
    });
  }

  if (snapshot.pairingCode) {
    console.log("Código de pareamento:", snapshot.pairingCode);
  }

  if (lastLog) {
    console.log("Último log:", lastLog.message);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

bot.on("snapshot", printSnapshot);

function sendJson(response: http.ServerResponse, statusCode: number, data: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function sendHtml(response: http.ServerResponse, html: string) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(html);
}

function loadMobileSettings(): MobileSettings {
  try {
    if (!fs.existsSync(mobileSettingsPath)) return { ...DEFAULT_MOBILE_SETTINGS };
    const parsed = JSON.parse(fs.readFileSync(mobileSettingsPath, "utf-8"));
    return {
      hideLogs: Boolean(parsed.hideLogs),
      confirmDangerousActions:
        typeof parsed.confirmDangerousActions === "boolean"
          ? parsed.confirmDangerousActions
          : DEFAULT_MOBILE_SETTINGS.confirmDangerousActions
    };
  } catch {
    return { ...DEFAULT_MOBILE_SETTINGS };
  }
}

function saveMobileSettings(input: Partial<MobileSettings>): MobileSettings {
  const next = {
    ...loadMobileSettings(),
    hideLogs: Boolean(input.hideLogs),
    confirmDangerousActions:
      typeof input.confirmDangerousActions === "boolean"
        ? input.confirmDangerousActions
        : loadMobileSettings().confirmDangerousActions
  };
  fs.writeFileSync(mobileSettingsPath, JSON.stringify(next, null, 2));
  return next;
}

function readJsonBody(request: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error("Payload muito grande."));
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function getLocalAddresses(port: number) {
  const addresses: string[] = [];
  for (const items of Object.values(os.networkInterfaces())) {
    for (const item of items || []) {
      if (item.family === "IPv4" && !item.internal) {
        addresses.push(`http://${item.address}:${port}`);
      }
    }
  }
  return addresses;
}

async function handleAction(action: string, body: any) {
  const getGroupValue = () => {
    if (typeof body.group === "string") return body.group;
    if (body.group && typeof body.group === "object") {
      return String(body.group.name || body.group.id || "");
    }
    return "";
  };

  const getGroupId = () => {
    if (typeof body.groupId === "string" && body.groupId.trim()) return body.groupId;
    if (body.group && typeof body.group === "object" && typeof body.group.id === "string") return body.group.id;
    return undefined;
  };

  const getGroupName = () => {
    if (typeof body.groupName === "string" && body.groupName.trim()) return body.groupName;
    if (body.group && typeof body.group === "object" && typeof body.group.name === "string") return body.group.name;
    return undefined;
  };

  switch (action) {
    case "start":
      await bot.start();
      break;
    case "stop":
      await bot.stop();
      break;
    case "restart":
      await bot.restart();
      break;
    case "clear-session":
      await bot.clearSession();
      break;
    case "factory-reset":
      await bot.factoryReset();
      if (fs.existsSync(qrImagePath)) fs.rmSync(qrImagePath, { force: true });
      if (fs.existsSync(mobileSettingsPath)) fs.rmSync(mobileSettingsPath, { force: true });
      break;
    case "refresh-groups":
      await bot.refreshGroups();
      break;
    case "start-monitoring":
      await bot.enableMonitoring();
      break;
    case "stop-monitoring":
      bot.disableMonitoring();
      break;
    case "warmup":
      await bot.warmupConnection();
      break;
    case "save-group":
      await bot.saveGroup(getGroupValue(), getGroupId(), getGroupName());
      break;
    case "save-test-group":
      await bot.saveTestGroup(getGroupValue(), getGroupId(), getGroupName());
      break;
    case "save-target-messages":
      bot.setMessageSettings(String(body.senderName || ""), Array.isArray(body.codes) ? body.codes : []);
      break;
    case "save-warmup-messages":
      bot.setWarmupMessageSettings(String(body.senderName || ""), Array.isArray(body.codes) ? body.codes : []);
      break;
    default:
      throw new Error(`Ação desconhecida: ${action}`);
  }

  return bot.getSnapshot();
}

function createMobileHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#101820" />
  <link rel="manifest" href="/manifest.json" />
  <title>Bot WhatsApp</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; background: #101820; color: #eef3f7; }
    main { max-width: 760px; margin: 0 auto; padding: 16px; }
    header { position: sticky; top: 0; z-index: 2; margin: -16px -16px 16px; padding: 14px 16px; background: #101820; border-bottom: 1px solid #263440; }
    h1 { margin: 0; font-size: 20px; }
    .sub { margin: 4px 0 0; color: #9fb0bf; font-size: 13px; }
    section { border-top: 1px solid #263440; padding: 16px 0; }
    h2 { margin: 0 0 10px; font-size: 16px; }
    .status { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tile { background: #17232e; border: 1px solid #2a3a47; border-radius: 8px; padding: 10px; min-height: 60px; }
    .label { display: block; color: #9fb0bf; font-size: 12px; margin-bottom: 4px; }
    .value { font-weight: 700; word-break: break-word; }
    .buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button { min-height: 44px; border: 0; border-radius: 8px; padding: 10px; background: #2f80ed; color: white; font-weight: 700; font-size: 14px; }
    button.secondary { background: #263440; }
    button.danger { background: #d94d4d; }
    button.ok { background: #16a34a; }
    button:disabled { opacity: .55; }
    input, textarea { width: 100%; border: 1px solid #2a3a47; border-radius: 8px; background: #0c141b; color: #eef3f7; padding: 11px; font: inherit; }
    textarea { min-height: 110px; resize: vertical; }
    .form { display: grid; gap: 8px; }
    .qr { display: grid; place-items: center; background: white; border-radius: 8px; padding: 10px; }
    .qr img { width: min(100%, 320px); height: auto; display: block; }
    .hidden { display: none; }
    .logs { display: grid; gap: 6px; max-height: 280px; overflow: auto; }
    .log { padding: 8px; border-radius: 8px; background: #17232e; border-left: 4px solid #556575; font-size: 13px; }
    .success { border-left-color: #16a34a; }
    .warning { border-left-color: #f59e0b; }
    .error { border-left-color: #d94d4d; }
    .msg { margin-top: 10px; min-height: 20px; color: #9fb0bf; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Bot WhatsApp</h1>
      <p class="sub">Painel mobile</p>
    </header>

    <section>
      <div class="status">
        <div class="tile"><span class="label">WhatsApp</span><span id="status" class="value">...</span></div>
        <div class="tile"><span class="label">Monitoramento</span><span id="monitoring" class="value">...</span></div>
        <div class="tile"><span class="label">Grupo alvo</span><span id="targetGroup" class="value">...</span></div>
        <div class="tile"><span class="label">Grupo</span><span id="groupState" class="value">...</span></div>
      </div>
      <p id="error" class="msg"></p>
    </section>

    <section id="qrSection" class="hidden">
      <h2>Conectar WhatsApp</h2>
      <div class="qr"><img id="qrImage" alt="QR Code do WhatsApp" /></div>
    </section>

    <section>
      <h2>Controles</h2>
      <div class="buttons">
        <button onclick="action('start')">Conectar</button>
        <button class="secondary" onclick="action('stop')">Desconectar</button>
        <button class="secondary" onclick="action('restart')">Reiniciar</button>
        <button class="danger" onclick="action('clear-session')">Novo QR</button>
        <button class="ok" onclick="action('start-monitoring')">Iniciar bot</button>
        <button class="secondary" onclick="action('stop-monitoring')">Parar bot</button>
        <button class="secondary" onclick="action('refresh-groups')">Atualizar grupos</button>
        <button class="secondary" onclick="action('warmup')">Aquecer teste</button>
      </div>
      <p id="message" class="msg"></p>
    </section>

    <section>
      <h2>Grupos</h2>
      <div class="form">
        <input id="targetInput" placeholder="Grupo alvo: nome ou ID" />
        <button onclick="saveGroup('save-group', 'targetInput')">Salvar grupo alvo</button>
        <input id="testInput" placeholder="Grupo de teste: nome ou ID" />
        <button onclick="saveGroup('save-test-group', 'testInput')">Salvar grupo de teste</button>
      </div>
    </section>

    <section>
      <h2>Mensagens</h2>
      <div class="form">
        <input id="senderName" placeholder="Nome de envio" />
        <textarea id="targetCodes" placeholder="Mensagens do grupo alvo, uma por linha"></textarea>
        <button onclick="saveMessages('save-target-messages', 'targetCodes')">Salvar mensagens alvo</button>
        <textarea id="warmupCodes" placeholder="Mensagens de aquecimento, uma por linha"></textarea>
        <button onclick="saveMessages('save-warmup-messages', 'warmupCodes')">Salvar mensagens teste</button>
      </div>
    </section>

    <section>
      <h2>Privacidade e manutenção</h2>
      <div class="form">
        <label><input id="hideLogs" type="checkbox" /> Ocultar logs no app</label>
        <label><input id="confirmDangerousActions" type="checkbox" /> Confirmar ações perigosas</label>
        <button onclick="saveSettings()">Salvar privacidade</button>
        <button class="danger" onclick="factoryReset()">Padrão de fábrica</button>
      </div>
    </section>

    <section>
      <h2>Logs</h2>
      <div id="logs" class="logs"></div>
    </section>
  </main>

  <script>
    let lastQr = "";
    let settings = { hideLogs: false, confirmDangerousActions: true };

    async function getSnapshot() {
      const res = await fetch('/api/snapshot');
      return res.json();
    }

    async function postJson(url, body) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na ação');
      return data;
    }

    async function getSettings() {
      const res = await fetch('/api/settings');
      settings = await res.json();
      document.getElementById('hideLogs').checked = !!settings.hideLogs;
      document.getElementById('confirmDangerousActions').checked = !!settings.confirmDangerousActions;
    }

    async function saveSettings() {
      settings = await postJson('/api/settings', {
        hideLogs: document.getElementById('hideLogs').checked,
        confirmDangerousActions: document.getElementById('confirmDangerousActions').checked
      });
      document.getElementById('message').textContent = 'Privacidade salva';
    }

    function lines(id) {
      return document.getElementById(id).value.split('\\n').map((item) => item.trim()).filter(Boolean);
    }

    async function action(name) {
      if (settings.confirmDangerousActions && ['clear-session', 'restart', 'stop'].includes(name)) {
        if (!confirm('Confirmar ação?')) return;
      }
      document.getElementById('message').textContent = 'Executando...';
      try {
        render(await postJson('/api/action/' + name));
        document.getElementById('message').textContent = 'OK';
      } catch (error) {
        document.getElementById('message').textContent = error.message;
      }
    }

    async function factoryReset() {
      if (!confirm('Isso limpa sessão, QR, configuração, grupos e mensagens salvas. Continuar?')) return;
      document.getElementById('message').textContent = 'Restaurando padrão de fábrica...';
      render(await postJson('/api/action/factory-reset'));
      await getSettings();
      document.getElementById('message').textContent = 'Padrão de fábrica aplicado';
    }

    async function saveGroup(actionName, inputId) {
      const group = document.getElementById(inputId).value.trim();
      if (!group) return;
      render(await postJson('/api/action/' + actionName, { group }));
    }

    async function saveMessages(actionName, textareaId) {
      const senderName = document.getElementById('senderName').value.trim();
      render(await postJson('/api/action/' + actionName, { senderName, codes: lines(textareaId) }));
    }

    function render(snapshot) {
      document.getElementById('status').textContent = snapshot.status;
      document.getElementById('monitoring').textContent = snapshot.monitoringEnabled ? 'ATIVADO' : 'DESATIVADO';
      document.getElementById('targetGroup').textContent = snapshot.config?.grupoAlvoNome || snapshot.config?.grupoAlvoJid || 'Não configurado';
      document.getElementById('groupState').textContent = snapshot.groupState;
      document.getElementById('error').textContent = snapshot.error || '';

      if (snapshot.config) {
        document.getElementById('senderName').value = snapshot.config.nomeEnvio || '';
        if (!document.getElementById('targetInput').value) document.getElementById('targetInput').value = snapshot.config.grupoAlvoNome || snapshot.config.grupoAlvoJid || '';
        if (!document.getElementById('testInput').value) document.getElementById('testInput').value = snapshot.config.grupoTesteNome || snapshot.config.grupoTesteJid || '';
        if (!document.getElementById('targetCodes').value) document.getElementById('targetCodes').value = (snapshot.config.codigosMensagensAlvo || []).join('\\n');
        if (!document.getElementById('warmupCodes').value) document.getElementById('warmupCodes').value = (snapshot.config.codigosMensagensTeste || []).join('\\n');
      }

      const qrSection = document.getElementById('qrSection');
      if (snapshot.qrCode) {
        qrSection.classList.remove('hidden');
        if (snapshot.qrCode !== lastQr) {
          lastQr = snapshot.qrCode;
          document.getElementById('qrImage').src = '/qr.svg?t=' + Date.now();
        }
      } else {
        qrSection.classList.add('hidden');
      }

      document.getElementById('logs').innerHTML = settings.hideLogs
        ? '<div class="log">Logs ocultos pelas configurações de privacidade.</div>'
        : (snapshot.logs || []).slice(-25).reverse().map((log) =>
          '<div class="log ' + log.level + '"><strong>' + log.level + '</strong> ' + log.message + '</div>'
        ).join('');
    }

    async function loop() {
      try {
        render(await getSnapshot());
      } catch (error) {
        document.getElementById('message').textContent = 'Sem conexão com o painel';
      }
      setTimeout(loop, 2000);
    }

    getSettings().finally(loop);
  </script>
</body>
</html>`;
}

function startMobileServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        sendHtml(response, createMobileHtml());
        return;
      }

      if (request.method === "GET" && url.pathname === "/manifest.json") {
        sendJson(response, 200, {
          name: "Bot WhatsApp",
          short_name: "Bot",
          start_url: "/",
          display: "standalone",
          background_color: "#101820",
          theme_color: "#101820"
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/snapshot") {
        sendJson(response, 200, bot.getSnapshot());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/settings") {
        sendJson(response, 200, loadMobileSettings());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/settings") {
        sendJson(response, 200, saveMobileSettings(await readJsonBody(request)));
        return;
      }

      if (request.method === "GET" && url.pathname === "/qr.svg") {
        const snapshot = bot.getSnapshot();
        if (!snapshot.qrCode) {
          response.writeHead(404);
          response.end("QR indisponível");
          return;
        }

        const svg = await qrcode.toString(snapshot.qrCode, { type: "svg", width: 320, margin: 2 });
        response.writeHead(200, {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-store"
        });
        response.end(svg);
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/action/")) {
        const action = decodeURIComponent(url.pathname.replace("/api/action/", ""));
        const body = await readJsonBody(request);
        sendJson(response, 200, await handleAction(action, body));
        return;
      }

      response.writeHead(404);
      response.end("Not found");
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  const listen = (port: number) => {
    server.listen(port, "0.0.0.0", () => {
      console.log(`📱 Painel mobile: http://localhost:${port}`);
      for (const address of getLocalAddresses(port)) {
        console.log(`📱 Abra no celular: ${address}`);
      }
    });
  };

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && mobilePort < 3020) {
      const nextPort = mobilePort + 1;
      console.log(`Porta ${mobilePort} em uso. Tentando painel mobile em ${nextPort}...`);
      mobilePort = nextPort;
      listen(mobilePort);
      return;
    }

    throw error;
  });

  listen(mobilePort);
}

async function main() {
  startMobileServer();
  console.log("✅ Servidor do painel mobile iniciado.");
  console.log("📌 O WhatsApp só conecta quando o app mandar Conectar.");
}

process.on("SIGINT", async () => {
  console.log("\n⏹️ Encerrando bot...");
  await bot.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n⏹️ Encerrando bot...");
  await bot.stop();
  process.exit(0);
});

main().catch((error) => {
  console.error("❌ Erro fatal ao iniciar o bot:", error);
  process.exit(1);
});
