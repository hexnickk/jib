import { cliIsTextOutput } from '@jib/cli'
import type { Config } from '@jib/config'
import { type DeployResult, deployApp, deployCreateDeps } from '@jib/deploy'
import { InternalError } from '@jib/errors'
import type { JibError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { sourcesSync } from '@jib/sources'
import { tuiSpinner } from '@jib/tui'

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
  createDeps?: typeof deployCreateDeps
  createSpinner?: () => DeploySpinner
  deployPrepared?: typeof deployApp
  sync?: typeof sourcesSync
}

/** Runs prepare + deploy and returns its result or a shared typed error. */
export async function runDeploy(
  cfg: Config,
  paths: Paths,
  app: string,
  ref?: string,
  deps: DeployRunDeps = {},
): Promise<DeployRunResult | InternalError> {
  return runDeployResult(cfg, paths, app, ref, deps)
}

/** Runs prepare + deploy and maps dependency failures to internal result errors. */
export async function runDeployResult(
  cfg: Config,
  paths: Paths,
  app: string,
  ref?: string,
  deps: DeployRunDeps = {},
): Promise<InternalError | DeployRunResult> {
  const showProgress = cliIsTextOutput()
  const createSpin = deps.createSpinner ?? tuiSpinner
  const prepareSpin = showProgress ? createSpin() : null

  prepareSpin?.start(`[1/2] preparing ${app}`)
  const ready = await syncDeployApp(cfg, paths, app, ref, deps.sync ?? sourcesSync)
  if (ready instanceof Error) {
    prepareSpin?.stop(`[1/2] failed to prepare ${app}`)
    return ready
  }
  prepareSpin?.stop(`[1/2] repo ready @ ${ready.sha.slice(0, 8)}`)

  const deploySpin = showProgress ? createSpin() : null
  deploySpin?.start(`[2/2] deploying ${app}`)
  const deployPromise = startDeployPreparedApp(
    deps.createDeps ?? deployCreateDeps,
    deps.deployPrepared ?? deployApp,
    cfg,
    paths,
    app,
    ready,
    deploySpin,
  )
  if (deployPromise instanceof Error) {
    deploySpin?.stop(`[2/2] failed to deploy ${app}`)
    return deployPromise
  }

  let deployed: JibError | DeployResult
  try {
    deployed = await deployPromise
  } catch (error) {
    deploySpin?.stop(`[2/2] failed to deploy ${app}`)
    return new InternalError(toErrorMessage(error), { cause: error })
  }
  if (deployed instanceof Error) {
    deploySpin?.stop(`[2/2] failed to deploy ${app}`)
    return deployed instanceof InternalError
      ? deployed
      : new InternalError(deployed.message, { cause: deployed })
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

/** Synchronizes one app checkout and maps source failures to an internal result error. */
async function syncDeployApp(
  cfg: Config,
  paths: Paths,
  app: string,
  ref: string | undefined,
  sync: typeof sourcesSync,
): Promise<InternalError | { workdir: string; sha: string }> {
  try {
    const result = await sync(cfg, paths, { app }, ref)
    return result instanceof Error ? new InternalError(result.message, { cause: result }) : result
  } catch (error) {
    return new InternalError(toErrorMessage(error), { cause: error })
  }
}

/** Starts deployment after preparation and maps synchronous setup failures to an internal error. */
function startDeployPreparedApp(
  createDeps: typeof deployCreateDeps,
  runDeployApp: typeof deployApp,
  cfg: Config,
  paths: Paths,
  app: string,
  ready: { workdir: string; sha: string },
  deploySpin: DeploySpinner | null,
): InternalError | Promise<JibError | DeployResult> {
  try {
    return runDeployApp(
      createDeps(cfg, paths),
      { app, workdir: ready.workdir, sha: ready.sha, trigger: 'manual' },
      { emit: (step, message) => deploySpin?.message(`${step}: ${message}`) },
    )
  } catch (error) {
    return new InternalError(toErrorMessage(error), { cause: error })
  }
}

/** Converts an unknown caught value into an error message for a typed internal failure. */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
