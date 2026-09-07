import { cliIsTextOutput } from '@jib/cli'
import type { Config } from '@jib/config'
import { type DeployResult, deployApp, deployCreateDeps } from '@jib/deploy'
import { InternalError, type JibError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { type PreparedSource, sourcesSync } from '@jib/sources'
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
  const showProgress = cliIsTextOutput()
  const createSpin = deps.createSpinner ?? tuiSpinner
  const prepareSpin = showProgress ? createSpin() : undefined

  prepareSpin?.start(`[1/2] preparing ${app}`)
  let ready: PreparedSource | InternalError
  try {
    const result = await (deps.sync ?? sourcesSync)(cfg, paths, { app }, ref)
    ready = result instanceof Error ? new InternalError(result.message, { cause: result }) : result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ready = new InternalError(message, { cause: error })
  }
  if (ready instanceof Error) {
    prepareSpin?.stop(`[1/2] failed to prepare ${app}`)
    return ready
  }
  prepareSpin?.stop(`[1/2] repo ready @ ${ready.sha.slice(0, 8)}`)

  const deploySpin = showProgress ? createSpin() : undefined
  deploySpin?.start(`[2/2] deploying ${app}`)
  let deployed: JibError | DeployResult
  try {
    deployed = await (deps.deployPrepared ?? deployApp)(
      (deps.createDeps ?? deployCreateDeps)(cfg, paths),
      { app, workdir: ready.workdir, sha: ready.sha, trigger: 'manual' },
      { emit: (step, message) => deploySpin?.message(`${step}: ${message}`) },
    )
  } catch (error) {
    deploySpin?.stop(`[2/2] failed to deploy ${app}`)
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(message, { cause: error })
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
