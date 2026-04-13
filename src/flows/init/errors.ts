import { JibError } from '@jib/errors'

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.length > 0) return error
  return fallback
}

function errorOptions(error: unknown): ErrorOptions | undefined {
  if (error instanceof Error) return { cause: error }
  return undefined
}

export class InitModuleInstallError extends JibError {
  readonly moduleName: string

  constructor(moduleName: string, message: string, options?: ErrorOptions) {
    super('init_module_install_failed', message, options)
    this.moduleName = moduleName
  }
}

export class OptionalModuleSetupError extends JibError {
  readonly moduleName: string

  constructor(moduleName: string, message: string, options?: ErrorOptions) {
    super('optional_module_setup_failed', message, options)
    this.moduleName = moduleName
  }
}

export class OptionalModuleChoicePersistError extends JibError {
  readonly moduleName: string

  constructor(moduleName: string, message: string, options?: ErrorOptions) {
    super('optional_module_choice_persist_failed', message, options)
    this.moduleName = moduleName
  }
}

export type InitOptionalModuleError =
  | InitModuleInstallError
  | OptionalModuleSetupError
  | OptionalModuleChoicePersistError

export function toInitModuleInstallError(
  moduleName: string,
  error: unknown,
): InitModuleInstallError {
  if (error instanceof InitModuleInstallError) return error
  return new InitModuleInstallError(
    moduleName,
    errorMessage(error, `failed to install ${moduleName}`),
    errorOptions(error),
  )
}

export function toOptionalModuleSetupError(
  moduleName: string,
  error: unknown,
): OptionalModuleSetupError {
  if (error instanceof OptionalModuleSetupError) return error
  return new OptionalModuleSetupError(
    moduleName,
    errorMessage(error, `${moduleName} setup did not complete`),
    errorOptions(error),
  )
}

export function toOptionalModuleChoicePersistError(
  moduleName: string,
  error: unknown,
): OptionalModuleChoicePersistError {
  if (error instanceof OptionalModuleChoicePersistError) return error
  return new OptionalModuleChoicePersistError(
    moduleName,
    errorMessage(error, `failed to persist ${moduleName} module choice`),
    errorOptions(error),
  )
}
