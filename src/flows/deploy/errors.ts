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

export type DeployRunError = DeployPrepareError | DeployExecuteError
