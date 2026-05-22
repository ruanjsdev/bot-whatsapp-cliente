import { FormEvent, useEffect, useState } from "react";
import { BotConfig, BotGroup } from "../../../shared/types";

type Props = {
  config: BotConfig;
  groups: BotGroup[];
  busy: boolean;
  onRefresh: () => void;
  onSave: (group: string, groupId?: string, groupName?: string) => void;
  disabled?: boolean;
  tutorialNotice?: string;
};

export function GroupConfig({ config, groups, busy, onRefresh, onSave, disabled, tutorialNotice }: Props) {
  const [group, setGroup] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");

  const savedGroupName = config.grupoAlvoNome || config.grupoAlvoJid;
  const hasSavedGroup = Boolean(savedGroupName);

  useEffect(() => {
    setGroup(config.grupoAlvoJid || config.grupoAlvoNome || "");
    setSelectedGroupId(config.grupoAlvoJid || "");
  }, [config.grupoAlvoJid, config.grupoAlvoNome]);
    
  function submit(event: FormEvent) {
    event.preventDefault();
    const selectedGroup = groups.find((item) => item.id === selectedGroupId);
    const value = selectedGroup ? selectedGroup.name : group.trim();
    if (!value) return;
    onSave(value, selectedGroup?.id, selectedGroup?.name);
  }

  return (
    <article className="panel">
      <p className="panel-label">Grupo do WhatsApp</p>
      <div className="hint-bubble">
        <strong>{hasSavedGroup ? "Grupo salvo" : "Grupo não salvo"}</strong>
        <span>
          {hasSavedGroup
            ? `Usando o grupo: ${savedGroupName}. Não esqueça de salvar o nome/ID corresponde ao grupo correto.`
            : "Salve um grupo selecionando na lista ou informando nome/ID exato. Sem isso, o bot não envia mensagens."}
        </span>
      </div>
      {tutorialNotice ? <div className="danger-notice">{tutorialNotice}</div> : null}
      <form className="group-form" onSubmit={submit}>
        <div className="form-heading-row">
          <label htmlFor="group-select">Selecione um grupo</label>
          <button className="link-button" disabled={busy || disabled} type="button" onClick={onRefresh}>
            Atualizar lista
          </button>
        </div>
        <select
          id="group-select"
          value={selectedGroupId}
          disabled={disabled}
          onChange={(event) => {
            const id = event.target.value;
            const selectedGroup = groups.find((item) => item.id === id);
            setSelectedGroupId(id);
            setGroup(selectedGroup?.name || "");
          }}
        >
          <option value="">Escolha um grupo</option>
          {groups.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <label htmlFor="group-input">Ou informe nome/ID manualmente</label>
        <input
          id="group-input"
          value={group}
          disabled={disabled}
          onChange={(event) => {
            setGroup(event.target.value);
            setSelectedGroupId("");
          }}
          placeholder="Ex: bot teste ou 120363...@g.us"
        />
        <button className="button primary" disabled={busy || disabled || (!group.trim() && !selectedGroupId)} type="submit">
          Salvar grupo
        </button>
      </form>
    </article>
  );
}
