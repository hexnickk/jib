import type { AddFlowResult } from '@jib/flows'
import type { InterruptTrap } from './add-runtime.ts'
import { throwIfInterrupted } from './add-runtime.ts'
import type { DeployRunResult } from './deploy-run.ts'

export class RolledBackAddError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original))
    this.name = 'RolledBackAddError'
  }
}

export async function runAddSequence(
  add: () => Promise<AddFlowResult>,
  deploy: (result: AddFlowResult) => Promise<DeployRunResult>,
  rollback: (result: AddFlowResult) => Promise<void>,
  interrupt: InterruptTrap,
): Promise<{ addResult: AddFlowResult; deployResult: DeployRunResult }> {
  let addResult: AddFlowResult | null = null
  try {
    addResult = await add()
    throwIfInterrupted(interrupt)
    const deployResult = await deploy(addResult)
    return { addResult, deployResult }
  } catch (error) {
    if (!addResult) throw error
    await rollback(addResult)
    throw new RolledBackAddError(error)
  }
}
