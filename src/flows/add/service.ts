import { txRunSteps } from '@jib/tx'
import { CancelledAddError } from './flow-errors.ts'
import { type AddRunContext, addBuildSteps } from './steps.ts'
import type {
  AddFlowObserver,
  AddFlowOutcome,
  AddFlowParams,
  AddPlanner,
  AddSupport,
} from './types.ts'

export interface RunAddDeps {
  support: AddSupport
  planner: AddPlanner
  observer?: AddFlowObserver
}

export async function addRun(
  { support, planner, observer = {} }: RunAddDeps,
  params: AddFlowParams,
): Promise<AddFlowOutcome> {
  const ctx: AddRunContext = {
    params,
    support,
    planner,
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
    addBuildSteps(),
    params.signal ?? { cancelled: false },
    () => new CancelledAddError(),
    observer.warn,
  )
  if (error) return error
  return { finalApp: ctx.finalApp, secretsWritten: ctx.secretsWritten }
}
