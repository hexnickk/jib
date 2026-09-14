import { rm } from 'node:fs/promises'
import { type App, configLoad, configWrite } from '@jib/config'
import type { ComposeInspection } from '@jib/docker'
import { CancelledError, InternalError, type JibError, errorsToJibError } from '@jib/errors'
import { ingressClaim, ingressCreateOperator } from '@jib/ingress'
import { type Logger, loggingCreateLogger } from '@jib/logging'
import { pathsManagedComposePath } from '@jib/paths'
import { secretsRemove, secretsUpsert } from '@jib/secrets'
import { sourcesCloneForInspection, sourcesRemoveCheckout } from '@jib/sources'
import { tuiSpinner } from '@jib/tui'
import { type Step, txRunSteps } from '@jib/tx'
import { addPrepareDockerHubWorkdir } from './dockerhub.ts'
import { addInspectCompose } from './inspect.ts'
import { addConfirmPlan } from './plan.ts'
import { addBuildResolvedApp, addCollectGuidedInputs } from './resolve.ts'
import type { AddFlowObserver, AddFlowParams, AddFlowResult, GuidedInputs } from './types.ts'

interface AddRunContext {
  readonly params: AddFlowParams
  readonly observer: AddFlowObserver
  readonly log: Logger
  inspection: ComposeInspection
  workdir: string
  guided: GuidedInputs
  finalApp: App
  secretsWritten: number
}

/** Registers an app transactionally, rolling back completed steps on failure or cancellation. */
export async function addRun(
  ctx: AddFlowParams,
  observer: AddFlowObserver = {},
): Promise<AddFlowResult | JibError> {
  const state: AddRunContext = {
    params: ctx,
    observer,
    log: loggingCreateLogger('add'),
    inspection: { composeFiles: [], services: [] },
    workdir: '',
    guided: { domains: [], configEntries: [] },
    finalApp: ctx.draftApp,
    secretsWritten: 0,
  }

  observer.onStateChange?.('inputs_ready')

  const error = await txRunSteps(
    state,
    [
      prepareRepoStep,
      inspectComposeStep,
      collectGuidedInputsStep,
      resolveAppStep,
      confirmPlanStep,
      writeConfigStep,
      writeSecretsStep,
      claimIngressStep,
    ],
    {
      signal: ctx.signal ?? { cancelled: false },
      cancelled: () => new CancelledError('add cancelled'),
    },
  )
  if (error) {
    return error
  }
  return { finalApp: state.finalApp, secretsWritten: state.secretsWritten }
}

const prepareRepoStep: Step<AddRunContext, string, JibError> = {
  name: 'repo',
  async up(ctx) {
    const inspectionCheckout = await sourcesCloneForInspection(ctx.params.cfg, ctx.params.paths, {
      app: ctx.params.appName,
      repo: ctx.params.inputs.repo,
      branch: ctx.params.draftApp.branch,
      ...(ctx.params.args.source ? { source: ctx.params.args.source } : {}),
    })
    if (inspectionCheckout instanceof Error) {
      return inspectionCheckout
    }
    const dockerHubWorkdir = await addPrepareDockerHubWorkdir(
      ctx.params.paths,
      ctx.params.appName,
      ctx.params.inputs.repo,
      ctx.params.inputs.persistPaths,
    )
    if (dockerHubWorkdir instanceof Error) {
      return dockerHubWorkdir
    }
    ctx.workdir = dockerHubWorkdir ?? inspectionCheckout.workdir
    ctx.observer.onStateChange?.('repo_prepared')
    return ctx.params.draftApp.image ? 'local' : ctx.params.inputs.repo
  },
  async down(ctx, repo) {
    try {
      return await sourcesRemoveCheckout(ctx.params.paths, ctx.params.appName, repo)
    } catch (error) {
      return errorsToJibError(error)
    }
  },
}

const inspectComposeStep: Step<AddRunContext, undefined, JibError> = {
  name: 'compose inspection',
  async up(ctx) {
    const inspection = await addInspectCompose(ctx.params.draftApp, ctx.workdir)
    if (inspection instanceof Error) {
      return inspection
    }
    ctx.inspection = inspection
    ctx.observer.onStateChange?.('compose_inspected')
    return undefined
  },
}

const collectGuidedInputsStep: Step<AddRunContext, undefined, JibError> = {
  name: 'guided inputs',
  async up(ctx) {
    const guided = await addCollectGuidedInputs(ctx.params.inputs, ctx.inspection.services)
    if (guided instanceof Error) {
      return guided
    }
    ctx.guided = guided
    ctx.observer.onStateChange?.('guided_inputs_collected')
    return undefined
  },
}

