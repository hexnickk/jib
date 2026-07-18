import { CliError } from '@jib/cli'
import { type JibError, ValidationError } from '@jib/errors'

/** Converts an add-flow shared error into the CLI response shape at the command boundary. */
export function addNormalizeError(error: JibError, appName: string, configFile: string): JibError {
  if (error instanceof CliError || error instanceof ValidationError) {
    return error
  }
  return new CliError('add_failed', error.message, {
    cause: error,
    hint: `rolled back ${appName} from ${configFile}; safe to retry: jib add ...`,
  })
}
