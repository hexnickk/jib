import { JibError, ValidationError } from '@jib/errors'

export class ConfigError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('config', message, options)
  }
}

export class ReadConfigError extends ConfigError {}

export class ParseConfigError extends ConfigError {}

export class ValidateConfigError extends ConfigError {}

export class SerializeConfigError extends ConfigError {}

export class WriteConfigError extends ConfigError {}

export class ParseDomainArgError extends ConfigError {}

export class ParseHealthArgError extends ConfigError {}

export class PortExhaustedError extends ConfigError {}

export class MissingConfigAppError extends ValidationError {}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
