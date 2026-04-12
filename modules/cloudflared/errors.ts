interface CloudflaredErrorType<T extends Error> {
  new (message: string, options?: ErrorOptions): T
}

export class CloudflaredInstallError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CloudflaredInstallError'
  }
}

export class CloudflaredUninstallError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CloudflaredUninstallError'
  }
}

export class CloudflaredSaveTunnelTokenError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CloudflaredSaveTunnelTokenError'
  }
}

export function wrapCloudflaredError<T extends Error>(
  error: unknown,
  ErrorType: CloudflaredErrorType<T>,
): T {
  if (error instanceof ErrorType) return error

  const message = error instanceof Error ? error.message : String(error)
  return new ErrorType(message, { cause: error })
}
