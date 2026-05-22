import { BotGroupState, BotReadinessCheck, BotStatus } from "../../../shared/types";

type Props = {
  status: BotStatus;
  groupState: BotGroupState;
  error?: string;
  monitoringEnabled?: boolean;
  readinessChecks: BotReadinessCheck[];
};

const labels: Record<BotStatus, string> = {
  disconnected: "Desconectado",
  connecting: "Conectando",
  connected: "Conectado",
  waiting_qr: "Aguardando QR Code",
  reconnecting: "Reconectando",
  error: "Erro"
};

const groupStateLabels: Record<BotGroupState, string> = {
  unknown: "Grupo ainda não validado",
  open: "Grupo aberto",
  closed: "Grupo fechado"
};

function getReadinessText(status: BotStatus, groupState: BotGroupState, monitoringEnabled?: boolean) {
  if (status !== "connected") return "Conecte o WhatsApp para validar o grupo.";
  if (!monitoringEnabled) return "WhatsApp conectado. Inicie o bot para armar o disparo.";
  if (groupState === "closed") return "Bot armado. Grupo fechado e pronto para disparar na abertura.";
  if (groupState === "open") return "Bot armado. Grupo aberto; aguardando fechar e abrir novamente.";
  return "Bot armado. Validando estado do grupo.";
}

export function StatusCard({ status, groupState, error, monitoringEnabled, readinessChecks }: Props) {
  return (
    <article className={`panel status-card status-${status}`}>
      <div className="status-row">
        <span className="status-dot" />
        <div>
          <p className="panel-label">Status atual</p>
          <h2>{labels[status]}</h2>
        </div>
      </div>
      <p className="status-copy">
        {error ||
          (status === "connected"
            ? "O WhatsApp está conectado e o bot está observando o grupo configurado."
            : "Use os controles abaixo para iniciar ou recuperar a conexão.")}
      </p>
      <div className="readiness-strip">
        <span>{groupStateLabels[groupState]}</span>
        <strong>{getReadinessText(status, groupState, monitoringEnabled)}</strong>
      </div>
      <div className="readiness-list" aria-label="Checklist de prontidão">
        {readinessChecks.map((check) => (
          <span className={check.ok ? "ready-check ok" : "ready-check pending"} key={check.id}>
            <b>{check.ok ? "OK" : "Pendente"}</b>
            {check.label}
          </span>
        ))}
      </div>
    </article>
  );
}
