import { JibError } from '@jib/errors'

function cloudflaredErrorOptions(error: unknown): ErrorOptions | undefined {
  return error === undefined ? undefined : { cause: error }
}

function cloudflaredErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class CloudflaredInstallError extends JibError {
  constructor(message: string, options?: ErrorOptions)
  constructor(code: string, message: string, options?: ErrorOptions)
  constructor(
    codeOrMessage: string,
    messageOrOptions?: string | ErrorOptions,
    options?: ErrorOptions,
  ) {
    if (typeof messageOrOptions === 'string') {
      super(codeOrMessage, messageOrOptions, options)
      return
    }
    super('cloudflared.install', codeOrMessage, messageOrOptions)
  }
}

export class CloudflaredInstallCreateDirError extends CloudflaredInstallError {
  constructor(path: string, error: unknown) {
    super(
      'cloudflared.install_create_dir',
      `create ${path}: ${cloudflaredErrorMessage(error)}`,
      cloudflaredErrorOptions(error),
    )
  }
}

export class CloudflaredInstallWriteComposeError extends CloudflaredInstallError {
  constructor(path: string, error: unknown) {
    super(
      'cloudflared.install_write_compose',
      `write ${path}: ${cloudflaredErrorMessage(error)}`,
      cloudflaredErrorOptions(error),
    )
  }
}

export class CloudflaredInstallWriteUnitError extends CloudflaredInstallError {
  constructor(path: string, error: unknown) {
    super(
      'cloudflared.install_write_unit',
      `write ${path}: ${cloudflaredErrorMessage(error)}`,
      cloudflaredErrorOptions(error),
    )
  }
}

export class CloudflaredInstallReloadError extends CloudflaredInstallError {
  constructor(error: unknown) {
    super(
      'cloudflared.install_reload',
      `systemctl daemon-reload: ${cloudflaredErrorMessage(error)}`,
      cloudflaredErrorOptions(error),
    )
  }
}

export class CloudflaredUninstallError extends JibError {
  constructor(message: string, options?: ErrorOptions)
  constructor(code: string, message: string, options?: ErrorOptions)
  constructor(
    codeOrMessage: string,
    messageOrOptions?: string | ErrorOptions,
    options?: ErrorOptions,
  ) {
    if (typeof messageOrOptions === 'string') {
      super(codeOrMessage, messageOrOptions, options)
      return
    }
    super('cloudflared.uninstall', codeOrMessage, messageOrOptions)
  }
}

export class CloudflaredUninstallDisableError extends CloudflaredUninstallError {
  constructor(service: string, error: unknown) {
    super(
      'cloudflared.uninstall_disable',
      `systemctl disable --now ${service}: ${cloudflaredErrorMessage(error)}`,
      cloudflaredErrorOptions(error),
    )
  }
}

export class CloudflaredUninstallRemoveUnitError extends CloudflaredUninstallError {
  constructor(path: string, error: unknown) {
    super(
      'cloudflared.uninstall_remove_unit',
      `remove ${path}: ${cloudflaredErrorMessage(error)}`,
      cloudflaredErrorOptions(error),
    )
  }
}

export class CloudflaredUninstallRemoveComposeError extends CloudflaredUninstallError {
  constructor(path: string, error: unknown) {
    super(
      'cloudflared.uninstall_remove_compose',
      `remove ${path}: ${cloudflaredErrorMessage(error)}`,
      cloudflaredErrorOptions(error),
    )
  }
}

export class CloudflaredUninstallReloadError extends CloudflaredUninstallError {
  constructor(error: unknown) {
    super(
      'cloudflared.uninstall_reload',
      `systemctl daemon-reload: ${cloudflaredErrorMessage(error)}`,
      cloudflaredErrorOptions(error),
    )
  }
}

export class CloudflaredSaveTunnelTokenError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('cloudflared.save_tunnel_token', message, options)
  }
}
