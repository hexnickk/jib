import { type Config, type GitHubProvider, loadConfig, writeConfig } from '@jib/config'
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

function providers(cfg: Config): Record<string, GitHubProvider> {
  cfg.github ??= {}
  cfg.github.providers ??= {}
  return cfg.github.providers
}

/** Look up a provider by name, returning `undefined` if absent. */
export function getProvider(cfg: Config, name: string): GitHubProvider | undefined {
  return cfg.github?.providers?.[name]
}

/**
 * Throws if a provider name is already taken. Used as input validation by
 * `jib github key setup` and `jib github app setup` so both commands share
 * the same "name already in use" error message.
 */
export function providerNameAvailable(cfg: Config, name: string): void {
  if (getProvider(cfg, name) !== undefined) {
    throw new JibError('github.config', `provider "${name}" already exists`)
  }
}

/** Returns the names of apps that still reference `providerName`. */
export function appsUsingProvider(cfg: Config, providerName: string): string[] {
  return Object.entries(cfg.apps)
    .filter(([, app]) => app.provider === providerName)
    .map(([name]) => name)
}

/** Write a deploy-key provider entry (idempotent — overwrites on re-setup). */
export async function addKeyProvider(configFile: string, name: string): Promise<void> {
  await editConfig(configFile, (cfg) => {
    providers(cfg)[name] = { type: 'key' }
  })
}

/** Write a GitHub App provider entry, storing the numeric App ID. */
export async function addAppProvider(
  configFile: string,
  name: string,
  appId: number,
): Promise<void> {
  await editConfig(configFile, (cfg) => {
    providers(cfg)[name] = { type: 'app', app_id: appId }
  })
}

/**
 * Remove a provider entry. Cleans up the parent `github` / `providers` maps
 * if they end up empty so writing an otherwise-empty config doesn't leave
 * stub keys behind.
 */
export async function removeProvider(configFile: string, name: string): Promise<void> {
  await editConfig(configFile, (cfg) => {
    const gh = cfg.github
    if (!gh?.providers) return
    delete gh.providers[name]
    if (Object.keys(gh.providers).length === 0) gh.providers = undefined
    if (gh.providers === undefined) cfg.github = undefined
  })
}
