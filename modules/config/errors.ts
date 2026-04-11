import { JibError } from '@jib/errors'

export class ConfigError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('config', message, options)
    this.name = 'ConfigError'
  }
}
