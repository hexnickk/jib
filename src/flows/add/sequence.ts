import { CancelledError, InternalError, type JibError, RollbackError } from '@jib/errors'
import type { AddFlowResult } from './types.ts'

export interface InterruptState {
  readonly interrupted: boolean
}

export interface DeploySequenceResult {
  app: string
  durationMs: number
  preparedSha: string
  sha: string
  workdir: string
}

/** Runs add, deploy, and rollback in order while preserving the original failure after rollback. */
export async function addRunSequence(
  add: () => Promise<AddFlowResult | JibError>,
  deploy: (result: AddFlowResult) => Promise<DeploySequenceResult | JibError>,
  rollback: (result: AddFlowResult) => Promise<undefined | JibError>,
  interrupt: InterruptState,
): Promise<{ addResult: AddFlowResult; deployResult: DeploySequenceResult } | JibError> {
  let addResult: AddFlowResult | undefined

  try {
    const added = await add()
    if (added instanceof Error) {
      return added
    }
    addResult = added

    const interrupted = addInterruptError(interrupt)
    if (interrupted) {
      return addRollbackAfterFailure(addResult, interrupted, rollback)
    }

    const deployResult = await deploy(addResult)
    if (deployResult instanceof Error) {
      return addRollbackAfterFailure(addResult, deployResult, rollback)
    }

    return { addResult, deployResult }
  } catch (error) {
    if (!addResult) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(message, { cause: error })
    }
    return addRollbackAfterFailure(addResult, error, rollback)
  }
}

function addInterruptError(interrupt: InterruptState): CancelledError | undefined {
  if (!interrupt.interrupted) {
    return undefined
  }
  return new CancelledError('add cancelled')
}

/** Attempts rollback and returns a shared rollback error that retains the original failure. */
async function addRollbackAfterFailure(
  addResult: AddFlowResult,
  failure: unknown,
  rollback: (result: AddFlowResult) => Promise<undefined | JibError>,
): Promise<JibError> {
  try {
    const rollbackError = await rollback(addResult)
    if (rollbackError instanceof Error) {
      return rollbackError
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`rollback add: ${message}`, { cause: error })
  }
  const message = failure instanceof Error ? failure.message : String(failure)
  return new RollbackError(message, failure)
}
