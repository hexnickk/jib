import { JibError } from '@jib/errors'

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

export class CloudflaredSetupPromptError extends JibError {
  readonly step: 'replace' | 'token'

  constructor(step: 'replace' | 'token', cause: unknown) {
    const error = asError(cause)
    const action =
      step === 'replace' ? 'confirm tunnel token replacement' : 'read tunnel token input'
    super('cloudflared_setup_prompt', `failed to ${action}: ${error.message}`, { cause: error })
    this.step = step
  }
}

export class CloudflaredSetupSaveTokenError extends JibError {
  constructor(cause: unknown) {
    const error = asError(cause)
    super('cloudflared_setup_save_token', error.message, { cause: error })
  }
}

export class CloudflaredStartError extends JibError {
  readonly detail: string
  readonly keptExisting: boolean

  constructor(detail: string, keptExisting: boolean, options?: ErrorOptions) {
    super(
      'cloudflared_setup_start',
      detail ? `cloudflared failed to start: ${detail}` : 'cloudflared failed to start',
      options,
    )
    this.detail = detail
    this.keptExisting = keptExisting
  }
}
