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
  const result = await cloudflaredRunSetupResult(paths, deps)
  return renderSetupResult(result, deps.logger ?? tuiLog)
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

/** Turns the structured setup result into the existing user-facing log flow. */
function renderSetupResult(
  result: CloudflaredSetupResult,
  logger: CloudflaredSetupLogger,
): boolean {
  if (shouldShowSetupIntro(result)) {
    logger.info('Create a tunnel at dash.cloudflare.com → Zero Trust → Tunnels,')
    logger.info('then paste the install command or just the token.')
  }

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

/** Decides whether the setup banner still helps after a partial failure. */
function shouldShowSetupIntro(result: CloudflaredSetupResult): boolean {
  if (result instanceof CloudflaredSetupSaveTokenError) return true
  if (result instanceof CloudflaredSetupPromptError) return result.step === 'token'
  if (result instanceof CloudflaredStartError) return !result.keptExisting
  if (result.status === 'skipped') return true
  return !result.keptExisting
}

// Compatibility aliases for callers outside this slice.
export const runCloudflaredSetup = cloudflaredRunSetup
export const runCloudflaredSetupResult = cloudflaredRunSetupResult
