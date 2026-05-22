import fs from "fs";
import path from "path";
import { BotConfig } from "../shared/types";

export const DEFAULT_CONFIG: BotConfig = {
  grupoAlvoJid: "",
  grupoAlvoNome: "",
  grupoTesteJid: "",
  grupoTesteNome: "",
  nomeEnvio: "Alan da Silva Alves",
  codigosMensagensAlvo: [],
  codigosMensagensTeste: []
};

export class ConfigStore {
  constructor(private readonly configPath = path.resolve(process.cwd(), "config.json")) {}

  get path() {
    return this.configPath;
  }

  load(): BotConfig {
    this.ensureConfigFile();

    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      return this.normalize(JSON.parse(content));
    } catch {
      const fallback = { ...DEFAULT_CONFIG };
      this.save(fallback);
      return fallback;
    }
  }

  save(config: Partial<BotConfig>): BotConfig {
    const nextConfig = this.normalize({
      ...this.loadWithoutCreating(),
      ...config
    });

    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(nextConfig, null, 2));
    return nextConfig;
  }

  saveGroup(group: string): BotConfig {
    const value = group.trim();
    const looksLikeJid = value.includes("@g.us");

    return this.save({
      grupoAlvoJid: looksLikeJid ? value : "",
      grupoAlvoNome: looksLikeJid ? "Grupo salvo por ID" : value
    });
  }

  saveGroupById(groupId: string, groupName: string): BotConfig {
    return this.save({
      grupoAlvoJid: groupId.trim(),
      grupoAlvoNome: groupName.trim() || "Grupo salvo"
    });
  }

  saveTestGroup(group: string): BotConfig {
    const value = group.trim();
    const looksLikeJid = value.includes("@g.us");

    return this.save({
      grupoTesteJid: looksLikeJid ? value : "",
      grupoTesteNome: looksLikeJid ? "Grupo teste por ID" : value
    });
  }

  saveTestGroupById(groupId: string, groupName: string): BotConfig {
    return this.save({
      grupoTesteJid: groupId.trim(),
      grupoTesteNome: groupName.trim() || "Grupo teste"
    });
  }

  private ensureConfigFile() {
    if (!fs.existsSync(this.configPath)) {
      this.save(DEFAULT_CONFIG);
    }
  }

  private loadWithoutCreating(): BotConfig {
    if (!fs.existsSync(this.configPath)) {
      return { ...DEFAULT_CONFIG };
    }

    try {
      return this.normalize(JSON.parse(fs.readFileSync(this.configPath, "utf-8")));
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  private normalize(input: Partial<BotConfig>): BotConfig {
    return {
      grupoAlvoJid: typeof input.grupoAlvoJid === "string" ? input.grupoAlvoJid : "",
      grupoAlvoNome: typeof input.grupoAlvoNome === "string" ? input.grupoAlvoNome : "",
      grupoTesteJid: typeof input.grupoTesteJid === "string" ? input.grupoTesteJid : "",
      grupoTesteNome: typeof input.grupoTesteNome === "string" ? input.grupoTesteNome : "",
      nomeEnvio:
        typeof input.nomeEnvio === "string" &&
        input.nomeEnvio.trim() &&
        !["Ruan Souza da Silva", "Alan Alves"].includes(input.nomeEnvio.trim())
          ? input.nomeEnvio.trim()
          : DEFAULT_CONFIG.nomeEnvio,
      // support legacy `codigosMensagens` if present
      codigosMensagensAlvo: Array.isArray(input.codigosMensagensAlvo)
        ? input.codigosMensagensAlvo.filter((item) => typeof item === "string" && item.trim())
        : Array.isArray((input as any).codigosMensagens)
        ? (input as any).codigosMensagens.filter((item: any) => typeof item === "string" && item.trim())
        : [],
      codigosMensagensTeste: Array.isArray(input.codigosMensagensTeste)
        ? input.codigosMensagensTeste.filter((item) => typeof item === "string" && item.trim())
        : []
    };
  }
}
