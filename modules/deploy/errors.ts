import { JibError } from '@jib/errors'

export class DeployMissingAppError extends JibError {
  constructor(app: string) {
    super('deploy.missing_app', `app "${app}" not found in config`)
    this.name = 'DeployMissingAppError'
  }
}

export class DeployDiskCheckError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('deploy.disk_check', message, options)
    this.name = 'DeployDiskCheckError'
  }
}

export class DeployDiskSpaceError extends JibError {
  constructor(freeBytes: number) {
    super('deploy.disk_space', `insufficient disk space: ${freeBytes} bytes free`)
    this.name = 'DeployDiskSpaceError'
  }
}

export class DeployOverrideSyncError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('deploy.override_sync', message, options)
    this.name = 'DeployOverrideSyncError'
  }
}

export class DeploySecretsLinkError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('deploy.secrets_link', message, options)
    this.name = 'DeploySecretsLinkError'
  }
}

export class DeployHealthCheckError extends JibError {
  constructor(message: string) {
    super('deploy.health_check', message)
    this.name = 'DeployHealthCheckError'
  }
}

export class DeployLockAcquireError extends JibError {
  constructor(app: string, message: string, options?: ErrorOptions) {
    super('deploy.lock_acquire', `acquire lock for ${app}: ${message}`, options)
    this.name = 'DeployLockAcquireError'
  }
}

export class DeployLockReleaseError extends JibError {
  constructor(app: string, message: string, options?: ErrorOptions) {
    super('deploy.lock_release', `release lock for ${app}: ${message}`, options)
    this.name = 'DeployLockReleaseError'
  }
}

export class DeployUnexpectedError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('deploy.unexpected', message, options)
    this.name = 'DeployUnexpectedError'
  }
}
