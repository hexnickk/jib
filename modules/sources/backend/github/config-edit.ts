import { type Config, ConfigError, type GitHubSource, configLoad, configWrite } from '@jib/config'
import { JibError } from '@jib/errors'

export class GitHubSourceAlreadyExistsError extends JibError {
  constructor(name: string) {
    super('github_source_exists', `source "${name}" already exists`)
  }
}

/**
 * Loads config, applies a single mutation, then persists it back to disk so all
 * GitHub source setup flows share the same read/validate/write path.
 */
async function githubEditConfig(
  path: string,
  edit: (cfg: Config) => void,
): Promise<undefined | ConfigError | Error> {
  const cfg = await configLoad(path)
  if (cfg instanceof ConfigError) return cfg
  edit(cfg)
  return configWrite(path, cfg)
}

/** Looks up a GitHub source ref by name, returning `undefined` if absent. */
export function githubGetSource(cfg: Config, name: string): GitHubSource | undefined {
  const source = cfg.sources[name]
  return source?.driver === 'github' ? source : undefined
}

/** Validates that a source name is free before setup mutates the config. */
export function githubValidateSourceName(
  cfg: Config,
  name: string,
): GitHubSourceAlreadyExistsError | undefined {
  return cfg.sources[name] !== undefined ? new GitHubSourceAlreadyExistsError(name) : undefined
}

/** Writes a deploy-key source entry (idempotent — overwrites on re-setup). */
export async function githubAddKeySource(
  configFile: string,
  name: string,
): Promise<undefined | Error> {
  return githubEditConfig(configFile, (cfg) => {
    cfg.sources[name] = { driver: 'github', type: 'key' }
  })
}

/** Writes a GitHub App source entry, storing the numeric App ID. */
export async function githubAddAppSource(
  configFile: string,
  name: string,
  appId: number,
): Promise<undefined | Error> {
  return githubEditConfig(configFile, (cfg) => {
    cfg.sources[name] = { driver: 'github', type: 'app', app_id: appId }
  })
}
