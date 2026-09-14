import type { Config } from '@jib/config'
import { deployApp, deployCreateDeps } from '@jib/deploy'
import { type JibError, NotFoundError, errorsToJibError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { sourcesSync } from '@jib/sources'
import { tuiSpinner } from '@jib/tui'
import { notificationsNotifyDeployment } from '@/flows/notifications/deliver.ts'

export interface DeployRunResult {
  app: string
  durationMs: number
  preparedSha: string
  sha: string
  workdir: string
}

/** Owns deployment dependencies, preparation, progress, execution, and the final notification. */
export async function deployRun(
  ctx: { cfg: Config; paths: Paths },
  input: { app: string; trigger: 'manual' | 'auto'; ref?: string },
): Promise<JibError | DeployRunResult> {
  const app = ctx.cfg.apps[input.app]
  if (!app) {
    return new NotFoundError(`app "${input.app}" not found in config`)
  }
  const deps = deployCreateDeps(ctx.cfg, ctx.paths)
  const spinner = input.trigger === 'manual' ? tuiSpinner() : undefined
  const start = Date.now()
  let stage = 'prepare'
  let revision = app.image ?? ''
  let result: JibError | DeployRunResult
  try {
    spinner?.start(`preparing ${input.app}`)
    deps.log.info(`${input.app}: preparing source`)
    const ready = await sourcesSync(ctx.cfg, ctx.paths, { app: input.app }, input.ref)
    if (ready instanceof Error) {
      result = ready
    } else {
      revision = ready.sha
      deps.log.info(`${input.app}: repo ready @ ${ready.sha.slice(0, 8)}`)
      stage = 'lock'
      const deployed = await deployApp(
        deps,
        { app: input.app, trigger: input.trigger, workdir: ready.workdir, sha: ready.sha },
        (step, message) => {
          stage = step
          deps.log.info(`${input.app}: ${step}: ${message}`)
          spinner?.message(`${step}: ${message}`)
        },
      )
      result =
        deployed instanceof Error
          ? deployed
          : {
              app: input.app,
              durationMs: deployed.durationMs,
              preparedSha: ready.sha,
              sha: deployed.deployedSHA,
              workdir: ready.workdir,
            }
    }
  } catch (error) {
    result = errorsToJibError(error)
  }
  spinner?.stop(
    result instanceof Error
      ? `${input.app}: ${stage} failed`
      : `${input.app} deployed @ ${result.sha.slice(0, 8)} (${result.durationMs}ms)`,
  )
  // Lock contention is not a deployment. Preparation failures are actual failed attempts.
  if (stage !== 'lock') {
    await notificationsNotifyDeployment(ctx, {
      app: input.app,
      revision,
      ...(app.image ? {} : { ref: input.ref ?? app.branch }),
      trigger: input.trigger,
      success: !(result instanceof Error),
      stage,
      durationMs: Date.now() - start,
    })
  }
  return result
}
