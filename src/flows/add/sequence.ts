import { CliError } from '@jib/cli'
import { JibError } from '@jib/errors'
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

export class AddRolledBackError extends JibError {
  constructor(readonly original: unknown) {
    super('add_rolled_back', original instanceof Error ? original.message : String(original), {
      cause: original,
    })
  }
}

export async function addRunSequence(
  add: () => Promise<AddFlowResult | Error>,
  deploy: (result: AddFlowResult) => Promise<DeploySequenceResult | Error>,
  rollback: (result: AddFlowResult) => Promise<undefined | Error>,
  interrupt: InterruptState,
): Promise<{ addResult: AddFlowResult; deployResult: DeploySequenceResult } | Error> {
  let addResult: AddFlowResult | undefined

  try {
    const added = await add()
    if (added instanceof Error) return added
    addResult = added

    const interrupted = addInterruptError(interrupt)
    if (interrupted) return await addRollbackAfterFailure(addResult, interrupted, rollback)

    const deployResult = await deploy(addResult)
    if (deployResult instanceof Error) {
      return await addRollbackAfterFailure(addResult, deployResult, rollback)
    }

    return { addResult, deployResult }
  } catch (error) {
    if (!addResult) return error instanceof Error ? error : new Error(String(error))
    return await addRollbackAfterFailure(addResult, error, rollback)
  }
}

function addInterruptError(interrupt: InterruptState): CliError | undefined {
  if (!interrupt.interrupted) return undefined
  return new CliError('cancelled', 'add cancelled')
}

async function addRollbackAfterFailure(
  addResult: AddFlowResult,
  failure: unknown,
  rollback: (result: AddFlowResult) => Promise<undefined | Error>,
): Promise<Error> {
  try {
    const rollbackError = await rollback(addResult)
    if (rollbackError instanceof Error) return rollbackError
  } catch (rollbackError) {
    return rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError))
  }
  return new AddRolledBackError(failure)
}
