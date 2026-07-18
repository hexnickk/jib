import {
  cloudflaredEnableService,
  cloudflaredHasTunnelToken,
  cloudflaredSaveTunnelToken,
} from '@jib-module/cloudflared'
import { type CancelledError, InternalError, type ValidationError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { tuiLog, tuiPromptConfirmResult, tuiPromptPasswordResult } from '@jib/tui'

interface CloudflaredSetupLogger {
  info(message: string): void
  success(message: string): void
  warning(message: string): void
}

interface CloudflaredSetupDeps {
  enableService?: typeof cloudflaredEnableService
  hasToken?: typeof cloudflaredHasTunnelToken
  logger?: CloudflaredSetupLogger
  promptConfirm?: typeof tuiPromptConfirmResult
  promptPassword?: typeof tuiPromptPasswordResult
  saveToken?: typeof cloudflaredSaveTunnelToken
}

interface CloudflaredSetupConfigured {
  keptExisting: boolean
  status: 'configured'
}

interface CloudflaredSetupSkipped {
  reason: 'invalid_token'
  status: 'skipped'
}

/** Keeps the existing boolean setup contract for interactive callers. */
export async function cloudflaredRunSetup(
  paths: Paths,
  deps: CloudflaredSetupDeps = {},
): Promise<boolean> {
  const logger = deps.logger ?? tuiLog
  const result = await cloudflaredRunSetupResult(paths, { ...deps, logger })
  return renderSetupResult(result, logger)
}

/** Runs tunnel setup and returns a structured outcome or a shared typed error. */
export async function cloudflaredRunSetupResult(
  paths: Paths,
  deps: CloudflaredSetupDeps = {},
): Promise<
  | CloudflaredSetupConfigured
  | CloudflaredSetupSkipped
  | CancelledError
  | InternalError
  | ValidationError
> {
  const hasToken = deps.hasToken ?? cloudflaredHasTunnelToken
  const confirm = deps.promptConfirm ?? tuiPromptConfirmResult
  const password = deps.promptPassword ?? tuiPromptPasswordResult
  const saveToken = deps.saveToken ?? cloudflaredSaveTunnelToken
  const enableService = deps.enableService ?? cloudflaredEnableService

  if (hasToken(paths)) {
    try {
      const replace = await confirm({
        message: 'Existing tunnel token found. Replace it?',
        initialValue: false,
      })
      if (replace instanceof Error) {
        return replace
      }
      if (!replace) {
        return startService(true, enableService)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`confirm tunnel token replacement: ${message}`, { cause: error })
    }
  }

  let raw: string
  try {
    logTokenInstructions(deps.logger)
    const token = await password({
      message: 'Tunnel token (or full "cloudflared service install <token>" command)',
    })
    if (token instanceof Error) {
      return token
    }
    raw = token
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`read tunnel token input: ${message}`, { cause: error })
  }

  const saveTokenResult = await saveToken(paths, raw)
  if (saveTokenResult instanceof Error) {
    return new InternalError(saveTokenResult.message, { cause: saveTokenResult })
  }
  if (!saveTokenResult) {
    return { status: 'skipped', reason: 'invalid_token' }
  }

  return startService(false, enableService)
}

/** Starts the managed cloudflared service and maps startup failures to an internal result error. */
async function startService(
  keptExisting: boolean,
  enableService: typeof cloudflaredEnableService,
): Promise<CloudflaredSetupConfigured | InternalError> {
  try {
    const started = await enableService()
    if (!started.ok) {
      const message = started.detail
        ? `cloudflared failed to start: ${started.detail}`
        : 'cloudflared failed to start'
      return new InternalError(message)
    }
    return { status: 'configured', keptExisting }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`cloudflared failed to start: ${message}`, { cause: error })
  }
}

/** Prints where Cloudflare exposes tunnel tokens before the password prompt is shown. */
function logTokenInstructions(logger: CloudflaredSetupLogger | undefined): void {
  if (!logger) {
    return
  }
  logger.info('Get a token at dash.cloudflare.com → Zero Trust → Networks → Connectors,')
  logger.info('then create a tunnel and copy the install command or token.')
}

/** Turns the structured setup result into the existing user-facing log flow. */
function renderSetupResult(
  result:
    | CloudflaredSetupConfigured
    | CloudflaredSetupSkipped
    | CancelledError
    | InternalError
    | ValidationError,
  logger: CloudflaredSetupLogger,
): boolean {
  if (result instanceof Error) {
    logger.warning(`tunnel token setup skipped: ${result.message}`)
    return false
  }

  if (result.status === 'skipped') {
    logger.warning('tunnel token setup skipped: input did not contain a tunnel token')
    return false
  }

  if (result.keptExisting) {
    logger.success('keeping existing tunnel token')
    return true
  }

  logger.success('tunnel token saved')
  logger.success('cloudflared started')
  return true
}
