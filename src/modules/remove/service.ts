import { RemoveMissingAppError, RemoveWriteConfigError } from './errors.ts'
import type { RemoveObserver, RemoveParams, RemoveResult, RemoveSupport } from './types.ts'

export { RemoveMissingAppError, RemoveWriteConfigError } from './errors.ts'

export interface RemoveRunContext {
  support: RemoveSupport
  observer?: RemoveObserver
}

/** Removes one app and persists the config change before best-effort cleanup. */
export async function removeApp(
  ctx: RemoveRunContext,
  params: RemoveParams,
): Promise<RemoveResult | RemoveMissingAppError | RemoveWriteConfigError> {
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
  const writeResult = await ctx.support.writeConfig(params.configFile, {
    ...params.cfg,
    apps: nextApps,
  })
  if (writeResult instanceof RemoveWriteConfigError) return writeResult

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

/** Runs a cleanup step and downgrades failures to observer warnings. */
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
