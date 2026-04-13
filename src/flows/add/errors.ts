import { CliError } from '@jib/cli'
import { ComposeInspectionError } from '@jib/docker'
import { ValidationError } from '@jib/errors'
import {
  type AddFlowError,
  ClaimIngressError,
  CollectGuidedInputsError,
  ConfigWriteError,
  ConfirmPlanError,
  InspectComposeError,
  PrepareRepoError,
  ResolveAppError,
  SecretWriteError,
} from './flow-errors.ts'

export function addNormalizeError(error: AddFlowError, appName: string, configFile: string): Error {
  const original = unwrapAddFlowError(error)
  if (original instanceof CliError || original instanceof ValidationError) {
    return original
  }
  if (original instanceof ComposeInspectionError) {
    return new CliError('compose_inspection_failed', original.message)
  }
  return new CliError('add_failed', error.message, {
    hint: `rolled back ${appName} from ${configFile}; safe to retry: jib add ...`,
  })
}

function unwrapAddFlowError(error: AddFlowError): unknown {
  if (
    error instanceof PrepareRepoError ||
    error instanceof InspectComposeError ||
    error instanceof CollectGuidedInputsError ||
    error instanceof ResolveAppError ||
    error instanceof ConfirmPlanError ||
    error instanceof ConfigWriteError ||
    error instanceof SecretWriteError ||
    error instanceof ClaimIngressError
  ) {
    return error.cause
  }
  if (error instanceof CliError || error instanceof ValidationError) {
    return error
  }
  return error
}
