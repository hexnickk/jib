import { rm } from 'node:fs/promises'
import { type Config, configWrite } from '@jib/config'
import { dockerComposeFor, dockerOverridePath } from '@jib/docker'
import { type JibError, NotFoundError } from '@jib/errors'
import { ingressCreateOperator, ingressRelease } from '@jib/ingress'
import { loggingCreateLogger } from '@jib/logging'
import { type Paths, pathsManagedComposePath } from '@jib/paths'
import { secretsRemoveApp } from '@jib/secrets'
import { sourcesRemoveCheckout } from '@jib/sources'
import { stateRemove } from '@jib/state'
import { tuiSpinner } from '@jib/tui'

/** Owns app teardown and its diagnostics, including when called by add rollback. */
export async function removeApp(
  ctx: { paths: Paths; cfg: Config },
  app: string,
): Promise<JibError | undefined> {
  const { paths, cfg } = ctx
  const log = loggingCreateLogger('remove')
  const appCfg = cfg.apps[app]
  if (!appCfg) {
    return new NotFoundError(`app "${app}" not found in config`)
  }
  async function cleanup(label: string, step: () => Promise<JibError | void>) {
    try {
      const error = await step()
      if (error instanceof Error) {
        log.warn(`${app}: ${label}: ${error.message}`)
      }
    } catch (error) {
      log.warn(`${app}: ${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (appCfg.domains.length > 0) {
    await cleanup('ingress release', async () => {
      const progress = tuiSpinner()
      progress.start(`releasing ingress for ${app}`)
      let released = false
      try {
        const error = await ingressRelease(ingressCreateOperator(paths), app, (update) =>
          progress.message(update.message),
        )
        released = !error
        return error
      } finally {
        progress.stop(released ? 'ingress released' : 'ingress release failed')
      }
    })
  }
  await cleanup('compose down', async () => {
    const compose = dockerComposeFor(cfg, paths, app)
    if (compose instanceof Error) {
      return compose
    }
    // Preserve the existing removal policy: Docker volumes retain the app's persistent data.
    return compose.down(false)
  })
  const nextApps = { ...cfg.apps }
  delete nextApps[app]
  const saved = await configWrite(paths.configFile, { ...cfg, apps: nextApps })
  if (saved) {
    return saved
  }

  await cleanup('repo cleanup', () => sourcesRemoveCheckout(paths, app, appCfg.repo))
  await cleanup('secrets cleanup', () => secretsRemoveApp(paths.secretsDir, app))
  await cleanup('state cleanup', () => stateRemove(paths.stateDir, app))
  await cleanup('override cleanup', () =>
    rm(dockerOverridePath(paths.overridesDir, app), { force: true }),
  )
  await cleanup('managed compose cleanup', () =>
    rm(pathsManagedComposePath(paths, app), { force: true }),
  )
}
