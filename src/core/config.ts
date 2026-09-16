/*

App config persisted under ~/.config/gdocsmith/.

*/

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SkillConfig = {
  /** Apps Script project id for Drive blob image inserts. */
  appsScriptId?: string;
  /** Cached OAuth access token for direct REST API calls. */
  oauthToken?: {
    access_token: string;
    expires_at: number;
    token_type?: string;
  };
};

function configDir(): string {
  return (
    process.env.GDOCSMITH_CONFIG_DIR ?? process.env.GWS_DOCS_EDIT_CONFIG_DIR ?? join(homedir(), ".config", "gdocsmith")
  );
}

function configFile(): string {
  return join(configDir(), "config.json");
}

/** Loads skill config or empty defaults. */
export function loadSkillConfig(): SkillConfig {
  try {
    return JSON.parse(readFileSync(configFile(), "utf8")) as SkillConfig;
  } catch {
    return {};
  }
}

/** Merges and persists skill config. */
export function saveSkillConfig(patch: Partial<SkillConfig>): SkillConfig {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const config = { ...loadSkillConfig(), ...patch };
  writeFileSync(configFile(), JSON.stringify(config, null, 2));
  return config;
}

export function skillConfigPath(): string {
  return configFile();
}
