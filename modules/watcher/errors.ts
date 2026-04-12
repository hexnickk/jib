import { JibError } from '@jib/errors'

function watcherErrorOptions(error: unknown): ErrorOptions | undefined {
  return error instanceof Error ? { cause: error } : undefined
}

function watcherErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class WatcherProbeAppError extends JibError {
  constructor(app: string, error: unknown) {
    super(
      'watcher.probe_app',
      `probe ${app}: ${watcherErrorMessage(error)}`,
      watcherErrorOptions(error),
    )
  }
}

export class WatcherSyncAppError extends JibError {
  constructor(app: string, error: unknown) {
    super(
      'watcher.sync_app',
      `sync ${app}: ${watcherErrorMessage(error)}`,
      watcherErrorOptions(error),
    )
  }
}

export class WatcherDeployAppError extends JibError {
  constructor(app: string, error: unknown) {
    super(
      'watcher.deploy_app',
      `deploy ${app}: ${watcherErrorMessage(error)}`,
      watcherErrorOptions(error),
    )
  }
}

export class WatcherInstallWriteUnitError extends JibError {
  constructor(path: string, error: unknown) {
    super(
      'watcher.install_write_unit',
      `write ${path}: ${watcherErrorMessage(error)}`,
      watcherErrorOptions(error),
    )
  }
}

export class WatcherInstallReloadError extends JibError {
  constructor(error: unknown) {
    super(
      'watcher.install_reload',
      `systemctl daemon-reload: ${watcherErrorMessage(error)}`,
      watcherErrorOptions(error),
    )
  }
}

export class WatcherInstallEnableError extends JibError {
  constructor(service: string, error: unknown) {
    super(
      'watcher.install_enable',
      `systemctl enable --now ${service}: ${watcherErrorMessage(error)}`,
      watcherErrorOptions(error),
    )
  }
}

export class WatcherUninstallRemoveUnitError extends JibError {
  constructor(path: string, error: unknown) {
    super(
      'watcher.uninstall_remove_unit',
      `remove ${path}: ${watcherErrorMessage(error)}`,
      watcherErrorOptions(error),
    )
  }
}
