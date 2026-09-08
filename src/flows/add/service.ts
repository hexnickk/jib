import { CancelledError } from '@jib/errors'
import { txRunSteps } from '@jib/tx'
import { type AddRunContext, addSteps } from './steps.ts'
import type { AddFlowObserver, AddFlowOutcome, AddFlowParams, AddSupport } from './types.ts'

export interface RunAddDeps {
  support: AddSupport
  observer?: AddFlowObserver
}

export async function addRun(
  { support, observer = {} }: RunAddDeps,
  params: AddFlowParams,
): Promise<AddFlowOutcome> {
  const ctx: AddRunContext = {
    params,
    support,
    observer,
    inspection: { composeFiles: [], services: [] },
    workdir: '',
    guided: { domains: [], configEntries: [] },
    finalApp: params.draftApp,
    secretsWritten: 0,
  }

  observer.onStateChange?.('inputs_ready')

  const error = await txRunSteps(ctx, addSteps, {
    signal: params.signal ?? { cancelled: false },
    cancelled: () => new CancelledError('add cancelled'),
    warn: (message) => observer.warn?.(message),
  })
  if (error) {
    return error
  }
  return { finalApp: ctx.finalApp, secretsWritten: ctx.secretsWritten }
}
