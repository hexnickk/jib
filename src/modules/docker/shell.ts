import { configLoadContext } from '@jib/config'
import { InternalError, type JibError, NotFoundError, ValidationError } from '@jib/errors'
import { pathsRepoPath } from '@jib/paths'
import { dockerComposeFor } from './compose-for.ts'
import { dockerInspectComposeApp } from './resolve.ts'

/** Shared arg parsing and service resolution for `jib exec` and `jib run`. */
export interface ExecParts {
  app: string
  service: string
  cmd: string[]
}

/** Parses raw `jib exec` argv while preserving `--` passthrough for the container command. */
export function dockerParseExecArgs(raw: string[]): ExecParts | ValidationError {
  if (raw.length === 0) {
    return new ValidationError('missing app name — usage: jib exec <app> [service] -- <cmd>')
  }
  const [app, ...rest] = raw
  const dash = rest.indexOf('--')
  if (dash === -1) {
    if (rest.length === 0) {
      return new ValidationError(
        'command required after app — usage: jib exec <app> [service] -- <cmd>',
      )
    }
    return { app: app as string, service: rest[0] as string, cmd: rest.slice(1) }
  }
  const before = rest.slice(0, dash)
  const after = rest.slice(dash + 1)
  if (after.length === 0) {
    return new ValidationError(
      'command required after app — usage: jib exec <app> [service] -- <cmd>',
    )
  }
  return { app: app as string, service: (before[0] ?? '') as string, cmd: after }
}

/** Parses raw `jib run` argv while preserving `--` passthrough for the container command. */
export function dockerParseRunArgs(raw: string[]): ExecParts | ValidationError {
  if (raw.length === 0) {
    return new ValidationError('missing app name — usage: jib run <app> [service] [-- <cmd>]')
  }
  const [app, ...rest] = raw
  const dash = rest.indexOf('--')
  if (dash === -1) {
    return { app: app as string, service: (rest[0] ?? '') as string, cmd: rest.slice(1) }
  }
  const before = rest.slice(0, dash)
  const after = rest.slice(dash + 1)
  return { app: app as string, service: (before[0] ?? '') as string, cmd: after }
}

/** Executes a command in an existing app container. */
export async function dockerExecApp(parts: ExecParts): Promise<JibError | undefined> {
  const resolved = await resolveShell(parts)
  if (resolved instanceof Error) {
    return resolved
  }
  const error = await resolved.compose.exec(resolved.service, parts.cmd)
  if (error) {
    return new InternalError(`exec failed for app "${parts.app}": ${error.message}`, {
      cause: error,
    })
  }
}

/** Runs a one-off app container, using its default command when none is supplied. */
export async function dockerRunApp(parts: ExecParts): Promise<JibError | undefined> {
  const resolved = await resolveShell(parts)
  if (resolved instanceof Error) {
    return resolved
  }
  const error = await resolved.compose.run(resolved.service, parts.cmd)
  if (error) {
    return new InternalError(`run failed for app "${parts.app}": ${error.message}`, {
      cause: error,
    })
  }
}

/** Loads the app's Compose runner and resolves an omitted service without starting containers. */
async function resolveShell(parts: ExecParts) {
  const loaded = await configLoadContext()
  if (loaded instanceof Error) {
    return loaded
  }
  const { cfg, paths } = loaded
  const appCfg = cfg.apps[parts.app]
  if (!appCfg) {
    return new NotFoundError(`app "${parts.app}" not found in config`)
  }
  let service = parts.service
  if (!service) {
    const dir = pathsRepoPath(paths, parts.app, appCfg.repo)
    const inspection = dockerInspectComposeApp(dir, appCfg.compose)
    if (inspection instanceof Error) {
      return inspection
    }
    const services = inspection.services
    if (services.length > 1) {
      return new ValidationError(
        `app "${parts.app}" has multiple services (${services.map((entry) => entry.name).join(', ')}); specify one explicitly`,
      )
    }
    service = services[0]?.name ?? ''
  }
  const compose = dockerComposeFor(cfg, paths, parts.app)
  if (compose instanceof Error) {
    return compose
  }
  return { compose, service }
}
