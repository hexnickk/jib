import { JibError } from '@jib/errors'

export class DockerAppNotFoundError extends JibError {
  constructor(app: string) {
    super('docker_app_not_found', `app "${app}" not found in config`)
    this.name = 'DockerAppNotFoundError'
  }
}

export class ExecArgsMissingAppError extends JibError {
  constructor() {
    super('docker_exec_missing_app', 'missing app name — usage: jib exec <app> [service] -- <cmd>')
    this.name = 'ExecArgsMissingAppError'
  }
}

export class ExecArgsMissingCommandError extends JibError {
  constructor() {
    super(
      'docker_exec_missing_command',
      'command required after app — usage: jib exec <app> [service] -- <cmd>',
    )
    this.name = 'ExecArgsMissingCommandError'
  }
}

export class RunArgsMissingAppError extends JibError {
  constructor() {
    super('docker_run_missing_app', 'missing app name — usage: jib run <app> [service] [-- <cmd>]')
    this.name = 'RunArgsMissingAppError'
  }
}

export class DockerAppHasNoServicesError extends JibError {
  constructor(app: string) {
    super('docker_app_has_no_services', `app "${app}" has no services in its compose file`)
    this.name = 'DockerAppHasNoServicesError'
  }
}

export class DockerServiceSelectionRequiredError extends JibError {
  constructor(app: string, services: string[]) {
    super(
      'docker_service_selection_required',
      `app "${app}" has multiple services (${services.join(', ')}); specify one explicitly`,
    )
    this.name = 'DockerServiceSelectionRequiredError'
  }
}

export class DockerDomainServiceRequiredError extends JibError {
  constructor(host: string, services: string[]) {
    super(
      'docker_domain_service_required',
      `compose has multiple services (${services.join(', ')}); specify =service in --domain for ${host}`,
    )
    this.name = 'DockerDomainServiceRequiredError'
  }
}

export class DockerDomainServiceNotFoundError extends JibError {
  constructor(host: string, service: string) {
    super(
      'docker_domain_service_not_found',
      `--domain ${host}: compose has no service "${service}"`,
    )
    this.name = 'DockerDomainServiceNotFoundError'
  }
}

export class DockerCommandError extends JibError {
  constructor(action: 'exec' | 'run', app: string, message: string, options?: ErrorOptions) {
    super('docker_command_failed', `${action} failed for app "${app}": ${message}`, options)
    this.name = 'DockerCommandError'
  }
}

export class DockerInstallUnsupportedPlatformError extends JibError {
  constructor(detail: string) {
    super('docker_install_unsupported_platform', `automatic Docker install unsupported: ${detail}`)
    this.name = 'DockerInstallUnsupportedPlatformError'
  }
}

export class DockerInstallCommandError extends JibError {
  constructor(
    readonly step: string,
    readonly args: readonly string[],
    detail: string,
    options?: ErrorOptions,
  ) {
    super('docker_install_command_failed', `Docker install ${step}: ${detail}`, options)
    this.name = 'DockerInstallCommandError'
  }
}

export class DockerInstallReadFileError extends JibError {
  constructor(path: string, message: string, options?: ErrorOptions) {
    super('docker_install_read_file', `Docker install read ${path}: ${message}`, options)
    this.name = 'DockerInstallReadFileError'
  }
}

export class DockerInstallWriteFileError extends JibError {
  constructor(path: string, message: string, options?: ErrorOptions) {
    super('docker_install_write_file', `Docker install write ${path}: ${message}`, options)
    this.name = 'DockerInstallWriteFileError'
  }
}
