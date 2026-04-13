import { JibError } from '@jib/errors'

export class RemoveMissingAppError extends JibError {
  constructor(appName: string) {
    super('remove_missing_app', `app "${appName}" not found in config`)
  }
}

export class RemoveWriteConfigError extends JibError {
  constructor(configFile: string, options?: ErrorOptions) {
    super('remove_write_config', `failed to write config "${configFile}" during remove`, options)
  }
}
