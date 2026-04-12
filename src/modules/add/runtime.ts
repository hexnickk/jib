import { CliError, cliIsTextOutput } from '@jib/cli'
import { configLoad } from '@jib/config'
import type { App, Config } from '@jib/config'
import { createIngressOperator, releaseIngress } from '@jib/ingress'
import type { Paths } from '@jib/paths'
import { consola } from 'consola'
import type { DeployRunResult } from '../../deploy/run.ts'
import { DefaultRemoveSupport, RemoveMissingAppError, runRemove } from '../remove/index.ts'
import type { AddFlowResult } from './types.ts'

export interface InterruptTrap {
  readonly interrupted: boolean
  dispose(): void
}

export function renderAddResult(
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

export function normalizeAddDeployError(error: unknown, app: string, configFile: string): Error {
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

export async function rollbackAddedApp(
  paths: Paths,
  app: string,
  originalCfg: Config,
  finalApp: App,
): Promise<void> {
  const cfgResult = await configLoad(paths.configFile)
  const cfg =
    cfgResult instanceof Error
      ? {
          ...originalCfg,
          apps: { ...originalCfg.apps, [app]: finalApp },
        }
      : cfgResult
  if (!cfg.apps[app]) return
  const result = await runRemove(
    {
      support: new DefaultRemoveSupport({
        paths,
        releaseIngress: (appName) => releaseIngress(createIngressOperator(paths), appName),
      }),
      observer: { warn: (message) => cliIsTextOutput() && consola.warn(message) },
    },
    { appName: app, cfg, configFile: paths.configFile, quiet: !cliIsTextOutput() },
  )
  if (result instanceof RemoveMissingAppError) return
}

export function trapInterrupt(): InterruptTrap {
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
