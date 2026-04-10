import { type Config, type GitHubSource, loadConfig, writeConfig } from '@jib/config'
import { JibError } from '@jib/core'

/**
 * Load the config, mutate it via `edit`, then write it back. Centralized so
 * every CLI command goes through the same load/validate/save cycle — the
 * YAML round-trip is handled by `@jib/config` and preserves schema v3 shape.
 */
async function editConfig(path: string, edit: (cfg: Config) => void): Promise<void> {
  const cfg = await loadConfig(path)
  edit(cfg)
  await writeConfig(path, cfg)
}

/** Look up a GitHub source ref by name, returning `undefined` if absent. */
export function getGitHubSource(cfg: Config, name: string): GitHubSource | undefined {
  const source = cfg.sources[name]
  return source?.driver === 'github' ? source : undefined
}

/**
 * Throws if a source name is already taken. Used as input validation by
 * `jib github key setup` and `jib github app setup` so both commands share
 * the same "name already in use" error message.
 */
export function sourceNameAvailable(cfg: Config, name: string): void {
  if (cfg.sources[name] !== undefined) {
    throw new JibError('github.config', `source "${name}" already exists`)
  }
}

/** Returns the names of apps that still reference `sourceName`. */
export function appsUsingSource(cfg: Config, sourceName: string): string[] {
  return Object.entries(cfg.apps)
    .filter(([, app]) => app.source === sourceName)
    .map(([name]) => name)
}

/** Write a deploy-key source entry (idempotent — overwrites on re-setup). */
export async function addGitHubKeySource(configFile: string, name: string): Promise<void> {
  await editConfig(configFile, (cfg) => {
    cfg.sources[name] = { driver: 'github', type: 'key' }
  })
}

/** Write a GitHub App source entry, storing the numeric App ID. */
export async function addGitHubAppSource(
  configFile: string,
  name: string,
  appId: number,
): Promise<void> {
  await editConfig(configFile, (cfg) => {
    cfg.sources[name] = { driver: 'github', type: 'app', app_id: appId }
  })
}

/**
 * Remove a GitHub source entry.
 */
export async function removeGitHubSource(configFile: string, name: string): Promise<void> {
  await editConfig(configFile, (cfg) => {
    delete cfg.sources[name]
  })
}
