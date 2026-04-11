import { CliError } from '@jib/cli'
import { ComposeInspectionError } from '@jib/docker'
import { ValidationError } from '@jib/errors'

export function normalizeAddError(error: unknown, appName: string, configFile: string): Error {
  if (error instanceof CliError || error instanceof ValidationError) {
    return error
  }
  if (error instanceof ComposeInspectionError) {
    return new CliError('compose_inspection_failed', error.message)
  }
  return new CliError('add_failed', error instanceof Error ? error.message : String(error), {
    hint: `rolled back ${appName} from ${configFile}; safe to retry: jib add ...`,
  })
}
