import { FormEvent, useEffect, useState } from "react";
import { BotConfig, BotGroup } from "../../../shared/types";

type Props = {
  config: BotConfig;
  groups: BotGroup[];
  busy: boolean;
  onRefresh: () => void;
  onSave: (group: string, groupId: string | undefined, groupName: string | undefined, senderName: string, codes: string[]) => void;
};

export function RealRouteConfig({ config, groups, busy, onRefresh, onSave }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [senderName, setSenderName] = useState("");
  const [codes, setCodes] = useState("");

  const savedGroupName = config.grupoAlvoNome || config.grupoAlvoJid;
  const hasReadyConfig = Boolean(savedGroupName && senderName.trim() && codes.trim());
  const previewMessages = codes
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((code) => `${senderName.trim()} ${code.toUpperCase()}`.trim());

  useEffect(() => {
    setSelectedGroupId(config.grupoAlvoJid || "");
    setSenderName(config.nomeEnvio || "Alan da Silva Alves");
    setCodes((config.codigosMensagensAlvo || []).join("\n"));
  }, [config.grupoAlvoJid, config.nomeEnvio, config.codigosMensagensAlvo]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const selectedGroup = groups.find((item) => item.id === selectedGroupId);
    const nextCodes = codes
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (!selectedGroup || !senderName.trim() || !nextCodes.length) return;
    onSave(selectedGroup.name, selectedGroup.id, selectedGroup.name, senderName.trim(), nextCodes);
  }

  return (
    <article className="panel">
      <p className="panel-label">Rotas reais</p>
      <div className="hint-bubble">
        <strong>{hasReadyConfig ? "Configuração real pronta" : "Configure as rotas reais"}</strong>
        <span>
          Escolha o grupo real, confira o nome que vai na mensagem e informe a rota. Ao salvar, tudo fica sincronizado
          para iniciar o bot.
        </span>
      </div>
      <form className="group-form" onSubmit={submit}>
        <div className="form-heading-row">
          <label htmlFor="real-group-select">Escolher grupo</label>
          <button className="link-button" disabled={busy} type="button" onClick={onRefresh}>
            Atualizar lista
          </button>
        </div>
        <select
          id="real-group-select"
          value={selectedGroupId}
          onChange={(event) => setSelectedGroupId(event.target.value)}
        >
          <option value="">Escolha um grupo</option>
          {groups.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <label htmlFor="real-sender-name">Nome</label>
        <input
          id="real-sender-name"
          value={senderName}
          onChange={(event) => setSenderName(event.target.value)}
          placeholder="Ex: Alan da Silva Alves"
        />

        <label htmlFor="real-route-codes">Rota que quer pegar</label>
        <textarea
          id="real-route-codes"
          value={codes}
          onChange={(event) => setCodes(event.target.value)}
          placeholder="Ex: F-14"
          rows={4}
        />

        <button className="button primary" disabled={busy || !selectedGroupId || !senderName.trim() || !codes.trim()} type="submit">
          Salvar configuração real
        </button>

        <div className="message-preview">
          <strong>{previewMessages.length} mensagem(ns) pronta(s)</strong>
          {previewMessages.map((message, index) => (
            <span key={`${message}-${index}`}>{message}</span>
          ))}
        </div>
      </form>
    </article>
  );
}
