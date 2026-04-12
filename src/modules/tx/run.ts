export interface CancelSignal {
  readonly cancelled: boolean
}

type NonErrorState<T> = T extends Error ? never : T

export interface Step<Ctx, State, Err extends Error> {
  readonly name: string
  up(ctx: Ctx, signal: CancelSignal): Promise<NonErrorState<State> | Err>
  down?(ctx: Ctx, state: NonErrorState<State>): Promise<undefined | Error>
}

export async function runSteps<Ctx, Err extends Error>(
  ctx: Ctx,
  steps: readonly Step<Ctx, unknown, Err>[],
  signal: CancelSignal,
  cancelled: () => Err,
  warn?: (message: string) => void,
): Promise<undefined | Err> {
  const done: Array<{ step: Step<Ctx, unknown, Err>; state: unknown }> = []

  for (const step of steps) {
    if (signal.cancelled) return rollback(ctx, done, cancelled(), warn)

    const state = await step.up(ctx, signal)
    if (state instanceof Error) return rollback(ctx, done, state as Err, warn)

    done.push({ step, state })
  }

  return signal.cancelled ? rollback(ctx, done, cancelled(), warn) : undefined
}

async function rollback<Ctx, Err extends Error>(
  ctx: Ctx,
  done: ReadonlyArray<{ step: Step<Ctx, unknown, Err>; state: unknown }>,
  error: Err,
  warn?: (message: string) => void,
): Promise<Err> {
  for (const { step, state } of [...done].reverse()) {
    if (!step.down) continue
    try {
      const result = await step.down(ctx, state)
      if (result instanceof Error) warn?.(`${step.name} rollback: ${result.message}`)
    } catch (cause) {
      warn?.(`${step.name} rollback: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  return error
}
