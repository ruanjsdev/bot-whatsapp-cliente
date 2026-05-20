import { BotLog } from "../../../shared/types";

type Props = {
  logs: BotLog[];
};

export function LogsPanel({ logs }: Props) {
  return (
    <article className="panel logs-panel">
      <div className="panel-heading">
        <p className="panel-label">Logs</p>
        <span className="mini-status">{logs.length} eventos</span>
      </div>
      <div className="logs-list">
        {logs.length ? (
          logs.map((log) => (
            <div className={`log-row log-${log.level}`} key={log.id}>
              <span>{new Date(log.timestamp).toLocaleTimeString("pt-BR")}</span>
              <p>{log.message}</p>
            </div>
          ))
        ) : (
          <div className="log-empty">Nenhum evento registrado ainda.</div>
        )}
      </div>
    </article>
  );
}
