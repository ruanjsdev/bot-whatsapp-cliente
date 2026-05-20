import fs from "fs";
import path from "path";
import { BotConfig } from "../shared/types";

export const DEFAULT_CONFIG: BotConfig = {
  grupoAlvoJid: "",
  grupoAlvoNome: "",
  nomeEnvio: "Ruan Souza da Silva",
  codigosMensagens: []
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
      nomeEnvio:
        typeof input.nomeEnvio === "string" && input.nomeEnvio.trim()
          ? input.nomeEnvio.trim()
          : DEFAULT_CONFIG.nomeEnvio,
      codigosMensagens: Array.isArray(input.codigosMensagens)
        ? input.codigosMensagens.filter((item) => typeof item === "string" && item.trim())
        : []
    };
  }
}