const resolveAppStep: Step<AddRunContext, boolean, JibError> = {
  name: 'resolved app',
  async up(ctx) {
    const finalApp = await addBuildResolvedApp(
      { cfg: ctx.params.cfg, paths: ctx.params.paths },
      {
        appName: ctx.params.appName,
        workdir: ctx.workdir,
        args: ctx.params.args,
        inputs: ctx.params.inputs,
        inspection: ctx.inspection,
        guided: ctx.guided,
      },
    )
    if (finalApp instanceof Error) {
      return finalApp
    }
    ctx.finalApp = finalApp
    ctx.observer.onStateChange?.('app_resolved')
    return (
      ctx.finalApp.compose?.includes(
        pathsManagedComposePath(ctx.params.paths, ctx.params.appName),
      ) ?? false
    )
  },
  async down(ctx, managedComposeWritten) {
    if (!managedComposeWritten) {
      return undefined
    }
    try {
      await rm(pathsManagedComposePath(ctx.params.paths, ctx.params.appName), { force: true })
      return undefined
    } catch (error) {
      return errorsToJibError(error)
    }
  },
}

const confirmPlanStep: Step<AddRunContext, undefined, JibError> = {
  name: 'plan confirmation',
  async up(ctx) {
    const result = await addConfirmPlan(
      ctx.params.appName,
      ctx.inspection,
      ctx.finalApp,
      ctx.guided.configEntries,
    )
    if (result instanceof Error) {
      return result
    }
    ctx.observer.onStateChange?.('confirmed')
    return undefined
  },
}

/** Writes the final app config and rolls it back if a later step fails. */
const writeConfigStep: Step<AddRunContext, undefined, JibError> = {
  name: 'config',
  async up(ctx) {
    const finalCfg = {
      ...ctx.params.cfg,
      apps: { ...ctx.params.cfg.apps, [ctx.params.appName]: ctx.finalApp },
    }
    const error = await configWrite(ctx.params.configFile, finalCfg)
    if (error instanceof Error) {
      return error
    }
    ctx.observer.onStateChange?.('config_written')
    return undefined
  },
  async down(ctx) {
    const current = await configLoad(ctx.params.configFile)
    const loaded = current instanceof Error ? ctx.params.cfg : current
    if (current instanceof Error) {
      ctx.log.warn(`config cleanup load: ${current.message}; falling back to original snapshot`)
    }
    const rollbackApps = { ...loaded.apps }
    delete rollbackApps[ctx.params.appName]
    return await configWrite(ctx.params.configFile, {
      ...loaded,
      apps: rollbackApps,
    })
  },
}

/** Writes add-flow secrets and removes newly written keys when the flow rolls back. */
const writeSecretsStep: Step<AddRunContext, string[], JibError> = {
  name: 'secrets',
  async up(ctx) {
    const keys: string[] = []
    for (const { key, value } of ctx.guided.configEntries) {
      try {
        const error = await secretsUpsert(
          ctx.params.paths.secretsDir,
          ctx.params.appName,
          key,
          value,
        )
        if (!(error instanceof Error)) {
          keys.push(key)
          continue
        }
        await cleanupWrittenSecrets(ctx, keys)
        return error
      } catch (error) {
        await cleanupWrittenSecrets(ctx, keys)
        const message = error instanceof Error ? error.message : String(error)
        return new InternalError(message, { cause: error })
      }
    }
    ctx.secretsWritten = ctx.guided.configEntries.length
    ctx.observer.onStateChange?.('secrets_written')
    return keys
  },
  async down(ctx, keys) {
    await cleanupWrittenSecrets(ctx, keys)
    return undefined
  },
}

/** Claims ingress after config and secret writes have completed. */
const claimIngressStep: Step<AddRunContext, undefined, JibError> = {
  name: 'ingress',
  async up(ctx) {
    try {
      const progress = tuiSpinner()
      progress.start(`claiming ingress for ${ctx.params.appName}`)
      const error = await ingressClaim(
        ingressCreateOperator(ctx.params.paths),
        ctx.params.appName,
        ctx.finalApp,
        (update) => progress.message(update.message),
      )
      if (error instanceof Error) {
        progress.stop('ingress failed')
        return errorsToJibError(error)
      }
      progress.stop('ingress ready')
    } catch (error) {
      return errorsToJibError(error)
    }
    ctx.observer.onStateChange?.('routes_claimed')
    return undefined
  },
}

/** Removes keys written by this add attempt and logs best-effort cleanup failures. */
async function cleanupWrittenSecrets(ctx: AddRunContext, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      const error = await secretsRemove(ctx.params.paths.secretsDir, ctx.params.appName, key)
      if (error instanceof Error) {
        ctx.log.warn(`secret cleanup (${key}): ${error.message}`)
      }
    } catch (error) {
      ctx.log.warn(
        `secret cleanup (${key}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
