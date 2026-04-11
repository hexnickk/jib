import { enableCloudflaredService, hasTunnelToken, saveTunnelToken } from '@jib-module/cloudflared'
import type { Paths } from '@jib/core'
import { log, promptConfirm, promptPassword } from '@jib/tui'

function startFailureMessage(prefix: string, detail: string): string {
  return detail ? `${prefix}: ${detail}` : prefix
}

export async function runCloudflaredSetup(paths: Paths): Promise<void> {
  if (hasTunnelToken(paths)) {
    const replace = await promptConfirm({
      message: 'Existing tunnel token found. Replace it?',
      initialValue: false,
    })
    if (!replace) {
      log.success('keeping existing tunnel token')
      const started = await enableCloudflaredService()
      if (!started.ok) {
        log.warning(startFailureMessage('cloudflared failed to start', started.detail))
      }
      return
    }
  }

  log.info('Create a tunnel at dash.cloudflare.com → Zero Trust → Tunnels,')
  log.info('then paste the install command or just the token.')
  try {
    const raw = await promptPassword({
      message: 'Tunnel token (or full "cloudflared service install <token>" command)',
    })
    if (!(await saveTunnelToken(paths, raw))) {
      log.warning('tunnel token setup skipped: input did not contain a tunnel token')
      return
    }

    log.success('tunnel token saved')
    const started = await enableCloudflaredService()
    if (!started.ok) {
      log.warning(startFailureMessage('cloudflared failed to start', started.detail))
      return
    }
    log.success('cloudflared started')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warning(`tunnel token setup skipped: ${message}`)
  }
}
