import { withBus } from '@jib/bus'
import type { App } from '@jib/config'
import { isTextOutput } from '@jib/core'
import { SUBJECTS, emitAndWait } from '@jib/rpc'
import { spinner } from '@jib/tui'

export async function claimIngress(app: string, appCfg: App, timeoutMs: number): Promise<void> {
  if (appCfg.domains.length === 0) return
  await withBus(async (bus) => {
    const s = isTextOutput() ? spinner() : null
    s?.start(`claiming ingress for ${app}`)
    await emitAndWait(
      bus,
      SUBJECTS.cmd.nginxClaim,
      {
        app,
        domains: appCfg.domains.map((domain) => ({
          host: domain.host,
          port: domain.port as number,
          isTunnel: domain.ingress === 'cloudflare-tunnel',
        })),
      },
      { success: SUBJECTS.evt.nginxReady, failure: SUBJECTS.evt.nginxFailed },
      SUBJECTS.evt.nginxProgress,
      { source: 'ingress', timeoutMs, onProgress: (p) => s?.message(p.message) },
    )
    s?.stop('ingress ready')
  })
}

export async function releaseIngress(app: string, timeoutMs: number): Promise<void> {
  await withBus(async (bus) => {
    const s = isTextOutput() ? spinner() : null
    s?.start(`releasing ingress for ${app}`)
    await emitAndWait(
      bus,
      SUBJECTS.cmd.nginxRelease,
      { app },
      { success: SUBJECTS.evt.nginxReleased, failure: SUBJECTS.evt.nginxFailed },
      SUBJECTS.evt.nginxProgress,
      { source: 'ingress', timeoutMs, onProgress: (p) => s?.message(p.message) },
    )
    s?.stop('ingress released')
  })
}
