import { JibError } from '@jib/errors'

export class DeployPrepareError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('deploy_prepare_failed', message, options)
  }
}

export class DeployExecuteError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('deploy_execute_failed', message, options)
  }
}

export class DeployTimeoutError extends JibError {
  constructor(timeoutMs: number, options?: ErrorOptions) {
    super('deploy_timeout', `deploy timed out after ${timeoutMs}ms`, options)
  }
}

export type DeployRunError = DeployPrepareError | DeployExecuteError | DeployTimeoutError
