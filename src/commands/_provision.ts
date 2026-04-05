import { withBus } from '@jib/bus'
import type { App } from '@jib/config'
import { SUBJECTS, emitAndWait } from '@jib/rpc'
import { spinner } from '@jib/tui'

/**
 * Runs the post-writeConfig provisioning chain for `jib add`: asks gitsitter
 * to prepare the repo, then asks the nginx operator to claim routes. Both
 * steps stream progress to a clack spinner. Throws on any failure so the
 * caller can roll back the config entry.
 */
export async function provisionApp(
  app: string,
  appCfg: App,
  timeoutMs: number,
  defaultContainerPort: number,
): Promise<void> {
  await withBus(async (bus) => {
    const s = spinner()
    s.start(`preparing ${app}`)
    await emitAndWait(
      bus,
      SUBJECTS.cmd.repoPrepare,
      { app },
      { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
      SUBJECTS.evt.repoProgress,
      { source: 'cli', timeoutMs, onProgress: (p) => s.message(p.message) },
    )
    s.stop('repo ready')

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
          containerPort: d.container_port ?? defaultContainerPort,
          isTunnel: d.ingress === 'cloudflare-tunnel',
          hasSSL: false,
        })),
      },
      { success: SUBJECTS.evt.nginxReady, failure: SUBJECTS.evt.nginxFailed },
      SUBJECTS.evt.nginxProgress,
      { source: 'cli', timeoutMs, onProgress: (p) => s2.message(p.message) },
    )
    s2.stop('nginx ready')
  })
}
