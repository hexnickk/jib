export class CancelledAddError extends Error {
  constructor() {
    super('add cancelled')
    this.name = 'CancelledAddError'
  }
}

export class PrepareRepoError extends Error {
  constructor(override readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'PrepareRepoError'
  }
}

export class InspectComposeError extends Error {
  constructor(override readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'InspectComposeError'
  }
}

export class CollectGuidedInputsError extends Error {
  constructor(override readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'CollectGuidedInputsError'
  }
}

export class ResolveAppError extends Error {
  constructor(override readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'ResolveAppError'
  }
}

export class ConfirmPlanError extends Error {
  constructor(override readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'ConfirmPlanError'
  }
}

export class ConfigWriteError extends Error {
  constructor(override readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'ConfigWriteError'
  }
}

export class SecretWriteError extends Error {
  constructor(
    readonly key: string,
    override readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'SecretWriteError'
  }
}

export class ClaimIngressError extends Error {
  constructor(override readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'ClaimIngressError'
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
