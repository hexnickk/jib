import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Bus } from '@jib/bus'
import type { Logger, Paths } from '@jib/core'
import { SUBJECTS, handleCmd } from '@jib/rpc'
import { type ExecFn, getExec } from './shell.ts'
import { appConfDir, confFilename, renderSite } from './templates.ts'

/**
 * Returns `true` when a Let's Encrypt cert exists for `host`. The operator
 * uses this to decide whether to emit a 443 server block. Injectable so
 * tests can fake it without touching `/etc/letsencrypt`.
 */
export type CertExistsFn = (host: string) => Promise<boolean>

const LETSENCRYPT_LIVE = '/etc/letsencrypt/live'

const defaultCertExists: CertExistsFn = async (host) => {
  try {
    await stat(`${LETSENCRYPT_LIVE}/${host}/fullchain.pem`)
    return true
  } catch {
    return false
  }
}

export interface NginxOperatorDeps {
  paths: Paths
  log: Logger
  exec?: ExecFn
  /** Cert-presence probe; defaults to `stat /etc/letsencrypt/live/<host>/fullchain.pem`. */
  certExists?: CertExistsFn
}

/**
 * Writes all config files for a claim into `${nginxDir}/${app}/`, returning
 * the per-app directory so the caller can nuke it on rollback. The subdir
 * is created fresh every claim so stale files from an earlier claim never
 * linger.
 */
async function renderAndWrite(
  nginxDir: string,
  app: string,
  domains: ReadonlyArray<{ host: string; port: number; isTunnel: boolean }>,
  certExists: CertExistsFn,
): Promise<string> {
  const dir = appConfDir(nginxDir, app)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o755 })
  for (const d of domains) {
    // Tunnel backends terminate TLS at Cloudflare's edge, so skip the probe.
    const hasSSL = d.isTunnel ? false : await certExists(d.host)
    const body = renderSite({
      host: d.host,
      port: d.port,
      isTunnel: d.isTunnel,
      hasSSL,
    })
    await writeFile(join(dir, confFilename(d.host)), body, { mode: 0o644 })
  }
  return dir
}

/** Removes the per-app config directory. Returns true if anything existed. */
async function removeAppDir(nginxDir: string, app: string): Promise<boolean> {
  const dir = appConfDir(nginxDir, app)
  try {
    await rm(dir, { recursive: true })
    return true
  } catch {
    return false
  }
}

async function reload(exec: ExecFn): Promise<{ ok: true } | { ok: false; error: string }> {
  const test = await exec(['nginx', '-t'])
  if (!test.ok) return { ok: false, error: `nginx -t failed: ${test.stderr.trim()}` }
  const rel = await exec(['systemctl', 'reload', 'nginx'])
  if (!rel.ok) return { ok: false, error: `systemctl reload nginx failed: ${rel.stderr.trim()}` }
  return { ok: true }
}

/**
 * Registers `cmd.nginx.claim` + `cmd.nginx.release` on `bus`. Writes per-app
 * config files under `paths.nginxDir`, then `nginx -t` + `systemctl reload`.
 * On any failure the written files are removed so disk state never drifts
 * from the running nginx config. Returns a disposer.
 */
export function registerNginxHandlers(bus: Bus, deps: NginxOperatorDeps): () => void {
  const exec = deps.exec ?? getExec()
  const certExists = deps.certExists ?? defaultCertExists
  const dir = deps.paths.nginxDir
  const log = deps.log

  const claimSub = handleCmd(
    bus,
    SUBJECTS.cmd.nginxClaim,
    'nginx',
    'nginx',
    SUBJECTS.evt.nginxProgress,
    SUBJECTS.evt.nginxFailed,
    async (cmd, ctx) => {
      ctx.emitProgress?.({ app: cmd.app, message: `writing ${cmd.domains.length} config(s)` })
      await renderAndWrite(dir, cmd.app, cmd.domains, certExists)
      ctx.emitProgress?.({ app: cmd.app, message: 'running nginx -t + reload' })
      const r = await reload(exec)
      if (!r.ok) {
        // Cleanup is a blind `rm -rf` of the per-app dir we just wrote; no
        // need to re-run `nginx -t` afterwards since cleanup is pure
        // deletion and the pre-reload state was already green.
        await removeAppDir(dir, cmd.app)
        log.warn(`nginx claim failed for ${cmd.app}: ${r.error}`)
        return {
          failure: {
            subject: SUBJECTS.evt.nginxFailed,
            body: { app: cmd.app, error: r.error },
          },
        }
      }
      log.info(`nginx claim ready for ${cmd.app}`)
      return { success: { subject: SUBJECTS.evt.nginxReady, body: { app: cmd.app } } }
    },
  )

  const releaseSub = handleCmd(
    bus,
    SUBJECTS.cmd.nginxRelease,
    'nginx',
    'nginx',
    SUBJECTS.evt.nginxProgress,
    SUBJECTS.evt.nginxFailed,
    async (cmd, ctx) => {
      ctx.emitProgress?.({ app: cmd.app, message: `removing configs for ${cmd.app}` })
      const existed = await removeAppDir(dir, cmd.app)
      if (!existed) {
        log.info(`nginx release: no files for ${cmd.app} (idempotent)`)
        return { success: { subject: SUBJECTS.evt.nginxReleased, body: { app: cmd.app } } }
      }
      const r = await reload(exec)
      if (!r.ok) {
        log.warn(`nginx release failed for ${cmd.app}: ${r.error}`)
        return {
          failure: {
            subject: SUBJECTS.evt.nginxFailed,
            body: { app: cmd.app, error: r.error },
          },
        }
      }
      log.info(`nginx released ${cmd.app}`)
      return { success: { subject: SUBJECTS.evt.nginxReleased, body: { app: cmd.app } } }
    },
  )

  return () => {
    claimSub.unsubscribe()
    releaseSub.unsubscribe()
  }
}
