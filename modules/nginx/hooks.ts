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

/**
 * Runs `nginx -t` and (on success) `systemctl reload nginx`. Returns `true`
 * only when both succeed. The caller is responsible for rolling back any
 * on-disk changes when this returns `false` so the filesystem never drifts
 * from the running nginx config. Both commands' stderr is surfaced via
 * `logger.warn` for debugging.
 */
async function reloadNginx(ctx: Ctx): Promise<boolean> {
  const exec = getExec()
  const test = await exec(['nginx', '-t'])
  if (!test.ok) {
    ctx.logger.warn(`nginx -t failed, NOT reloading: ${test.stderr.trim()}`)
    return false
  }
  const reload = await exec(['systemctl', 'reload', 'nginx'])
  if (!reload.ok) {
    ctx.logger.warn(`systemctl reload nginx failed: ${reload.stderr.trim()}`)
    return false
  }
  ctx.logger.info('nginx reloaded')
  return true
}

async function writeAppConfigs(ctx: Ctx, app: string): Promise<string[]> {
  const appCfg = ctx.config.apps[app]
  if (!appCfg || appCfg.domains.length === 0) return []
  await mkdir(ctx.paths.nginxDir, { recursive: true, mode: 0o755 })
  const written: string[] = []
  for (const d of appCfg.domains) {
    const isTunnel = d.ingress === 'cloudflare-tunnel'
    const hasSSL = isTunnel ? false : await hasLetsEncryptCert(d.host)
    // Narrow assertion: jib's CLI fills `port` in via `allocatePort` before
    // the first writeConfig, so by the time nginx sees a domain it's always
    // populated. See DomainSchema NOTE. This hook file is removed in stage 2.
    if (d.port === undefined) throw new Error(`unreachable: domain ${d.host} has no port`)
    const body = renderSite({ host: d.host, port: d.port, isTunnel, hasSSL })
    const path = join(ctx.paths.nginxDir, confFilename(d.host))
    await writeFile(path, body, { mode: 0o644 })
    ctx.logger.info(`nginx: wrote ${path}`)
    written.push(path)
  }
  return written
}

/** Best-effort rollback: deletes a list of paths, swallowing errors. */
async function rollback(ctx: Ctx, paths: string[]): Promise<void> {
  for (const p of paths) {
    await rm(p, { force: true })
    ctx.logger.warn(`nginx: rolled back ${p}`)
  }
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
    const written = await writeAppConfigs(c, app)
    if (written.length === 0) return
    const ok = await reloadNginx(c)
    if (!ok) await rollback(c, written)
  },
  async onAppRemove(ctx, app) {
    const c = ctx as Ctx
    const n = await removeAppConfigs(c, app)
    if (n > 0) await reloadNginx(c)
  },
}
