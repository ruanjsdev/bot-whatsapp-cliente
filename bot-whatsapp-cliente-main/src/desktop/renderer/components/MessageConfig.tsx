import { FormEvent, useEffect, useState } from "react";
import { BotConfig } from "../../../shared/types";

type Props = {
  config: BotConfig;
  busy: boolean;
  onSaveWarmup: (senderName: string, codes: string[]) => void;
  onSaveTarget: (senderName: string, codes: string[]) => void;
  forcedMode?: "target" | "warmup";
  disabled?: boolean;
  validationError?: string;
  tutorialNotice?: string;
};

export function MessageConfig({
  config,
  busy,
  onSaveWarmup,
  onSaveTarget,
  forcedMode,
  disabled,
  validationError,
  tutorialNotice
}: Props) {
  const [senderName, setSenderName] = useState("");
  const [codes, setCodes] = useState("");
  const [mode, setMode] = useState<"target" | "warmup">("target");

  const hasSavedTarget = (config.codigosMensagensAlvo || []).length > 0;
  const hasSavedWarmup = (config.codigosMensagensTeste || []).length > 0;

  useEffect(() => {
    setSenderName(config.nomeEnvio);
    setCodes((mode === "target" ? config.codigosMensagensAlvo : config.codigosMensagensTeste).join("\n"));
  }, [config.codigosMensagensAlvo, config.codigosMensagensTeste, config.nomeEnvio, mode]);

  useEffect(() => {
    if (forcedMode) setMode(forcedMode);
  }, [forcedMode]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const nextCodes = codes
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (!senderName.trim() || !nextCodes.length) return;
    if (mode === "target") {
      onSaveTarget(senderName.trim(), nextCodes);
    } else {
      onSaveWarmup(senderName.trim(), nextCodes);
    }
  }

  const previewMessages = codes
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((code) => `${senderName.trim() || config.nomeEnvio} ${code.toUpperCase()}`);

  return (
    <article className="panel">
      <p className="panel-label">Mensagem enviada</p>
      <div className="hint-bubble">
        <strong>
          {mode === "target" ? (hasSavedTarget ? "Mensagem alvo salva" : "Mensagem alvo não salva") : hasSavedWarmup ? "Mensagem de aquecimento salva" : "Mensagem de aquecimento não salva"}
        </strong>
        <span>
          {mode === "target"
            ? hasSavedTarget
              ? `Foram salvos ${config.codigosMensagensAlvo.length} código(s) para o grupo alvo.`
              : "Informe pelo menos um código para que o bot possa enviar mensagens no grupo alvo."
            : hasSavedWarmup
            ? `Foram salvos ${config.codigosMensagensTeste.length} código(s) para aquecimento.`
            : "Informe pelo menos um código para aquecimento do teste."}
        </span>
      </div>
      {tutorialNotice ? <div className="danger-notice">{tutorialNotice}</div> : null}
      {validationError ? <div className="form-error">{validationError}</div> : null}
      <div className="mode-switch">
        <label>
          <input
            type="radio"
            checked={mode === "target"}
            disabled={disabled || Boolean(forcedMode)}
            onChange={() => setMode("target")}
          />{" "}
          Grupo alvo
        </label>
        <label>
          <input
            type="radio"
            checked={mode === "warmup"}
            disabled={disabled || Boolean(forcedMode)}
            onChange={() => setMode("warmup")}
          />{" "}
          Aquecimento (grupo de teste)
        </label>
      </div>
      <form className="group-form" onSubmit={submit}>
        <label htmlFor="sender-name-input">Nome que vai na mensagem</label>
        <input
          id="sender-name-input"
          value={senderName}
          disabled={disabled}
          onChange={(event) => setSenderName(event.target.value)}
          placeholder="Ex: Alan Alves"
        />
        <label htmlFor="codes-input">Um código por linha</label>
        <textarea
          id="codes-input"
          value={codes}
          disabled={disabled}
          onChange={(event) => setCodes(event.target.value)}
          placeholder="Ex: F-14"
          rows={4}
        />
        <button className="button primary" disabled={busy || disabled || !senderName.trim() || !codes.trim()} type="submit">
          Salvar mensagem
        </button>
        <div className="message-preview">
          <strong>{previewMessages.length} mensagens separadas</strong>
          {previewMessages.map((message, index) => (
            <span key={`${message}-${index}`}>{message}</span>
          ))}
        </div>
      </form>
    </article>
  );
}
