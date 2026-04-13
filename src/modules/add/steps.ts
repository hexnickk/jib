import type { ComposeInspection } from '@jib/docker'
import { pathsManagedComposePath } from '@jib/paths'
import type { Step } from '../tx/run.ts'
import { addPrepareDockerHubWorkdir } from './dockerhub.ts'
import {
  type AddFlowError,
  CollectGuidedInputsError,
  ConfirmPlanError,
  InspectComposeError,
  PrepareRepoError,
  PrepareRepoRollbackError,
  RemoveManagedComposeError,
  ResolveAppError,
} from './flow-errors.ts'
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

export function addBuildSteps(): readonly Step<AddRunContext, unknown, AddFlowError>[] {
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

const prepareRepoStep: Step<AddRunContext, { repo: string }, AddFlowError> = {
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
    if (inspectionCheckout instanceof Error) return new PrepareRepoError(inspectionCheckout)
    try {
      await addPrepareDockerHubWorkdir(
        ctx.params.paths,
        ctx.params.appName,
        ctx.params.inputs.repo,
        ctx.params.inputs.persistPaths,
      )
    } catch (cause) {
      return new PrepareRepoError(cause)
    }
    ctx.workdir = inspectionCheckout.workdir
    ctx.observer.onStateChange?.('repo_prepared')
    return { repo: ctx.params.draftApp.image ? 'local' : ctx.params.inputs.repo }
  },
  async down(ctx, state) {
    const error = await ctx.support.removeCheckout(ctx.params.appName, state.repo)
    if (error instanceof Error) return new PrepareRepoRollbackError(error)
  },
}

const inspectComposeStep: Step<AddRunContext, undefined, AddFlowError> = {
  name: 'compose inspection',
  async up(ctx) {
    const inspection = await ctx.planner.inspectCompose(ctx.params.draftApp, ctx.workdir)
    if (inspection instanceof Error) return new InspectComposeError(inspection)
    ctx.inspection = inspection
    ctx.observer.onStateChange?.('compose_inspected')
    return undefined
  },
}

const collectGuidedInputsStep: Step<AddRunContext, undefined, AddFlowError> = {
  name: 'guided inputs',
  async up(ctx) {
    const guided = await ctx.planner.collectGuidedInputs(ctx.params.inputs, ctx.inspection.services)
    if (guided instanceof Error) return new CollectGuidedInputsError(guided)
    ctx.guided = guided
    ctx.observer.onStateChange?.('guided_inputs_collected')
    return undefined
  },
}

const resolveAppStep: Step<AddRunContext, { managedComposeWritten: boolean }, AddFlowError> = {
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
    if (finalApp instanceof Error) return new ResolveAppError(finalApp)
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
    if (!state.managedComposeWritten) return
    const error = await ctx.support.removeManagedCompose(ctx.params.appName)
    if (error instanceof Error) return new RemoveManagedComposeError(error)
  },
}

const confirmPlanStep: Step<AddRunContext, undefined, AddFlowError> = {
  name: 'plan confirmation',
  async up(ctx) {
    const result = await ctx.planner.confirmPlan(
      ctx.params.appName,
      ctx.inspection,
      ctx.finalApp,
      ctx.guided.configEntries,
    )
    if (result instanceof Error) return new ConfirmPlanError(result)
    ctx.observer.onStateChange?.('confirmed')
    return undefined
  },
}
