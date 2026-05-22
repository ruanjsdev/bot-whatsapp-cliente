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
  warmupCompleted?: boolean;
  warmupRequired?: boolean;
  tutorialMode?: "connect" | "start-monitoring" | "stop-monitoring";
};

export function ControlButtons({
  busy,
  status,
  onStart,
  onStop,
  onStartMonitoring,
  onStopMonitoring,
  onRestart,
  onClearSession,
  monitoringEnabled,
  warmupCompleted,
  warmupRequired,
  tutorialMode
}: Props) {
  const isConnectingFlow = status === "connecting" || status === "waiting_qr" || status === "reconnecting";
  const isConnected = status === "connected";
  const isDisconnected = status === "disconnected";
  const isError = status === "error";
  const isRunning = isConnectingFlow || isConnected;

  const tutorialActive = Boolean(tutorialMode);
  const canConnect = !busy && (isDisconnected || isError) && (!tutorialActive || tutorialMode === "connect");
  const canStop = !busy && isRunning && !tutorialActive;
  const canRestart = !busy && isRunning && !tutorialActive;
  const canClearSession = !busy && (isRunning || isError) && !tutorialActive;
  const canStartMonitoring =
    !busy &&
    isConnected &&
    !Boolean(monitoringEnabled) &&
    (!warmupRequired || Boolean(warmupCompleted)) &&
    (!tutorialActive || tutorialMode === "start-monitoring");
  const canStopMonitoring =
    !busy && isConnected && Boolean(monitoringEnabled) && (!tutorialActive || tutorialMode === "stop-monitoring");

  return (
    <article className="panel">
      <p className="panel-label">Controles</p>
      <div className="button-grid">
        <button
          data-tutorial-id="connect-whatsapp"
          className="button primary wide-button"
          disabled={!canConnect}
          onClick={onStart}
          title={isConnected ? "WhatsApp já conectado" : undefined}
        >
          Conectar WhatsApp
        </button>
        <button data-tutorial-id="start-monitoring" className="button" disabled={!canStartMonitoring} onClick={onStartMonitoring}>
          Iniciar bot
        </button>
        <button data-tutorial-id="stop-monitoring" className="button" disabled={!canStopMonitoring} onClick={onStopMonitoring}>
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
