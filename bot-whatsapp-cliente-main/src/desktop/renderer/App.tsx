import { useEffect, useMemo, useState } from "react";
import { BotSnapshot } from "../../shared/types";
import { ControlButtons } from "./components/ControlButtons";
import { GroupConfig } from "./components/GroupConfig";
import { LogsPanel } from "./components/LogsPanel";
import { MessageConfig } from "./components/MessageConfig";
import { QrCodeBox } from "./components/QrCodeBox";
import { StatusCard } from "./components/StatusCard";
import "./styles.css";

type PendingConfirmation = {
  title: string;
  message: string;
  details: string[];
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
};

const emptySnapshot: BotSnapshot = {
  status: "disconnected",
  qrCode: "",
  config: {
    grupoAlvoJid: "",
    grupoAlvoNome: "",
    nomeEnvio: "Ruan Souza da Silva",
    codigosMensagens: []
  },
  groups: [],
  logs: []
};

export default function App() {
  const [snapshot, setSnapshot] = useState<BotSnapshot>(emptySnapshot);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>();

  useEffect(() => {
    window.botApi.getSnapshot().then(setSnapshot);
    return window.botApi.onSnapshot(setSnapshot);
  }, []);

  const groupLabel = useMemo(() => {
    return snapshot.config.grupoAlvoNome || snapshot.config.grupoAlvoJid || "Nenhum grupo configurado";
  }, [snapshot.config]);

  async function runAction(action: () => Promise<BotSnapshot>) {
    setBusy(true);
    try {
      setSnapshot(await action());
    } finally {
      setBusy(false);
    }
  }

  function buildMessagePreview(senderName = snapshot.config.nomeEnvio, codes = snapshot.config.codigosMensagens) {
    return codes.map((code) => `${senderName.trim()} ${code.trim().toUpperCase()}`.trim());
  }

  function confirmSaveGroup(group: string, groupId?: string, groupName?: string) {
    const selectedGroupName = groupName || group;

    setConfirmation({
      title: "Confirmar grupo",
      message: `Deseja realmente enviar mensagens no grupo: ${selectedGroupName}?`,
      details: groupId ? [`ID do grupo: ${groupId}`] : ["Grupo informado manualmente."],
      confirmLabel: "Salvar grupo",
      onConfirm: () => runAction(() => window.botApi.saveGroup({ group, groupId, groupName }))
    });
  }

  function confirmSaveMessages(senderName: string, codes: string[]) {
    const messages = buildMessagePreview(senderName, codes);

    setConfirmation({
      title: "Confirmar mensagens",
      message: "Deseja salvar estas mensagens para envio?",
      details: messages.length ? messages : ["Nenhuma mensagem pronta."],
      confirmLabel: "Salvar mensagens",
      onConfirm: () => runAction(() => window.botApi.saveMessageSettings({ senderName, codes }))
    });
  }

  function confirmStartMonitoring() {
    const messages = buildMessagePreview();

    setConfirmation({
      title: "Iniciar bot",
      message: "Deseja iniciar o bot com estas configurações?",
      details: [
        `Grupo selecionado: ${groupLabel}`,
        messages.length
          ? `Mensagens a enviar: ${messages.join(" | ")}`
          : "Mensagens a enviar: nenhuma mensagem configurada."
      ],
      confirmLabel: "Iniciar bot",
      onConfirm: () => runAction(window.botApi.startMonitoring)
    });
  }

  async function confirmPendingAction() {
    if (!confirmation) return;
    const action = confirmation.onConfirm;
    setConfirmation(undefined);
    await action();
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Painel desktop</p>
          <h1>Bot WhatsApp</h1>
        </div>
        <div className="group-pill">
          <span>Grupo</span>
          <strong>{groupLabel}</strong>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="primary-column">
          <StatusCard status={snapshot.status} error={snapshot.error} />
          <ControlButtons
            busy={busy}
            status={snapshot.status}
            onStart={() => runAction(window.botApi.startBot)}
            onStop={() => runAction(window.botApi.stopBot)}
            onStartMonitoring={confirmStartMonitoring}
            onStopMonitoring={() => runAction(window.botApi.stopMonitoring)}
            onRestart={() => runAction(window.botApi.restartBot)}
            onClearSession={() => runAction(window.botApi.clearSession)}
            monitoringEnabled={snapshot.monitoringEnabled}
          />
          <GroupConfig
            config={snapshot.config}
            groups={snapshot.groups}
            busy={busy}
            onRefresh={() => runAction(window.botApi.refreshGroups)}
            onSave={confirmSaveGroup}
          />
          <MessageConfig
            config={snapshot.config}
            busy={busy}
            onSave={confirmSaveMessages}
          />
        </div>

        <div className="secondary-column">
          <QrCodeBox qrCode={snapshot.qrCode} status={snapshot.status} />
          <LogsPanel logs={snapshot.logs} />
        </div>
      </section>

      {confirmation ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="panel-label">Confirmação</p>
            <h2 id="confirm-title">{confirmation.title}</h2>
            <p className="confirmation-message">{confirmation.message}</p>
            <div className="confirmation-details">
              {confirmation.details.map((detail, index) => (
                <span key={`${detail}-${index}`}>{detail}</span>
              ))}
            </div>
            <div className="confirmation-actions">
              <button className="button" disabled={busy} type="button" onClick={() => setConfirmation(undefined)}>
                Cancelar
              </button>
              <button className="button primary" disabled={busy} type="button" onClick={confirmPendingAction}>
                {confirmation.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
