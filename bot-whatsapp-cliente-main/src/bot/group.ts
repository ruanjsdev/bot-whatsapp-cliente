export function normalizarTexto(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export async function resolveGroup(sock: any, group: { jid: string; name: string }) {
  if (group.jid) {
    return {
      jid: group.jid,
      name: group.name || "Grupo salvo"
    };
  }

  if (!group.name) {
    return {
      jid: "",
      name: ""
    };
  }

  const grupos = await sock.groupFetchAllParticipating();
  const listaGrupos = Object.values(grupos) as any[];
  const wanted = normalizarTexto(group.name);
  const found = listaGrupos.find((item) => normalizarTexto(item.subject || "") === wanted);

  if (!found) {
    throw new Error(`Grupo "${group.name}" não encontrado nesse WhatsApp.`);
  }

  return {
    jid: found.id,
    name: found.subject || group.name
  };
}
