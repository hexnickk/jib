import { rm } from 'node:fs/promises'
import type { InstallFn } from '@jib/core'
import { $ } from 'bun'
import { CLOUDFLARE_SERVICE_NAME, CLOUDFLARE_UNIT_PATH } from './templates.ts'

/**
 * Tears down the cloudflare operator systemd unit. Leaves the API token in
 * place on disk — operators may reinstall against the same token — and does
 * not touch the tunnel itself (the `modules/cloudflared` daemon owns that).
 */
export const uninstall: InstallFn = async (ctx) => {
  const log = ctx.logger
  log.info(`systemctl disable --now ${CLOUDFLARE_SERVICE_NAME}`)
  await $`systemctl disable --now ${CLOUDFLARE_SERVICE_NAME}`.nothrow()
  log.info(`removing ${CLOUDFLARE_UNIT_PATH}`)
  await rm(CLOUDFLARE_UNIT_PATH, { force: true })
  await $`systemctl daemon-reload`.nothrow()
}
