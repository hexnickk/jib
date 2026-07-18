import type { ComposeInspection } from '@jib/docker'
import type { JibError } from '@jib/errors'
import { pathsManagedComposePath } from '@jib/paths'
import type { Step } from '@jib/tx'
import { addPrepareDockerHubWorkdir } from './dockerhub.ts'
import { addClaimIngressStep, addWriteConfigStep, addWriteSecretsStep } from './mutation-steps.ts'
import type {
  AddFlowObserver,
  AddFlowParams,
  AddFlowResult,
  AddPlanner,
  AddSupport,
  GuidedInputs,
} from './types.ts'

export interface AddRunContext {
  readonly params: AddFlowParams
  readonly support: AddSupport
  readonly planner: AddPlanner
  readonly observer: AddFlowObserver
  inspection: ComposeInspection
  workdir: string
  guided: GuidedInputs
  finalApp: AddFlowResult['finalApp']
  secretsWritten: number
}

/** Builds the ordered transactional steps for the add flow. */
export function addBuildSteps(): readonly Step<AddRunContext, unknown, JibError>[] {
  return [
    prepareRepoStep,
    inspectComposeStep,
    collectGuidedInputsStep,
    resolveAppStep,
    confirmPlanStep,
    addWriteConfigStep,
    addWriteSecretsStep,
    addClaimIngressStep,
  ]
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
    const inspection = await ctx.planner.inspectCompose(ctx.params.draftApp, ctx.workdir)
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
    const guided = await ctx.planner.collectGuidedInputs(ctx.params.inputs, ctx.inspection.services)
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
    const finalApp = await ctx.planner.buildResolvedApp(
      ctx.params.cfg,
      ctx.params.paths,
      ctx.params.appName,
      ctx.workdir,
      ctx.params.args,
      ctx.params.inputs,
      ctx.inspection,
      ctx.guided,
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
    const result = await ctx.planner.confirmPlan(
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
