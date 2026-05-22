import { FormEvent, useEffect, useState } from "react";
import { BotConfig, BotGroup } from "../../../shared/types";

type Props = {
  config: BotConfig;
  groups: BotGroup[];
  busy: boolean;
  warmupCompleted?: boolean;
  onSave: (group: string, groupId?: string, groupName?: string) => void;
  onWarmup: () => void;
  disabled?: boolean;
  disableGroupFields?: boolean;
  disableWarmup?: boolean;
  warmupCounter?: string;
};

export function GroupTestConfig({
  config,
  groups,
  busy,
  warmupCompleted,
  onSave,
  onWarmup,
  disabled,
  disableGroupFields,
  disableWarmup,
  warmupCounter
}: Props) {
  const [group, setGroup] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");

  const savedGroupName = config.grupoTesteNome || config.grupoTesteJid;
  const hasSavedGroup = Boolean(savedGroupName);
  const warmupLabel = warmupCompleted ? "Aquecimento concluído" : "Aquecimento pendente";

  useEffect(() => {
    setGroup(config.grupoTesteJid || config.grupoTesteNome || "");
    setSelectedGroupId(config.grupoTesteJid || "");
  }, [config.grupoTesteJid, config.grupoTesteNome]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const selectedGroup = groups.find((item) => item.id === selectedGroupId);
    const value = selectedGroup ? selectedGroup.name : group.trim();
    if (!value) return;
    onSave(value, selectedGroup?.id, selectedGroup?.name);
  }

  return (
    <article className="panel">
      <p className="panel-label">Grupo de teste</p>
      <div className="hint-bubble">
        <strong>{hasSavedGroup ? "Grupo de teste salvo" : "Sem grupo de teste"}</strong>
        <span>
          {hasSavedGroup
            ? `Usando o grupo de teste: ${savedGroupName}. Esse grupo serve apenas para aquecer a sessão e não será usado como grupo real de envio. ${warmupLabel}.`
            : "Salve um grupo de teste para aquecimento. Não é necessário abrir e fechar esse grupo para usar o recurso."}
        </span>
      </div>
      <form className="group-form" onSubmit={submit}>
        <div className="form-heading-row">
          <label htmlFor="test-group-select">Selecione um grupo</label>
        </div>
        <select
          id="test-group-select"
          value={selectedGroupId}
          disabled={disabled || disableGroupFields}
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

        <label htmlFor="test-group-input">Ou informe nome/ID manualmente</label>
        <input
          id="test-group-input"
          value={group}
          disabled={disabled || disableGroupFields}
          onChange={(event) => {
            setGroup(event.target.value);
            setSelectedGroupId("");
          }}
          placeholder="Ex: bot teste ou 120363...@g.us"
        />
        <button className="button primary" disabled={busy || disabled || disableGroupFields || (!group.trim() && !selectedGroupId)} type="submit">
          Salvar grupo de teste
        </button>
      </form>
      <button
        data-tutorial-id="warmup-button"
        className="button secondary wide-button"
        disabled={busy || disabled || disableWarmup || !hasSavedGroup}
        onClick={onWarmup}
      >
        Pré-aquecer grupo de teste{warmupCounter ? ` (${warmupCounter})` : ""}
      </button>
    </article>
  );
}
