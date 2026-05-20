import { BotStatus } from "../../../shared/types";

type Props = {
  status: BotStatus;
  error?: string;
};

const labels: Record<BotStatus, string> = {
  disconnected: "Desconectado",
  connecting: "Conectando",
  connected: "Conectado",
  waiting_qr: "Aguardando QR Code",
  reconnecting: "Reconectando",
  error: "Erro"
};

export function StatusCard({ status, error }: Props) {
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
    </article>
  );
}
