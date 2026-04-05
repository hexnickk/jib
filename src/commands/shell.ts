import type { App } from '@jib/config'
import { type Paths, repoPath } from '@jib/core'
import { parseComposeServices } from '@jib/docker'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { composeFor } from './_compose.ts'
import { loadAppOrExit } from './_ctx.ts'

/**
 * `jib exec <app> [service] -- <cmd...>` and `jib run <app> [service] [-- <cmd...>]`.
 * citty's flag parser would eat the `--` separator, so we read from `rawArgs`
 * directly and do the parsing ourselves.
 *
 * Service is optional in both: if the app's compose file has exactly one
 * service, we auto-resolve. Multi-service apps must name a service explicitly
 * so `jib run fullstack api -- node debug.js` stays unambiguous.
 */

interface ExecParts {
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
    // No `--`: first leftover token (if any) is the service, the rest is cmd.
    return { app: app as string, service: (rest[0] ?? '') as string, cmd: rest.slice(1) }
  }
  const before = rest.slice(0, dash)
  const after = rest.slice(dash + 1)
  return { app: app as string, service: (before[0] ?? '') as string, cmd: after }
}

/**
 * If `service` is empty, pick the sole service from the app's compose file.
 * Mirrors `_compose_resolve.ts` which does the same for `jib add` domain
 * resolution: single-service compose auto-targets; multi-service compose
 * requires the caller to be explicit.
 */
function resolveService(
  requested: string,
  appName: string,
  appCfg: App,
  paths: Paths,
): string {
  if (requested) return requested
  const dir = repoPath(paths, appName, appCfg.repo)
  const services = parseComposeServices(dir, appCfg.compose ?? [])
  if (services.length === 1) return services[0]?.name ?? ''
  if (services.length === 0)
    throw new Error(`app "${appName}" has no services in its compose file`)
  const names = services.map((s) => s.name).join(', ')
  throw new Error(
    `app "${appName}" has multiple services (${names}); specify one explicitly`,
  )
}

async function handle(parts: ExecParts, mode: 'exec' | 'run'): Promise<void> {
  const { cfg, paths } = await loadAppOrExit(parts.app)
  const appCfg = cfg.apps[parts.app]
  if (!appCfg) throw new Error(`app "${parts.app}" not in config`)
  const service = resolveService(parts.service, parts.app, appCfg, paths)
  const compose = composeFor(cfg, paths, parts.app)
  if (mode === 'exec') await compose.exec(service, parts.cmd)
  else await compose.run(service, parts.cmd)
}

export const execCmd = defineCommand({
  meta: { name: 'exec', description: 'Execute command in a running container' },
  async run({ rawArgs }) {
    if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
      consola.log('usage: jib exec <app> [service] -- <cmd>')
      return
    }
    try {
      await handle(parseExecArgs(rawArgs), 'exec')
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  },
})

export const runCmd = defineCommand({
  meta: { name: 'run', description: 'Run a one-off command in a new container' },
  async run({ rawArgs }) {
    if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
      consola.log('usage: jib run <app> [service] [-- <cmd>]')
      return
    }
    try {
      await handle(parseRunArgs(rawArgs), 'run')
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  },
})
