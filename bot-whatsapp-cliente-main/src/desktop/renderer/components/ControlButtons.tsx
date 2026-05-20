import { BotStatus } from "../../../shared/types";

type Props = {
  busy: boolean;
  status: BotStatus;
  onStart: () => void;
  onStop: () => void;
  onStartMonitoring: () => void;
  onStopMonitoring: () => void;
  onRestart: () => void;
  onClearSession: () => void;
  monitoringEnabled?: boolean;
};

export function ControlButtons({ busy, status, onStart, onStop, onStartMonitoring, onStopMonitoring, onRestart, onClearSession, monitoringEnabled }: Props) {
  const isConnectingFlow = status === "connecting" || status === "waiting_qr" || status === "reconnecting";
  const isConnected = status === "connected";
  const isDisconnected = status === "disconnected";
  const isError = status === "error";
  const isRunning = isConnectingFlow || isConnected;

  const canConnect = !busy && (isDisconnected || isError);
  const canStop = !busy && isRunning;
  const canRestart = !busy && isRunning;
  const canClearSession = !busy && (isRunning || isError);
  const canStartMonitoring = !busy && isConnected && !Boolean(monitoringEnabled);
  const canStopMonitoring = !busy && isConnected && Boolean(monitoringEnabled);

  return (
    <article className="panel">
      <p className="panel-label">Controles</p>
      <div className="button-grid">
        <button
          className="button primary wide-button"
          disabled={!canConnect}
          onClick={onStart}
          title={isConnected ? "WhatsApp já conectado" : undefined}
        >
          Conectar WhatsApp
        </button>
        <button className="button" disabled={!canStartMonitoring} onClick={onStartMonitoring}>
          Iniciar bot
        </button>
        <button className="button" disabled={!canStopMonitoring} onClick={onStopMonitoring}>
          Parar bot
        </button>
        <button className="button" disabled={!canStop} onClick={onStop}>
          Desconectar WhatsApp
        </button>
        <button className="button" disabled={!canRestart} onClick={onRestart}>
          Reiniciar conexão
        </button>
        <button className="button danger" disabled={!canClearSession} onClick={onClearSession}>
          Gerar novo QR
        </button>
      </div>
    </article>
  );
}
