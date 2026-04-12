import type { App } from '@jib/config'
import { loadAppOrExit } from '@jib/config'
import { type Paths, repoPath } from '@jib/paths'
import { composeForResult } from './compose-for.ts'
import {
  DockerAppHasNoServicesError,
  DockerAppNotFoundError,
  DockerServiceSelectionRequiredError,
  ExecArgsMissingAppError,
  ExecArgsMissingCommandError,
  RunArgsMissingAppError,
} from './errors.ts'
import { parseComposeServices } from './parse.ts'

/**
 * Shared arg parsing and service resolution for `jib exec` and `jib run`.
 * Both commands parse the raw argv tail directly so `--` passthrough stays intact.
 */

export interface ExecParts {
  app: string
  service: string
  cmd: string[]
}

export type ParseExecArgsError = ExecArgsMissingAppError | ExecArgsMissingCommandError

export function parseExecArgsResult(raw: string[]): ExecParts | ParseExecArgsError {
  if (raw.length === 0) return new ExecArgsMissingAppError()
  const [app, ...rest] = raw
  const dash = rest.indexOf('--')
  if (dash === -1) {
    if (rest.length === 0) return new ExecArgsMissingCommandError()
    return { app: app as string, service: rest[0] as string, cmd: rest.slice(1) }
  }
  const before = rest.slice(0, dash)
  const after = rest.slice(dash + 1)
  return { app: app as string, service: (before[0] ?? '') as string, cmd: after }
}

export function parseExecArgs(raw: string[]): ExecParts {
  const parsed = parseExecArgsResult(raw)
  if (parsed instanceof ExecArgsMissingAppError || parsed instanceof ExecArgsMissingCommandError) {
    throw parsed
  }
  return parsed
}

export function parseRunArgsResult(raw: string[]): ExecParts | RunArgsMissingAppError {
  if (raw.length === 0) return new RunArgsMissingAppError()
  const [app, ...rest] = raw
  const dash = rest.indexOf('--')
  if (dash === -1) {
    return { app: app as string, service: (rest[0] ?? '') as string, cmd: rest.slice(1) }
  }
  const before = rest.slice(0, dash)
  const after = rest.slice(dash + 1)
  return { app: app as string, service: (before[0] ?? '') as string, cmd: after }
}

export function parseRunArgs(raw: string[]): ExecParts {
  const parsed = parseRunArgsResult(raw)
  if (parsed instanceof RunArgsMissingAppError) throw parsed
  return parsed
}

type ResolveServiceError = DockerAppHasNoServicesError | DockerServiceSelectionRequiredError
export type HandleShellError = DockerAppNotFoundError | ResolveServiceError

function resolveServiceResult(
  requested: string,
  appName: string,
  appCfg: App,
  paths: Paths,
): string | ResolveServiceError {
  if (requested) return requested
  const dir = repoPath(paths, appName, appCfg.repo)
  const services = parseComposeServices(dir, appCfg.compose ?? [])
  if (services.length === 1) return services[0]?.name ?? ''
  if (services.length === 0) return new DockerAppHasNoServicesError(appName)
  return new DockerServiceSelectionRequiredError(
    appName,
    services.map((service) => service.name),
  )
}

export async function handleShellResult(
  parts: ExecParts,
  mode: 'exec' | 'run',
): Promise<HandleShellError | undefined> {
  const { cfg, paths } = await loadAppOrExit(parts.app)
  const appCfg = cfg.apps[parts.app]
  if (!appCfg) return new DockerAppNotFoundError(parts.app)
  const service = resolveServiceResult(parts.service, parts.app, appCfg, paths)
  if (service instanceof DockerAppHasNoServicesError) return service
  if (service instanceof DockerServiceSelectionRequiredError) return service
  const compose = composeForResult(cfg, paths, parts.app)
  if (compose instanceof DockerAppNotFoundError) return compose
  if (mode === 'exec') await compose.exec(service, parts.cmd)
  else await compose.run(service, parts.cmd)
}

export async function handleShell(parts: ExecParts, mode: 'exec' | 'run'): Promise<void> {
  const result = await handleShellResult(parts, mode)
  if (result instanceof DockerAppNotFoundError) throw result
  if (result instanceof DockerAppHasNoServicesError) throw result
  if (result instanceof DockerServiceSelectionRequiredError) throw result
}
