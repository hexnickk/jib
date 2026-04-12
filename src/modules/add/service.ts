import { runSteps } from '../tx/run.ts'
import { CancelledAddError } from './flow-errors.ts'
import { type AddRunContext, buildAddSteps } from './steps.ts'
import type {
  AddFlowObserver,
  AddFlowOutcome,
  AddFlowParams,
  AddPlanner,
  AddSupport,
} from './types.ts'

export class AddService {
  constructor(
    private readonly support: AddSupport,
    private readonly planner: AddPlanner,
    private readonly observer: AddFlowObserver = {},
  ) {}

  async run(params: AddFlowParams): Promise<AddFlowOutcome> {
    const ctx: AddRunContext = {
      params,
      support: this.support,
      planner: this.planner,
      observer: this.observer,
      inspection: { composeFiles: [], services: [] },
      workdir: '',
      guided: { domains: [], configEntries: [] },
      finalApp: params.draftApp,
      secretsWritten: 0,
    }

    this.observer.onStateChange?.('inputs_ready')

    const error = await runSteps(
      ctx,
      buildAddSteps(),
      params.signal ?? { cancelled: false },
      () => new CancelledAddError(),
      this.observer.warn,
    )
    if (error) return error
    return { finalApp: ctx.finalApp, secretsWritten: ctx.secretsWritten }
  }
}
