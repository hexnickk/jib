import { existsSync, readFileSync } from 'node:fs'
import { type Config, writeConfig } from '@jib/config'
import { type Paths, credsPath } from '@jib/core'

interface ReconcileDeps {
  writeConfig?: typeof writeConfig
}

function hasCloudflaredToken(paths: Paths): boolean {
  const tokenPath = credsPath(paths, 'cloudflare', 'tunnel.env')
  return existsSync(tokenPath) && readFileSync(tokenPath, 'utf8').trim().length > 0
}

function hasGitHubSources(config: Config): boolean {
  return Object.values(config.sources).some((source) => source.driver === 'github')
}

export function inferredOptionalModules(config: Config, paths: Paths): Record<string, true> {
  const inferred: Record<string, true> = {}

  if (config.modules.cloudflared === undefined && hasCloudflaredToken(paths)) {
    inferred.cloudflared = true
  }
  if (config.modules.github === undefined && hasGitHubSources(config)) {
    inferred.github = true
  }

  return inferred
}

export async function reconcileOptionalModules(
  config: Config,
  paths: Paths,
  deps: ReconcileDeps = {},
): Promise<Config> {
  const inferred = inferredOptionalModules(config, paths)
  if (Object.keys(inferred).length === 0) return config

  const next: Config = {
    ...config,
    modules: {
      ...config.modules,
      ...inferred,
    },
  }
  await (deps.writeConfig ?? writeConfig)(paths.configFile, next)
  return next
}
