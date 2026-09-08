import type { ComposeInspection } from '@jib/docker'
import { CancelledError, InternalError, type JibError } from '@jib/errors'
import { pathsManagedComposePath } from '@jib/paths'
import { type Step, txRunSteps } from '@jib/tx'
import { addPrepareDockerHubWorkdir } from './dockerhub.ts'
import { addInspectCompose } from './inspect.ts'
import { addConfirmPlan } from './plan.ts'
import { addBuildResolvedApp, addCollectGuidedInputs } from './resolve.ts'
import type {
  AddFlowObserver,
  AddFlowOutcome,
  AddFlowParams,
  AddFlowResult,
  AddSupport,
  GuidedInputs,
} from './types.ts'

export interface RunAddDeps {
  support: AddSupport
  observer?: AddFlowObserver
}

interface AddRunContext {
  readonly params: AddFlowParams
  readonly support: AddSupport
  readonly observer: AddFlowObserver
  inspection: ComposeInspection
  workdir: string
  guided: GuidedInputs
  finalApp: AddFlowResult['finalApp']
  secretsWritten: number
}

/** Registers an app transactionally, rolling back completed steps on failure or cancellation. */
export async function addRun(
  { support, observer = {} }: RunAddDeps,
  params: AddFlowParams,
): Promise<AddFlowOutcome> {
  const ctx: AddRunContext = {
    params,
    support,
    observer,
    inspection: { composeFiles: [], services: [] },
    workdir: '',
    guided: { domains: [], configEntries: [] },
    finalApp: params.draftApp,
    secretsWritten: 0,
  }

  observer.onStateChange?.('inputs_ready')

  const error = await txRunSteps(
    ctx,
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
      signal: params.signal ?? { cancelled: false },
      cancelled: () => new CancelledError('add cancelled'),
      warn: (message) => observer.warn?.(message),
    },
  )
  if (error) {
    return error
  }
  return { finalApp: ctx.finalApp, secretsWritten: ctx.secretsWritten }
}

const prepareRepoStep: Step<AddRunContext, { repo: string }, JibError> = {
  name: 'repo',
  async up(ctx) {
    const inspectionCheckout = await ctx.support.cloneForInspection(
      ctx.params.cfg,
      ctx.params.appName,
      {
        repo: ctx.params.inputs.repo,
        branch: ctx.params.draftApp.branch,
        ...(ctx.params.args.source ? { source: ctx.params.args.source } : {}),
      },
    )
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
    return { repo: ctx.params.draftApp.image ? 'local' : ctx.params.inputs.repo }
  },
  async down(ctx, state) {
    return await ctx.support.removeCheckout(ctx.params.appName, state.repo)
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

const resolveAppStep: Step<AddRunContext, { managedComposeWritten: boolean }, JibError> = {
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
    return {
      managedComposeWritten:
        ctx.finalApp.compose?.includes(
          pathsManagedComposePath(ctx.params.paths, ctx.params.appName),
        ) ?? false,
    }
  },
  async down(ctx, state) {
    if (!state.managedComposeWritten) {
      return undefined
    }
    return await ctx.support.removeManagedCompose(ctx.params.appName)
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
    const error = await ctx.support.writeConfig(ctx.params.configFile, finalCfg)
    if (error instanceof Error) {
      return error
    }
    ctx.observer.onStateChange?.('config_written')
    return undefined
  },
  async down(ctx) {
    const current = await ctx.support.loadConfig(ctx.params.configFile)
    const loaded = current instanceof Error ? ctx.params.cfg : current
    if (current instanceof Error) {
      ctx.observer.warn?.(
        `config cleanup load: ${current.message}; falling back to original snapshot`,
      )
    }
    const rollbackApps = { ...loaded.apps }
    delete rollbackApps[ctx.params.appName]
    return await ctx.support.writeConfig(ctx.params.configFile, {
      ...loaded,
      apps: rollbackApps,
    })
  },
}

/** Writes add-flow secrets and removes newly written keys when the flow rolls back. */
const writeSecretsStep: Step<AddRunContext, { keys: string[] }, JibError> = {
  name: 'secrets',
  async up(ctx) {
    const keys: string[] = []
    for (const { key, value } of ctx.guided.configEntries) {
      const entry = { key, value }
      try {
        const error = await ctx.support.upsertSecret(ctx.params.appName, entry)
        if (!(error instanceof Error)) {
          keys.push(entry.key)
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
    return { keys }
  },
  async down(ctx, state) {
    await cleanupWrittenSecrets(ctx, state.keys)
    return undefined
  },
}

/** Claims ingress after config and secret writes have completed. */
const claimIngressStep: Step<AddRunContext, undefined, JibError> = {
  name: 'ingress',
  async up(ctx) {
    const error = await ctx.support.claimIngress(ctx.params.appName, ctx.finalApp)
    if (error instanceof Error) {
      return error
    }
    ctx.observer.onStateChange?.('routes_claimed')
    return undefined
  },
}

/** Removes keys written by this add attempt and logs best-effort cleanup failures. */
async function cleanupWrittenSecrets(ctx: AddRunContext, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      const error = await ctx.support.removeSecret(ctx.params.appName, key)
      if (error instanceof Error) {
        ctx.observer.warn?.(`secret cleanup (${key}): ${error.message}`)
      }
    } catch (error) {
      ctx.observer.warn?.(
        `secret cleanup (${key}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
