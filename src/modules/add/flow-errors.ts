import { JibError } from '@jib/errors'

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

abstract class AddStepError extends JibError {
  constructor(code: string, cause: unknown) {
    const error = asError(cause)
    super(code, error.message, { cause: error })
  }
}

export class CancelledAddError extends JibError {
  constructor() {
    super('add_cancelled', 'add cancelled')
  }
}

export class PrepareRepoError extends AddStepError {
  constructor(cause: unknown) {
    super('add_prepare_repo', cause)
  }
}

export class PrepareRepoRollbackError extends AddStepError {
  constructor(cause: unknown) {
    super('add_prepare_repo_rollback', cause)
  }
}

export class InspectComposeError extends AddStepError {
  constructor(cause: unknown) {
    super('add_inspect_compose', cause)
  }
}

export class CollectGuidedInputsError extends AddStepError {
  constructor(cause: unknown) {
    super('add_collect_guided_inputs', cause)
  }
}

export class ResolveAppError extends AddStepError {
  constructor(cause: unknown) {
    super('add_resolve_app', cause)
  }
}

export class RemoveManagedComposeError extends AddStepError {
  constructor(cause: unknown) {
    super('add_remove_managed_compose', cause)
  }
}

export class ConfirmPlanError extends AddStepError {
  constructor(cause: unknown) {
    super('add_confirm_plan', cause)
  }
}

export class ConfigWriteError extends AddStepError {
  constructor(cause: unknown) {
    super('add_write_config', cause)
  }
}

export class ConfigRollbackError extends AddStepError {
  constructor(cause: unknown) {
    super('add_rollback_config', cause)
  }
}

export class SecretWriteError extends AddStepError {
  readonly key: string

  constructor(key: string, cause: unknown) {
    super('add_write_secret', cause)
    this.key = key
  }
}

export class ClaimIngressError extends AddStepError {
  constructor(cause: unknown) {
    super('add_claim_ingress', cause)
  }
}

export type AddFlowError =
  | CancelledAddError
  | PrepareRepoError
  | InspectComposeError
  | CollectGuidedInputsError
  | ResolveAppError
  | ConfirmPlanError
  | ConfigWriteError
  | SecretWriteError
  | ClaimIngressError
