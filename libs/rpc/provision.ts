import { withBus } from '@jib/bus'
import type { App } from '@jib/config'
import { isTextOutput } from '@jib/core'
import { spinner } from '@jib/tui'
import { consola } from 'consola'
import { emitAndWait } from './client.ts'
import { SUBJECTS } from './subjects.ts'

interface RepoTarget {
  repo: string
  branch: string
  provider?: string
}

/**
 * Repo + ingress provisioning helpers for `jib add`, split into two phases
 * so the caller can inspect compose and write config only after the repo is
 * ready and the app shape is fully resolved:
 *
 *   1. `prepareAppRepo` — asks gitsitter to clone/checkout the repo and
 *      returns the workdir path. The caller parses the compose file at
 *      that path to populate `container_port` / `service` on each domain
 *      before rewriting config.
 *   2. `claimNginxRoutes` — asks the nginx operator to materialise
 *      server blocks for the now-fully-resolved domains, when the app has
 *      ingress configured at all.
 *
 * Both use clack spinners for progress and throw on failure so the caller
 * can clean up the repo checkout and, if needed, the final config entry.
 */
export async function prepareAppRepo(
  app: string,
  timeoutMs: number,
  target?: RepoTarget,
): Promise<{ workdir: string }> {
  return await withBus(async (bus) => {
    const s = isTextOutput() ? spinner() : null
    s?.start(`preparing ${app}`)
    const evt = await emitAndWait(
      bus,
      SUBJECTS.cmd.repoPrepare,
      {
        app,
        ...(target ? { repo: target.repo, branch: target.branch } : {}),
        ...(target?.provider ? { provider: target.provider } : {}),
      },
      { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
      SUBJECTS.evt.repoProgress,
      { source: 'cli', timeoutMs, onProgress: (p) => s?.message(p.message) },
    )
    s?.stop('repo ready')
    return { workdir: evt.workdir }
  })
}

export async function claimNginxRoutes(app: string, appCfg: App, timeoutMs: number): Promise<void> {
  if (appCfg.domains.length === 0) return
  await withBus(async (bus) => {
    const s2 = isTextOutput() ? spinner() : null
    s2?.start(`claiming nginx routes for ${app}`)
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
      { source: 'cli', timeoutMs, onProgress: (p) => s2?.message(p.message) },
    )
    s2?.stop('nginx ready')
  })
}

/**
 * Best-effort cleanup of gitsitter's workdir when `jib add` fails after
 * `cmd.repo.prepare` succeeded. When the app was never written to config,
 * the caller can pass `repo` so gitsitter can still resolve the checkout
 * path. Any failure (repo never prepared, bus down, handler throws) is
 * logged and swallowed so the caller can still drop the config entry.
 */
export async function rollbackRepo(app: string, timeoutMs: number, repo?: string): Promise<void> {
  try {
    await withBus(async (bus) => {
      await emitAndWait(
        bus,
        SUBJECTS.cmd.repoRemove,
        { app, ...(repo ? { repo } : {}) },
        { success: SUBJECTS.evt.repoRemoved, failure: SUBJECTS.evt.repoFailed },
        undefined,
        { source: 'cli', timeoutMs },
      )
    })
  } catch (err) {
    if (isTextOutput()) {
      consola.warn(`repo rollback: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
