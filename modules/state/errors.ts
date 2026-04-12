import { JibError } from '@jib/errors'

export class StateError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('state', message, options)
  }
}

export class LockError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('lock', message, options)
  }
}
