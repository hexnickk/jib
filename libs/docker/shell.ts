import type { App } from '@jib/config'
import { loadAppOrExit } from '@jib/config'
import { type Paths, repoPath } from '@jib/core'
import { composeFor } from './compose-for.ts'
import { parseComposeServices } from './parse.ts'

/**
 * Shared arg parsing and service resolution for `jib exec` and `jib run`.
 * citty's flag parser eats `--`, so both commands parse from `rawArgs`.
 */

export interface ExecParts {
  app: string
  service: string
  cmd: string[]
}

export function parseExecArgs(raw: string[]): ExecParts {
  if (raw.length === 0)
    throw new Error('missing app name — usage: jib exec <app> [service] -- <cmd>')
  const [app, ...rest] = raw
  const dash = rest.indexOf('--')
  if (dash === -1) {
    if (rest.length === 0)
      throw new Error('command required after app — usage: jib exec <app> [service] -- <cmd>')
    return { app: app as string, service: rest[0] as string, cmd: rest.slice(1) }
  }
  const before = rest.slice(0, dash)
  const after = rest.slice(dash + 1)
  return { app: app as string, service: (before[0] ?? '') as string, cmd: after }
}

export function parseRunArgs(raw: string[]): ExecParts {
  if (raw.length === 0)
    throw new Error('missing app name — usage: jib run <app> [service] [-- <cmd>]')
  const [app, ...rest] = raw
  const dash = rest.indexOf('--')
  if (dash === -1) {
    return { app: app as string, service: (rest[0] ?? '') as string, cmd: rest.slice(1) }
  }
  const before = rest.slice(0, dash)
  const after = rest.slice(dash + 1)
  return { app: app as string, service: (before[0] ?? '') as string, cmd: after }
}

function resolveService(requested: string, appName: string, appCfg: App, paths: Paths): string {
  if (requested) return requested
  const dir = repoPath(paths, appName, appCfg.repo)
  const services = parseComposeServices(dir, appCfg.compose ?? [])
  if (services.length === 1) return services[0]?.name ?? ''
  if (services.length === 0) throw new Error(`app "${appName}" has no services in its compose file`)
  const names = services.map((s) => s.name).join(', ')
  throw new Error(`app "${appName}" has multiple services (${names}); specify one explicitly`)
}

export async function handleShell(parts: ExecParts, mode: 'exec' | 'run'): Promise<void> {
  const { cfg, paths } = await loadAppOrExit(parts.app)
  const appCfg = cfg.apps[parts.app]
  if (!appCfg) throw new Error(`app "${parts.app}" not in config`)
  const service = resolveService(parts.service, parts.app, appCfg, paths)
  const compose = composeFor(cfg, paths, parts.app)
  if (mode === 'exec') await compose.exec(service, parts.cmd)
  else await compose.run(service, parts.cmd)
}
