import type { JibError } from '@jib/errors'
import { loggingCreateLogger } from '@jib/logging'

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
  },
): Promise<undefined | Err> {
  const { signal, cancelled } = options
  const done: Array<{ step: Step<Ctx, unknown, Err, RollbackErr>; state: unknown }> = []

  for (const step of steps) {
    if (signal.cancelled) {
      return rollback(ctx, done, cancelled())
    }

    const state = await step.up(ctx, signal)
    if (state instanceof Error) {
      return rollback(ctx, done, state as Err)
    }

    done.push({ step, state })
  }

  return signal.cancelled ? rollback(ctx, done, cancelled()) : undefined
}

async function rollback<Ctx, Err extends JibError, RollbackErr extends JibError = JibError>(
  ctx: Ctx,
  done: ReadonlyArray<{ step: Step<Ctx, unknown, Err, RollbackErr>; state: unknown }>,
  error: Err,
): Promise<Err> {
  const log = loggingCreateLogger('tx')
  for (const { step, state } of [...done].reverse()) {
    if (!step.down) {
      continue
    }
    let failure: string | undefined
    try {
      const result = await step.down(ctx, state)
      if (result instanceof Error) {
        failure = result.message
      }
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : String(cause)
    }
    if (failure !== undefined) {
      log.warn(`${step.name} rollback: ${failure}`)
    }
  }
  return error
}
