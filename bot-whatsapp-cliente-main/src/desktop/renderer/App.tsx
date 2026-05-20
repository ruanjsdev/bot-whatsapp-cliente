import { useEffect, useMemo, useState } from "react";
import { BotSnapshot } from "../../shared/types";
import { ControlButtons } from "./components/ControlButtons";
import { GroupConfig } from "./components/GroupConfig";
import { LogsPanel } from "./components/LogsPanel";
import { MessageConfig } from "./components/MessageConfig";
import { QrCodeBox } from "./components/QrCodeBox";
import { StatusCard } from "./components/StatusCard";
import "./styles.css";

const emptySnapshot: BotSnapshot = {
  status: "disconnected",
  qrCode: "",
  config: {
    grupoAlvoJid: "",
    grupoAlvoNome: "",
    nomeEnvio: "Alan Alves,
    codigosMensagens: []
  },
  groups: [],
  logs: []
};

export default function App() {
  const [snapshot, setSnapshot] = useState<BotSnapshot>(emptySnapshot);
  const [busy, setBusy] = useState(false);

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
            onStartMonitoring={() => runAction(window.botApi.startMonitoring)}
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
            onSave={(group, groupId, groupName) =>
              runAction(() => window.botApi.saveGroup({ group, groupId, groupName }))
            }
          />
          <MessageConfig
            config={snapshot.config}
            busy={busy}
            onSave={(senderName, codes) =>
              runAction(() => window.botApi.saveMessageSettings({ senderName, codes }))
            }
          />
        </div>

        <div className="secondary-column">
          <QrCodeBox qrCode={snapshot.qrCode} status={snapshot.status} />
          <LogsPanel logs={snapshot.logs} />
        </div>
      </section>
    </main>
  );
}
