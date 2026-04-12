import { CliError, cliIsTextOutput } from '@jib/cli'
import type { Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { sourcesSync } from '@jib/sources'
import { spinner } from '@jib/tui'
import { createDeployEngine } from './engine.ts'
import {
  DeployExecuteError,
  DeployPrepareError,
  type DeployRunError,
  DeployTimeoutError,
} from './errors.ts'

export const DEFAULT_TIMEOUT_MS = 5 * 60_000

interface DeploySpinner {
  message(value: string): void
  start(value: string): void
  stop(value: string): void
}

export interface DeployRunResult {
  app: string
  durationMs: number
  preparedSha: string
  sha: string
  workdir: string
}

interface DeployRunDeps {
  createEngine?: typeof createDeployEngine
  createSpinner?: () => DeploySpinner
  sync?: typeof sourcesSync
}

export async function runDeploy(
  cfg: Config,
  paths: Paths,
  app: string,
  ref?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  deps: DeployRunDeps = {},
): Promise<DeployRunResult> {
  const result = await runDeployResult(cfg, paths, app, ref, timeoutMs, deps)
  if (result instanceof Error) throw toCliError(result)
  return result
}

export async function runDeployResult(
  cfg: Config,
  paths: Paths,
  app: string,
  ref?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  deps: DeployRunDeps = {},
): Promise<DeployRunError | DeployRunResult> {
  const showProgress = cliIsTextOutput()
  const createSpin = deps.createSpinner ?? spinner
  const prepareSpin = showProgress ? createSpin() : null

  prepareSpin?.start(`[1/2] preparing ${app}`)
  const ready = await syncDeployApp(cfg, paths, app, ref, deps.sync ?? sourcesSync)
  if (ready instanceof DeployPrepareError) {
    prepareSpin?.stop(`[1/2] failed to prepare ${app}`)
    return ready
  }
  prepareSpin?.stop(`[1/2] repo ready @ ${ready.sha.slice(0, 8)}`)

  const engine = (deps.createEngine ?? createDeployEngine)(cfg, paths)
  const deploySpin = showProgress ? createSpin() : null
  deploySpin?.start(`[2/2] deploying ${app}`)
  const deployPromise = createDeployPromise(engine, app, ready, deploySpin)
  if (deployPromise instanceof Error) {
    deploySpin?.stop(`[2/2] failed to deploy ${app}`)
    return deployPromise
  }
  const deployed = await deployWithTimeout(deployPromise, timeoutMs)
  if (deployed instanceof Error) {
    deploySpin?.stop(`[2/2] failed to deploy ${app}`)
    return deployed
  }
  deploySpin?.stop(
    `[2/2] ${app} deployed @ ${deployed.deployedSHA.slice(0, 8)} (${deployed.durationMs}ms)`,
  )
  return {
    app,
    durationMs: deployed.durationMs,
    preparedSha: ready.sha,
    sha: deployed.deployedSHA,
    workdir: ready.workdir,
  }
}

async function syncDeployApp(
  cfg: Config,
  paths: Paths,
  app: string,
  ref: string | undefined,
  sync: typeof sourcesSync,
): Promise<DeployPrepareError | { workdir: string; sha: string }> {
  try {
    const result = await sync(cfg, paths, { app }, ref)
    return result instanceof Error
      ? new DeployPrepareError(result.message, { cause: result })
      : result
  } catch (error) {
    return new DeployPrepareError(toErrorMessage(error), { cause: toErrorCause(error) })
  }
}

function deployFailureHint(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('EACCES') && message.includes('/opt/jib/')) {
    return 'repair /opt/jib ownership and permissions, then retry `jib deploy ...`'
  }
  return 'check docker compose output, then retry `jib deploy ...`'
}

function createDeployPromise(
  engine: ReturnType<typeof createDeployEngine>,
  app: string,
  ready: { workdir: string; sha: string },
  deploySpin: DeploySpinner | null,
) {
  try {
    return engine.deploy(
      { app, workdir: ready.workdir, sha: ready.sha, trigger: 'manual' },
      { emit: (step, message) => deploySpin?.message(`${step}: ${message}`) },
    )
  } catch (error) {
    return new DeployExecuteError(toErrorMessage(error), { cause: toErrorCause(error) })
  }
}

function deployWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<DeployExecuteError | DeployTimeoutError | T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(new DeployTimeoutError(timeoutMs)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        resolve(
          error instanceof DeployExecuteError
            ? error
            : new DeployExecuteError(toErrorMessage(error), { cause: toErrorCause(error) }),
        )
      },
    )
  })
}

function toCliError(error: DeployRunError): CliError {
  if (error instanceof DeployPrepareError) {
    return new CliError('deploy_failed', error.message, {
      cause: error,
      hint: 'fix repo access or ref selection, then retry `jib deploy ...`',
    })
  }
  return new CliError('deploy_failed', error.message, {
    cause: error,
    hint: deployFailureHint(error),
  })
}

function toErrorCause(error: unknown): Error | undefined {
  return error instanceof Error ? error : undefined
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
