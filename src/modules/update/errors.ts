import { JibError } from '@jib/errors'

export class UpdateError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('update.failed', message, options)
  }
}
