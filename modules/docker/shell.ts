import { type App, ConfigError, MissingConfigAppError, configLoadAppContext } from '@jib/config'
import { type Paths, repoPath } from '@jib/paths'
import { dockerComposeFor } from './compose-for.ts'
import {
  DockerAppHasNoServicesError,
  DockerAppNotFoundError,
  DockerCommandError,
  DockerServiceSelectionRequiredError,
  ExecArgsMissingAppError,
  ExecArgsMissingCommandError,
  RunArgsMissingAppError,
} from './errors.ts'
import { ComposeInspectionError, dockerInspectComposeApp } from './resolve.ts'

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

/** Parses raw `jib exec` argv while preserving `--` passthrough for the container command. */
export function dockerParseExecArgs(raw: string[]): ExecParts | ParseExecArgsError {
  if (raw.length === 0) return new ExecArgsMissingAppError()
  const [app, ...rest] = raw
  const dash = rest.indexOf('--')
  if (dash === -1) {
    if (rest.length === 0) return new ExecArgsMissingCommandError()
    return { app: app as string, service: rest[0] as string, cmd: rest.slice(1) }
  }
  const before = rest.slice(0, dash)
  const after = rest.slice(dash + 1)
  if (after.length === 0) return new ExecArgsMissingCommandError()
  return { app: app as string, service: (before[0] ?? '') as string, cmd: after }
}

/** Parses raw `jib run` argv while preserving `--` passthrough for the container command. */
export function dockerParseRunArgs(raw: string[]): ExecParts | RunArgsMissingAppError {
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

type ResolveServiceError =
  | ComposeInspectionError
  | DockerAppHasNoServicesError
  | DockerServiceSelectionRequiredError
export type HandleShellError =
  | ConfigError
  | DockerAppNotFoundError
  | DockerCommandError
  | ResolveServiceError

/** Chooses the target service when the user omitted it and compose only has one service. */
function resolveServiceResult(
  requested: string,
  appName: string,
  appCfg: App,
  paths: Paths,
): string | ResolveServiceError {
  if (requested) return requested
  const dir = repoPath(paths, appName, appCfg.repo)
  const inspection = dockerInspectComposeApp(appCfg, dir)
  if (inspection instanceof ComposeInspectionError) return inspection
  const services = inspection.services
  if (services.length === 1) return services[0]?.name ?? ''
  if (services.length === 0) return new DockerAppHasNoServicesError(appName)
  return new DockerServiceSelectionRequiredError(
    appName,
    services.map((service) => service.name),
  )
}

/**
 * Resolves app + service selection for `jib exec` / `jib run` and performs the
 * compose action. Returns typed selection/config errors instead of throwing.
 */
export async function dockerHandleShell(
  parts: ExecParts,
  mode: 'exec' | 'run',
): Promise<HandleShellError | undefined> {
  const loaded = await configLoadAppContext(parts.app)
  if (loaded instanceof MissingConfigAppError) return new DockerAppNotFoundError(parts.app)
  if (loaded instanceof ConfigError) return loaded
  const { cfg, paths } = loaded
  const appCfg = cfg.apps[parts.app]
  if (!appCfg) return new DockerAppNotFoundError(parts.app)
  const service = resolveServiceResult(parts.service, parts.app, appCfg, paths)
  if (service instanceof ComposeInspectionError) return service
  if (service instanceof DockerAppHasNoServicesError) return service
  if (service instanceof DockerServiceSelectionRequiredError) return service
  const compose = dockerComposeFor(cfg, paths, parts.app)
  if (compose instanceof DockerAppNotFoundError) return compose
  try {
    if (mode === 'exec') await compose.exec(service, parts.cmd)
    else await compose.run(service, parts.cmd)
  } catch (error) {
    return new DockerCommandError(mode, parts.app, toErrorMessage(error), {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
