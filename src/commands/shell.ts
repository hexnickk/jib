import { defineCommand } from 'citty'
import { consola } from 'consola'
import { composeFor } from './_compose.ts'
import { loadAppOrExit } from './_ctx.ts'

/**
 * `jib exec <app> [service] -- <cmd...>` and `jib run <app> <service> [-- <cmd...>]`.
 * citty's flag parser would eat the `--` separator, so we read from `rawArgs`
 * directly and do the parsing ourselves. Matches the Go implementation's
 * `parseExecArgs` / `parseRunArgs` semantics exactly.
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
  if (raw.length < 2)
    throw new Error('app name and service required — usage: jib run <app> <service> [-- <cmd>]')
  const [app, service, ...rest] = raw
  const dash = rest.indexOf('--')
  const cmd = dash === -1 ? rest : rest.slice(dash + 1)
  return { app: app as string, service: service as string, cmd }
}

async function handle(parts: ExecParts, mode: 'exec' | 'run'): Promise<void> {
  const { cfg, paths } = await loadAppOrExit(parts.app)
  const compose = composeFor(cfg, paths, parts.app)
  if (mode === 'exec') await compose.exec(parts.service, parts.cmd)
  else await compose.run(parts.service, parts.cmd)
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
      consola.log('usage: jib run <app> <service> [-- <cmd>]')
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
