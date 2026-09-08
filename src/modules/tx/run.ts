import { InternalError, type JibError } from '@jib/errors'

/** Cancellation contract checked before and after each transactional step. */
export interface CancelSignal {
  readonly cancelled: boolean
}

type NonErrorState<Value> = Value extends Error ? never : Value

export interface Step<Ctx, State, Err extends JibError, RollbackErr extends JibError = JibError> {
  readonly name: string
  up(ctx: Ctx, signal: CancelSignal): Promise<NonErrorState<State> | Err>
  down?(ctx: Ctx, state: NonErrorState<State>): Promise<undefined | RollbackErr>
}

/** Runs transactional steps in order and rolls back completed steps on failure. */
export async function txRunSteps<
  Ctx,
  Err extends JibError,
  RollbackErr extends JibError = JibError,
>(
  ctx: Ctx,
  steps: readonly Step<Ctx, unknown, Err, RollbackErr>[],
  options: {
    signal: CancelSignal
    cancelled: () => Err
    warn?: (message: string) => void
  },
): Promise<undefined | Err> {
  const { signal, cancelled, warn } = options
  const done: Array<{ step: Step<Ctx, unknown, Err, RollbackErr>; state: unknown }> = []

  for (const step of steps) {
    if (signal.cancelled) {
      return rollback(ctx, done, cancelled(), warn)
    }

    const state = await step.up(ctx, signal)
    if (state instanceof Error) {
      return rollback(ctx, done, state as Err, warn)
    }

    done.push({ step, state })
  }

  return signal.cancelled ? rollback(ctx, done, cancelled(), warn) : undefined
}

async function rollback<Ctx, Err extends JibError, RollbackErr extends JibError = JibError>(
  ctx: Ctx,
  done: ReadonlyArray<{ step: Step<Ctx, unknown, Err, RollbackErr>; state: unknown }>,
  error: Err,
  warn?: (message: string) => void,
): Promise<Err> {
  for (const { step, state } of [...done].reverse()) {
    const rollbackError = await runRollbackStep(ctx, step, state)
    if (rollbackError) {
      warn?.(rollbackError.message)
    }
  }

  return error
}

async function runRollbackStep<Ctx, Err extends JibError, RollbackErr extends JibError>(
  ctx: Ctx,
  step: Step<Ctx, unknown, Err, RollbackErr>,
  state: unknown,
): Promise<undefined | InternalError> {
  if (!step.down) {
    return undefined
  }
  try {
    const result = await step.down(ctx, state)
    if (!(result instanceof Error)) {
      return undefined
    }
    return new InternalError(`${step.name} rollback: ${result.message}`, { cause: result })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return new InternalError(`${step.name} rollback: ${message}`, { cause })
  }
}
