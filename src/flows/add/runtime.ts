import type { DeployRunResult } from '@/flows/deploy/run.ts'
import { removeApp, removeCreateSupport } from '@/flows/remove/index.ts'
import { CliError, cliIsTextOutput } from '@jib/cli'
import type { App, Config } from '@jib/config'
import { configLoad } from '@jib/config'
import { InternalError, type JibError, NotFoundError } from '@jib/errors'
import { ingressCreateOperator, ingressRelease } from '@jib/ingress'
import type { Paths } from '@jib/paths'
import { consola } from 'consola'
import type { AddFlowResult } from './types.ts'

export interface InterruptTrap {
  readonly interrupted: boolean
  dispose(): void
}

/** Renders a completed add-and-deploy result for the command output contract. */
export function addRenderResult(
  app: string,
  repo: string,
  result: AddFlowResult,
  deploy: DeployRunResult,
) {
  const { finalApp, secretsWritten } = result
  if (secretsWritten > 0 && cliIsTextOutput()) {
    consola.success(`${secretsWritten} secret(s) set for ${app}`)
  }
  if (cliIsTextOutput()) {
    consola.success(`${app} deployed @ ${deploy.sha.slice(0, 8)} (${deploy.durationMs}ms)`)
    const ingress =
      finalApp.domains.length > 0
        ? finalApp.domains.map((d) => `${d.host} -> 127.0.0.1:${d.port}`).join('\n    ')
        : 'none'
    consola.box(
      `app "${app}" deployed\n  ingress:\n    ${ingress}\n  sha:    ${deploy.sha.slice(0, 8)}`,
    )
  }
  return {
    app,
    repo,
    composeFiles: finalApp.compose ?? [],
    durationMs: deploy.durationMs,
    preparedSha: deploy.preparedSha,
    routes: finalApp.domains.map((d) => ({
      containerPort: d.container_port ?? null,
      host: d.host,
      ingress: d.ingress ?? 'direct',
      port: d.port ?? null,
      service: d.service ?? null,
    })),
    secretsWritten,
    services: finalApp.services ?? [],
    sha: deploy.sha,
    workdir: deploy.workdir,
  }
}

/** Adds rollback guidance to an add/deploy failure at the command boundary. */
export function addNormalizeDeployError(error: unknown, app: string, configFile: string): CliError {
  const rollbackHint = `rolled back ${app} from ${configFile}; safe to retry: jib add ...`
  const message =
    error instanceof CliError && error.code === 'cancelled'
      ? 'add cancelled'
      : error instanceof Error
        ? error.message
        : String(error)
  const hint =
    error instanceof CliError && error.hint ? `${error.hint}\n${rollbackHint}` : rollbackHint
  return new CliError(
    error instanceof CliError && error.code === 'cancelled' ? 'cancelled' : 'add_failed',
    message,
    { hint },
  )
}

/** Removes an app created by a failed add attempt, treating a missing app as already rolled back. */
export async function addRollbackApp(
  paths: Paths,
  app: string,
  originalCfg: Config,
  finalApp: App,
): Promise<JibError | undefined> {
  const cfgResult = await configLoad(paths.configFile)
  const cfg =
    cfgResult instanceof Error
      ? {
          ...originalCfg,
          apps: { ...originalCfg.apps, [app]: finalApp },
        }
      : cfgResult
  if (!cfg.apps[app]) {
    return undefined
  }
  const result = await removeApp(
    {
      support: removeCreateSupport({
        paths,
        releaseIngress: (appName) => ingressRelease(ingressCreateOperator(paths), appName),
      }),
      observer: { warn: (message) => cliIsTextOutput() && consola.warn(message) },
    },
    { appName: app, cfg, configFile: paths.configFile, quiet: !cliIsTextOutput() },
  )
  if (result instanceof NotFoundError) {
    return undefined
  }
  if (result instanceof InternalError) {
    return result
  }
  return undefined
}

/** Installs SIGINT and SIGTERM handlers that allow the flow to observe cancellation safely. */
export function addTrapInterrupt(): InterruptTrap {
  let interrupted = false
  const markInterrupted = () => {
    interrupted = true
  }
  process.once('SIGINT', markInterrupted)
  process.once('SIGTERM', markInterrupted)
  return {
    dispose() {
      process.off('SIGINT', markInterrupted)
      process.off('SIGTERM', markInterrupted)
    },
    get interrupted() {
      return interrupted
    },
  }
}
