import { CliError, isTextOutput } from '@jib/cli'
import { loadConfig } from '@jib/config'
import type { App, Config } from '@jib/config'
import { createIngressOperator, releaseIngress } from '@jib/ingress'
import type { Paths } from '@jib/paths'
import { consola } from 'consola'
import type { DeployRunResult } from '../../deploy/run.ts'
import { DefaultRemoveSupport, RemoveService } from '../remove/index.ts'
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
  if (secretsWritten > 0 && isTextOutput()) {
    consola.success(`${secretsWritten} secret(s) set for ${app}`)
  }
  if (isTextOutput()) {
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
  const cfg = await loadConfig(paths.configFile).catch(() => ({
    ...originalCfg,
    apps: { ...originalCfg.apps, [app]: finalApp },
  }))
  if (!cfg.apps[app]) return
  const service = new RemoveService(
    new DefaultRemoveSupport({
      paths,
      releaseIngress: (appName) => releaseIngress(createIngressOperator(paths), appName),
    }),
    { warn: (message) => isTextOutput() && consola.warn(message) },
  )
  await service.run({ appName: app, cfg, configFile: paths.configFile, quiet: !isTextOutput() })
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
