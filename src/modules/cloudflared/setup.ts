import { enableCloudflaredService, hasTunnelToken, saveTunnelToken } from '@jib-module/cloudflared'
import type { Paths } from '@jib/paths'
import { log, promptConfirm, promptPassword } from '@jib/tui'
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
  enableService?: typeof enableCloudflaredService
  hasToken?: typeof hasTunnelToken
  logger?: CloudflaredSetupLogger
  promptConfirm?: typeof promptConfirm
  promptPassword?: typeof promptPassword
  saveToken?: typeof saveTunnelToken
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

export async function runCloudflaredSetup(
  paths: Paths,
  deps: CloudflaredSetupDeps = {},
): Promise<boolean> {
  const result = await runCloudflaredSetupResult(paths, deps)
  return renderCloudflaredSetupResult(result, deps.logger ?? log)
}

export async function runCloudflaredSetupResult(
  paths: Paths,
  deps: CloudflaredSetupDeps = {},
): Promise<CloudflaredSetupResult> {
  const hasToken = deps.hasToken ?? hasTunnelToken
  const confirm = deps.promptConfirm ?? promptConfirm
  const password = deps.promptPassword ?? promptPassword
  const saveToken = deps.saveToken ?? saveTunnelToken
  const enableService = deps.enableService ?? enableCloudflaredService

  if (hasToken(paths)) {
    try {
      const replace = await confirm({
        message: 'Existing tunnel token found. Replace it?',
        initialValue: false,
      })
      if (!replace) return startCloudflaredService(true, enableService)
    } catch (error) {
      return new CloudflaredSetupPromptError('replace', error)
    }
  }

  let raw: string
  try {
    raw = await password({
      message: 'Tunnel token (or full "cloudflared service install <token>" command)',
    })
  } catch (error) {
    return new CloudflaredSetupPromptError('token', error)
  }

  try {
    if (!(await saveToken(paths, raw))) return { status: 'skipped', reason: 'invalid_token' }
  } catch (error) {
    return new CloudflaredSetupSaveTokenError(error)
  }

  return startCloudflaredService(false, enableService)
}

async function startCloudflaredService(
  keptExisting: boolean,
  enableService: typeof enableCloudflaredService,
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

function renderCloudflaredSetupResult(
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

function shouldShowSetupIntro(result: CloudflaredSetupResult): boolean {
  if (result instanceof CloudflaredSetupSaveTokenError) return true
  if (result instanceof CloudflaredSetupPromptError) return result.step === 'token'
  if (result instanceof CloudflaredStartError) return !result.keptExisting
  if (result.status === 'skipped') return true
  return !result.keptExisting
}
