import {
  CloudflaredSaveTunnelTokenError,
  cloudflaredEnableService,
  cloudflaredHasTunnelToken,
  cloudflaredSaveTunnelToken,
} from '@jib-module/cloudflared'
import type { Paths } from '@jib/paths'
import { tuiLog, tuiPromptConfirmResult, tuiPromptPasswordResult } from '@jib/tui'
import {
  CloudflaredSetupPromptError,
  CloudflaredSetupSaveTokenError,
  CloudflaredStartError,
} from './errors.ts'

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

export type CloudflaredSetupResult =
  | CloudflaredSetupConfigured
  | CloudflaredSetupSkipped
  | CloudflaredSetupPromptError
  | CloudflaredSetupSaveTokenError
  | CloudflaredStartError

/** Keeps the existing boolean setup contract for interactive callers. */
export async function cloudflaredRunSetup(
  paths: Paths,
  deps: CloudflaredSetupDeps = {},
): Promise<boolean> {
  const logger = deps.logger ?? tuiLog
  const result = await cloudflaredRunSetupResult(paths, { ...deps, logger })
  return renderSetupResult(result, logger)
}

/** Runs tunnel setup and returns a structured outcome for CLI callers. */
export async function cloudflaredRunSetupResult(
  paths: Paths,
  deps: CloudflaredSetupDeps = {},
): Promise<CloudflaredSetupResult> {
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
      if (replace instanceof Error) return new CloudflaredSetupPromptError('replace', replace)
      if (!replace) return startService(true, enableService)
    } catch (error) {
      return new CloudflaredSetupPromptError('replace', error)
    }
  }

  let raw: string
  try {
    logTokenInstructions(deps.logger)
    const token = await password({
      message: 'Tunnel token (or full "cloudflared service install <token>" command)',
    })
    if (token instanceof Error) return new CloudflaredSetupPromptError('token', token)
    raw = token
  } catch (error) {
    return new CloudflaredSetupPromptError('token', error)
  }

  const saveTokenResult = await saveToken(paths, raw)
  if (saveTokenResult instanceof CloudflaredSaveTunnelTokenError) {
    return new CloudflaredSetupSaveTokenError(saveTokenResult)
  }
  if (!saveTokenResult) return { status: 'skipped', reason: 'invalid_token' }

  return startService(false, enableService)
}

/** Starts the managed cloudflared service and converts startup failures into typed results. */
async function startService(
  keptExisting: boolean,
  enableService: typeof cloudflaredEnableService,
): Promise<CloudflaredSetupConfigured | CloudflaredStartError> {
  try {
    const started = await enableService()
    if (!started.ok) return new CloudflaredStartError(started.detail, keptExisting)
    return { status: 'configured', keptExisting }
  } catch (error) {
    return new CloudflaredStartError(
      error instanceof Error ? error.message : String(error),
      keptExisting,
      { cause: error instanceof Error ? error : undefined },
    )
  }
}

/** Prints where Cloudflare exposes tunnel tokens before the password prompt is shown. */
function logTokenInstructions(logger: CloudflaredSetupLogger | undefined): void {
  if (!logger) return
  logger.info('Get a token at dash.cloudflare.com → Zero Trust → Networks → Connectors,')
  logger.info('then create a tunnel and copy the install command or token.')
}

/** Turns the structured setup result into the existing user-facing log flow. */
function renderSetupResult(
  result: CloudflaredSetupResult,
  logger: CloudflaredSetupLogger,
): boolean {
  if (
    result instanceof CloudflaredSetupPromptError ||
    result instanceof CloudflaredSetupSaveTokenError
  ) {
    logger.warning(`tunnel token setup skipped: ${result.message}`)
    return false
  }

  if (result instanceof CloudflaredStartError) {
    logger.warning(result.message)
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
