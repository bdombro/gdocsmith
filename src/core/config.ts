/* App config persisted under ~/.config/gdocsmith/. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Persisted application configuration schema.
 */
export type SkillConfig = {
  /** Apps Script project id for Drive blob image inserts. */
  appsScriptId?: string;
  /** Cached OAuth access token for direct REST API calls. */
  oauthToken?: {
    /** Raw OAuth2 bearer token. */
    access_token: string;
    /** Expiration timestamp in epoch milliseconds. */
    expires_at: number;
    /** Token type, typically Bearer. */
    token_type?: string;
  };
};

/**
 * Returns the absolute filesystem path to the SQLite cache database.
 */
export function cacheDbPath(): string {
  if (process.env.GDOCSMITH_CACHE_DB) return process.env.GDOCSMITH_CACHE_DB;
  if (process.env.GDOCSMITH_CACHE_DIR === ":memory:") return ":memory:";
  return join(cacheDir(), "db.sqlite");
}

/**
 * Resolves the cache directory path based on environment variables or defaults.
 */
export function cacheDir(): string {
  return process.env.GDOCSMITH_CACHE_DIR ?? join(homedir(), ".cache", "gdocsmith");
}

/**
 * Loads skill config from disk or returns empty defaults if missing or unreadable.
 */
export function skillConfigLoad(): SkillConfig {
  try {
    return JSON.parse(readFileSync(configFile(), "utf8")) as SkillConfig;
  } catch {
    return {};
  }
}

/**
 * Alias for skillConfigLoad.
 */
export const loadSkillConfig = skillConfigLoad;

/**
 * Returns the absolute filesystem path to the config file.
 */
export function skillConfigPath(): string {
  return configFile();
}

/**
 * Merges partial config with existing settings and writes to disk.
 */
export function skillConfigSave(
  /** Partial config object with fields to update. */
  patch: Partial<SkillConfig>,
): SkillConfig {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const config = { ...skillConfigLoad(), ...patch };
  writeFileSync(configFile(), JSON.stringify(config, null, 2));
  return config;
}

/**
 * Alias for skillConfigSave.
 */
export const saveSkillConfig = skillConfigSave;

/**
 * Resolves the configuration directory path based on environment variables or defaults.
 */
function configDir(): string {
  return process.env.GDOCSMITH_CONFIG_DIR ?? join(homedir(), ".config", "gdocsmith");
}

/**
 * Resolves the configuration file path.
 */
function configFile(): string {
  return join(configDir(), "config.json");
}
