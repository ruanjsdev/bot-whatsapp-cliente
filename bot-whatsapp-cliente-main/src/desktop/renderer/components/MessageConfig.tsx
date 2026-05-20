import { FormEvent, useEffect, useState } from "react";
import { BotConfig } from "../../../shared/types";

type Props = {
  config: BotConfig;
  busy: boolean;
  onSave: (senderName: string, codes: string[]) => void;
};

export function MessageConfig({ config, busy, onSave }: Props) {
  const [senderName, setSenderName] = useState("");
  const [codes, setCodes] = useState("");

  const hasSavedCodes = config.codigosMensagens.length > 0;

  useEffect(() => {
    setSenderName(config.nomeEnvio);
    setCodes(config.codigosMensagens.join("\n"));
  }, [config.codigosMensagens, config.nomeEnvio]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const nextCodes = codes
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (!senderName.trim() || !nextCodes.length) return;
    onSave(senderName.trim(), nextCodes);
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
        <strong>{hasSavedCodes ? "Mensagem salva" : "Mensagem não salva"}</strong>
        <span>
          {hasSavedCodes
            ? `Foram salvos ${config.codigosMensagens.length} código(s). Confira se o texto está correto antes de enviar.`
            : "Informe pelo menos um código para que o bot possa enviar a mensagem de abertura."}
        </span>
      </div>
      <form className="group-form" onSubmit={submit}>
        <label htmlFor="sender-name-input">Nome que vai na mensagem</label>
        <input
          id="sender-name-input"
          value={senderName}
          onChange={(event) => setSenderName(event.target.value)}
          placeholder="Ex: Ruan Souza da Silva"
        />
        <label htmlFor="codes-input">Um código por linha</label>
        <textarea
          id="codes-input"
          value={codes}
          onChange={(event) => setCodes(event.target.value)}
          placeholder="Ex: F-14"
          rows={4}
        />
        <button className="button primary" disabled={busy || !senderName.trim() || !codes.trim()} type="submit">
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
