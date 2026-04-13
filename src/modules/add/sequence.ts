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
  add: () => Promise<AddFlowResult>,
  deploy: (result: AddFlowResult) => Promise<DeploySequenceResult>,
  rollback: (result: AddFlowResult) => Promise<void>,
  interrupt: InterruptState,
): Promise<{ addResult: AddFlowResult; deployResult: DeploySequenceResult }> {
  let addResult: AddFlowResult | null = null
  try {
    addResult = await add()
    throwIfInterrupted(interrupt)
    const deployResult = await deploy(addResult)
    return { addResult, deployResult }
  } catch (error) {
    if (!addResult) throw error
    await rollback(addResult)
    throw new AddRolledBackError(error)
  }
}

function throwIfInterrupted(interrupt: InterruptState): void {
  if (!interrupt.interrupted) return
  throw new CliError('cancelled', 'add cancelled')
}
