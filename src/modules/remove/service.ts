import { JibError } from '@jib/errors'
import type { RemoveObserver, RemoveParams, RemoveResult, RemoveSupport } from './types.ts'

export class RemoveMissingAppError extends JibError {
  constructor(appName: string) {
    super('remove_missing_app', `app "${appName}" not found in config`)
    this.name = 'RemoveMissingAppError'
  }
}

export interface RemoveRunContext {
  support: RemoveSupport
  observer?: RemoveObserver
}

export async function runRemove(
  ctx: RemoveRunContext,
  params: RemoveParams,
): Promise<RemoveResult | RemoveMissingAppError> {
  const appCfg = params.cfg.apps[params.appName]
  if (!appCfg) return new RemoveMissingAppError(params.appName)

  if (appCfg.domains.length > 0) {
    await runBestEffort(ctx, 'ingress release', () => ctx.support.releaseIngress(params.appName))
  }

  await runBestEffort(ctx, 'compose down', () =>
    ctx.support.stopApp(params.cfg, params.appName, params.quiet),
  )
  const nextApps = { ...params.cfg.apps }
  delete nextApps[params.appName]
  await ctx.support.writeConfig(params.configFile, { ...params.cfg, apps: nextApps })

  await runBestEffort(ctx, 'repo cleanup', () =>
    ctx.support.removeCheckout(params.appName, appCfg.repo),
  )
  await runBestEffort(ctx, 'secrets cleanup', () => ctx.support.removeSecrets(params.appName))
  await runBestEffort(ctx, 'state cleanup', () => ctx.support.removeState(params.appName))
  await runBestEffort(ctx, 'override cleanup', () => ctx.support.removeOverride(params.appName))
  await runBestEffort(ctx, 'managed compose cleanup', () =>
    ctx.support.removeManagedCompose(params.appName),
  )
  return { app: params.appName, removed: true }
}

async function runBestEffort(
  ctx: RemoveRunContext,
  label: string,
  step: () => Promise<void>,
): Promise<void> {
  try {
    await step()
  } catch (error) {
    ctx.observer?.warn?.(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
