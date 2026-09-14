import { rm } from 'node:fs/promises'
import { type Config, configWrite } from '@jib/config'
import { dockerComposeFor, dockerOverridePath } from '@jib/docker'
import { type JibError, NotFoundError } from '@jib/errors'
import { type Paths, pathsManagedComposePath } from '@jib/paths'
import { secretsRemoveApp } from '@jib/secrets'
import { sourcesRemoveCheckout } from '@jib/sources'
import { stateRemove } from '@jib/state'

interface RemoveContext {
  paths: Paths
  releaseIngress(appName: string): Promise<JibError | undefined>
  warn?(message: string): void
}

/** Removes one app and persists the config change before best-effort cleanup. */
export async function removeApp(
  ctx: RemoveContext,
  params: { appName: string; cfg: Config; configFile: string; quiet: boolean },
): Promise<JibError | undefined> {
  const { paths } = ctx
  const { appName, cfg, configFile, quiet } = params
  const appCfg = cfg.apps[appName]
  if (!appCfg) {
    return new NotFoundError(`app "${appName}" not found in config`)
  }

  if (appCfg.domains.length > 0) {
    await runBestEffort(ctx, 'ingress release', () => ctx.releaseIngress(appName))
  }
  await runBestEffort(ctx, 'compose down', async () => {
    const compose = dockerComposeFor(cfg, paths, appName)
    if (compose instanceof Error) {
      return compose
    }
    return await compose.down(false, { quiet })
  })
  const nextApps = { ...cfg.apps }
  delete nextApps[appName]
  const writeResult = await configWrite(configFile, { ...cfg, apps: nextApps })
  if (writeResult instanceof Error) {
    return writeResult
  }

  await runBestEffort(ctx, 'repo cleanup', () => sourcesRemoveCheckout(paths, appName, appCfg.repo))
  await runBestEffort(ctx, 'secrets cleanup', () => secretsRemoveApp(paths.secretsDir, appName))
  await runBestEffort(ctx, 'state cleanup', () => stateRemove(paths.stateDir, appName))
  await runBestEffort(ctx, 'override cleanup', () =>
    rm(dockerOverridePath(paths.overridesDir, appName), { force: true }),
  )
  await runBestEffort(ctx, 'managed compose cleanup', () =>
    rm(pathsManagedComposePath(paths, appName), { force: true }),
  )
}

/** Runs a cleanup step and downgrades failures to warnings. */
async function runBestEffort(
  ctx: RemoveContext,
  label: string,
  step: () => Promise<JibError | void>,
): Promise<void> {
  try {
    const error = await step()
    if (error instanceof Error) {
      ctx.warn?.(`${label}: ${error.message}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.warn?.(`${label}: ${message}`)
  }
}
