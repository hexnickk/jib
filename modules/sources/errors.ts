import { JibError } from '@jib/errors'

export class SourceMissingAppError extends JibError {
  constructor(app: string) {
    super('source_missing_app', `app "${app}" not found in config`)
  }
}

export class SourceLocalRepoError extends JibError {
  constructor(app: string) {
    super('source_local_repo', `app "${app}" uses a local repo and has no remote source`)
  }
}

export class SourceMissingConfigError extends JibError {
  constructor(sourceName: string) {
    super('source_missing_config', `source "${sourceName}" not found in config`)
  }
}

export class SourceDriverNotRegisteredError extends JibError {
  constructor(driver: string) {
    super('source_driver_not_registered', `source driver "${driver}" is not registered`)
  }
}

export class SourceWorkdirPrepareError extends JibError {
  constructor(app: string, workdir: string, options?: ErrorOptions) {
    super(
      'source_workdir_prepare',
      `failed to prepare checkout for app "${app}" at ${workdir}`,
      options,
    )
  }
}

export class SourceLocalCheckoutError extends JibError {
  constructor(app: string, workdir: string, options?: ErrorOptions) {
    super(
      'source_local_checkout',
      `failed to sync local repo for app "${app}" at ${workdir}`,
      options,
    )
  }
}

export class SourceRemoteResolveError extends JibError {
  constructor(app: string, options?: ErrorOptions) {
    super('source_remote_resolve', `failed to resolve remote source for app "${app}"`, options)
  }
}

export class SourceRemoteSyncError extends JibError {
  constructor(app: string, ref: string, options?: ErrorOptions) {
    super(
      'source_remote_sync',
      `failed to sync remote source for app "${app}" at ref "${ref}"`,
      options,
    )
  }
}

export class SourceProbeError extends JibError {
  constructor(app: string, ref: string, options?: ErrorOptions) {
    super('source_probe', `failed to probe source for app "${app}" at ref "${ref}"`, options)
  }
}
