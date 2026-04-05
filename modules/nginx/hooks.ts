import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import type { ModuleContext, SetupHook } from '@jib/core'
import { getExec } from './shell.ts'
import { confFilename, renderSite } from './templates.ts'

type Ctx = ModuleContext<Config>

/**
 * Returns `true` if a Let's Encrypt fullchain cert exists on disk for `host`.
 * Checked via `stat` (not via nginx) so hooks stay pure-Bun. Cloudflare-tunnel
 * domains never enable TLS regardless of cert presence — the tunnel edge does
 * that. When `stat` throws (ENOENT or EACCES), we simply treat it as "no cert".
 */
async function hasLetsEncryptCert(host: string): Promise<boolean> {
  try {
    await stat(`/etc/letsencrypt/live/${host}/fullchain.pem`)
    return true
  } catch {
    return false
  }
}

async function reloadNginx(ctx: Ctx): Promise<void> {
  const exec = getExec()
  const test = await exec(['nginx', '-t'])
  if (!test.ok) {
    ctx.logger.warn(`nginx -t failed, NOT reloading: ${test.stderr.trim()}`)
    return
  }
  const reload = await exec(['systemctl', 'reload', 'nginx'])
  if (!reload.ok) {
    ctx.logger.warn(`systemctl reload nginx failed: ${reload.stderr.trim()}`)
    return
  }
  ctx.logger.info('nginx reloaded')
}

async function writeAppConfigs(ctx: Ctx, app: string): Promise<number> {
  const appCfg = ctx.config.apps[app]
  if (!appCfg || appCfg.domains.length === 0) return 0
  await mkdir(ctx.paths.nginxDir, { recursive: true, mode: 0o755 })
  let written = 0
  for (const d of appCfg.domains) {
    const isTunnel = d.ingress === 'cloudflare-tunnel'
    const hasSSL = isTunnel ? false : await hasLetsEncryptCert(d.host)
    const body = renderSite({ host: d.host, port: d.port, isTunnel, hasSSL })
    const path = join(ctx.paths.nginxDir, confFilename(d.host))
    await writeFile(path, body, { mode: 0o644 })
    ctx.logger.info(`nginx: wrote ${path}`)
    written++
  }
  return written
}

async function removeAppConfigs(ctx: Ctx, app: string): Promise<number> {
  const appCfg = ctx.config.apps[app]
  if (!appCfg || appCfg.domains.length === 0) return 0
  let removed = 0
  for (const d of appCfg.domains) {
    const path = join(ctx.paths.nginxDir, confFilename(d.host))
    await rm(path, { force: true })
    ctx.logger.info(`nginx: removed ${path}`)
    removed++
  }
  return removed
}

export const setupHooks: SetupHook<Config> = {
  async onAppAdd(ctx, app) {
    const c = ctx as Ctx
    const n = await writeAppConfigs(c, app)
    if (n > 0) await reloadNginx(c)
  },
  async onAppRemove(ctx, app) {
    const c = ctx as Ctx
    const n = await removeAppConfigs(c, app)
    if (n > 0) await reloadNginx(c)
  },
}
