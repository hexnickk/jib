import { withBus } from '@jib/bus'
import type { App } from '@jib/config'
import { isTextOutput } from '@jib/core'
import { spinner } from '@jib/tui'
import { emitAndWait } from './client.ts'
import { SUBJECTS } from './subjects.ts'

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
