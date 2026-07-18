import { type App, configLoadAppContext } from '@jib/config'
import { InternalError, type JibError, NotFoundError, ValidationError } from '@jib/errors'
import { type Paths, pathsRepoPath } from '@jib/paths'
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

/** Chooses the target service when the user omitted it and compose only has one service. */
function resolveServiceResult(
  requested: string,
  appName: string,
  appCfg: App,
  paths: Paths,
): string | ValidationError {
  if (requested) {
    return requested
  }
  const dir = pathsRepoPath(paths, appName, appCfg.repo)
  const inspection = dockerInspectComposeApp(appCfg, dir)
  if (inspection instanceof Error) {
    return inspection
  }
  const services = inspection.services
  if (services.length === 1) {
    return services[0]?.name ?? ''
  }
  if (services.length === 0) {
    return new ValidationError(`app "${appName}" has no services in its compose file`)
  }
  return new ValidationError(
    `app "${appName}" has multiple services (${services.map((service) => service.name).join(', ')}); specify one explicitly`,
  )
}

/** Resolves app + service selection for `jib exec` / `jib run` and performs the compose action. */
export async function dockerHandleShell(
  parts: ExecParts,
  mode: 'exec' | 'run',
): Promise<JibError | undefined> {
  const loaded = await configLoadAppContext(parts.app)
  if (loaded instanceof Error) {
    return loaded
  }
  const { cfg, paths } = loaded
  const appCfg = cfg.apps[parts.app]
  if (!appCfg) {
    return new NotFoundError(`app "${parts.app}" not found in config`)
  }
  const service = resolveServiceResult(parts.service, parts.app, appCfg, paths)
  if (service instanceof Error) {
    return service
  }
  const compose = dockerComposeFor(cfg, paths, parts.app)
  if (compose instanceof Error) {
    return compose
  }
  const commandError =
    mode === 'exec' ? await compose.exec(service, parts.cmd) : await compose.run(service, parts.cmd)
  if (commandError) {
    return new InternalError(`${mode} failed for app "${parts.app}": ${commandError.message}`, {
      cause: commandError,
    })
  }
}
