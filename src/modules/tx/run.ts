import { JibError } from '@jib/errors'

/** Cancellation contract checked before and after each transactional step. */
export interface CancelSignal {
  readonly cancelled: boolean
}

type NonErrorState<T> = T extends Error ? never : T

/** Wraps rollback failures so callers can warn without losing the original cause. */
export class TxRollbackError extends JibError {
  readonly stepName: string

  constructor(stepName: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super('tx_rollback', `${stepName} rollback: ${detail}`, { cause })
    this.stepName = stepName
  }
}

export interface Step<Ctx, State, Err extends Error, RollbackErr extends Error = Error> {
  readonly name: string
  up(ctx: Ctx, signal: CancelSignal): Promise<NonErrorState<State> | Err>
  down?(ctx: Ctx, state: NonErrorState<State>): Promise<undefined | RollbackErr>
}

/** Runs transactional steps in order and rolls back completed steps on failure. */
export async function txRunSteps<Ctx, Err extends Error, RollbackErr extends Error = Error>(
  ctx: Ctx,
  steps: readonly Step<Ctx, unknown, Err, RollbackErr>[],
  signal: CancelSignal,
  cancelled: () => Err,
  warn?: (message: string) => void,
): Promise<undefined | Err> {
  const done: Array<{ step: Step<Ctx, unknown, Err, RollbackErr>; state: unknown }> = []

  for (const step of steps) {
    if (signal.cancelled) return rollback(ctx, done, cancelled(), warn)

    const state = await step.up(ctx, signal)
    if (state instanceof Error) return rollback(ctx, done, state as Err, warn)

    done.push({ step, state })
  }

  return signal.cancelled ? rollback(ctx, done, cancelled(), warn) : undefined
}

async function rollback<Ctx, Err extends Error, RollbackErr extends Error = Error>(
  ctx: Ctx,
  done: ReadonlyArray<{ step: Step<Ctx, unknown, Err, RollbackErr>; state: unknown }>,
  error: Err,
  warn?: (message: string) => void,
): Promise<Err> {
  for (const { step, state } of [...done].reverse()) {
    const rollbackError = await runRollbackStep(ctx, step, state)
    if (rollbackError) warn?.(rollbackError.message)
  }

  return error
}

async function runRollbackStep<Ctx, Err extends Error, RollbackErr extends Error>(
  ctx: Ctx,
  step: Step<Ctx, unknown, Err, RollbackErr>,
  state: unknown,
): Promise<undefined | TxRollbackError> {
  if (!step.down) return undefined
  try {
    const result = await step.down(ctx, state)
    return result instanceof Error ? toTxRollbackError(step.name, result) : undefined
  } catch (cause) {
    return toTxRollbackError(step.name, cause)
  }
}

function toTxRollbackError(stepName: string, cause: unknown): TxRollbackError {
  if (cause instanceof TxRollbackError) return cause
  return new TxRollbackError(stepName, cause)
}
