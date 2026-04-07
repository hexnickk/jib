import { withBus } from '@jib/bus'
import type { App } from '@jib/config'
import { SUBJECTS, emitAndWait } from '@jib/rpc'
import { spinner } from '@jib/tui'
import { consola } from 'consola'

/**
 * Post-writeConfig provisioning chain for `jib add`, split into two phases
 * so the caller can slot compose-file inspection between them:
 *
 *   1. `prepareAppRepo` — asks gitsitter to clone/checkout the repo and
 *      returns the workdir path. The caller parses the compose file at
 *      that path to populate `container_port` / `service` on each domain
 *      before rewriting config.
 *   2. `claimNginxRoutes` — asks the nginx operator to materialise
 *      server blocks for the now-fully-resolved domains.
 *
 * Both use clack spinners for progress and throw on failure so the caller
 * can roll back the config entry.
 */
export async function prepareAppRepo(app: string, timeoutMs: number): Promise<{ workdir: string }> {
  return await withBus(async (bus) => {
    const s = spinner()
    s.start(`preparing ${app}`)
    const evt = await emitAndWait(
      bus,
      SUBJECTS.cmd.repoPrepare,
      { app },
      { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
      SUBJECTS.evt.repoProgress,
      { source: 'cli', timeoutMs, onProgress: (p) => s.message(p.message) },
    )
    s.stop('repo ready')
    return { workdir: evt.workdir }
  })
}

export async function claimNginxRoutes(app: string, appCfg: App, timeoutMs: number): Promise<void> {
  await withBus(async (bus) => {
    const s2 = spinner()
    s2.start(`claiming nginx routes for ${app}`)
    await emitAndWait(
      bus,
      SUBJECTS.cmd.nginxClaim,
      {
        app,
        domains: appCfg.domains.map((d) => ({
          host: d.host,
          // `assignPorts` in add.ts guarantees `port` is populated before we
          // get here; treat undefined as a programming error.
          port: d.port as number,
          isTunnel: d.ingress === 'cloudflare-tunnel',
        })),
      },
      { success: SUBJECTS.evt.nginxReady, failure: SUBJECTS.evt.nginxFailed },
      SUBJECTS.evt.nginxProgress,
      { source: 'cli', timeoutMs, onProgress: (p) => s2.message(p.message) },
    )
    s2.stop('nginx ready')
  })
}

/**
 * Best-effort cleanup of gitsitter's workdir when `jib add` fails after
 * `cmd.repo.prepare` succeeded. Must be called *before* the caller removes
 * the app from config — the gitsitter handler reads the config to locate
 * the workdir. Any failure (repo never prepared, bus down, handler throws)
 * is logged and swallowed so the caller can still drop the config entry.
 */
export async function rollbackRepo(app: string, timeoutMs: number): Promise<void> {
  try {
    await withBus(async (bus) => {
      await emitAndWait(
        bus,
        SUBJECTS.cmd.repoRemove,
        { app },
        { success: SUBJECTS.evt.repoRemoved, failure: SUBJECTS.evt.repoFailed },
        undefined,
        { source: 'cli', timeoutMs },
      )
    })
  } catch (err) {
    consola.warn(`repo rollback: ${err instanceof Error ? err.message : String(err)}`)
  }
}
