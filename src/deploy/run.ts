import { CliError, isTextOutput } from '@jib/cli'
import type { Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { syncApp } from '@jib/sources'
import { spinner } from '@jib/tui'
import { createDeployEngine } from './engine.ts'

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
  sync?: typeof syncApp
}

export async function runDeploy(
  cfg: Config,
  paths: Paths,
  app: string,
  ref?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  deps: DeployRunDeps = {},
): Promise<DeployRunResult> {
  const showProgress = isTextOutput()
  const createSpin = deps.createSpinner ?? spinner
  const prepareSpin = showProgress ? createSpin() : null

  try {
    prepareSpin?.start(`[1/2] preparing ${app}`)
    const ready = await (deps.sync ?? syncApp)(cfg, paths, { app }, ref).catch((err) => {
      throw new CliError('deploy_failed', err instanceof Error ? err.message : String(err), {
        hint: 'fix repo access or ref selection, then retry `jib deploy ...`',
      })
    })
    prepareSpin?.stop(`[1/2] repo ready @ ${ready.sha.slice(0, 8)}`)

    const engine = (deps.createEngine ?? createDeployEngine)(cfg, paths)
    const deploySpin = showProgress ? createSpin() : null
    deploySpin?.start(`[2/2] deploying ${app}`)
    const deployed = await withTimeout(
      engine.deploy(
        { app, workdir: ready.workdir, sha: ready.sha, trigger: 'manual' },
        { emit: (step, message) => deploySpin?.message(`${step}: ${message}`) },
      ),
      timeoutMs,
    )
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
  } catch (err) {
    if (err instanceof CliError) throw err
    throw new CliError('deploy_failed', err instanceof Error ? err.message : String(err), {
      hint: deployFailureHint(err),
    })
  }
}

function deployFailureHint(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('EACCES') && message.includes('/opt/jib/')) {
    return 'repair /opt/jib ownership and permissions, then retry `jib deploy ...`'
  }
  return 'check docker compose output, then retry `jib deploy ...`'
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`deploy timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
