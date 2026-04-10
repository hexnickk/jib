import { CliError, JibError, ValidationError } from '@jib/core'
import { ComposeInspectionError } from '@jib/docker'

export function normalizeAddError(error: unknown, appName: string, configFile: string): Error {
  if (error instanceof CliError || error instanceof ValidationError) {
    return error
  }
  if (error instanceof ComposeInspectionError) {
    return new CliError('compose_inspection_failed', error.message)
  }
  if (
    error instanceof JibError &&
    error.code === 'rpc.failure' &&
    error.message === `app "${appName}" not found in config`
  ) {
    return new CliError('add_failed', error.message, {
      hint: 'running jib-gitsitter is older than this CLI; rebuild/install the current jib binary and restart jib-gitsitter, then retry `jib add ...`',
    })
  }
  return new CliError('add_failed', error instanceof Error ? error.message : String(error), {
    hint: `rolled back ${appName} from ${configFile}; safe to retry: jib add ...`,
  })
}
