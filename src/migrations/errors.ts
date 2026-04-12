import { JibError } from '@jib/errors'

export class MigrationError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('migration', message, options)
  }
}

export class RunMigrationError extends MigrationError {}

export class RunPendingMigrationsError extends MigrationError {}

export class WriteSudoersError extends MigrationError {}

export class ValidateSudoersError extends MigrationError {}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
