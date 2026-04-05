import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Bus } from '@jib/bus'
import type { Logger, Paths } from '@jib/core'
import { SUBJECTS, handleCmd } from '@jib/rpc'
import { type ExecFn, getExec } from './shell.ts'
import { appConfFilename, appConfPrefix, renderSite } from './templates.ts'

/**
 * Injection seam for the nginx operator. Tests pass a recording fake; the
 * production default is `getExec()` from `shell.ts`, which shells out via
 * `Bun.$`. Mirrors the pattern used by `modules/nginx/install.ts`.
 */
export interface NginxExec {
  exec: ExecFn
}

export interface NginxOperatorDeps {
  paths: Paths
  log: Logger
  exec?: ExecFn
}

/** Writes all config files for a claim, returning the paths written. */
async function renderAndWrite(
  dir: string,
  app: string,
  domains: ReadonlyArray<{ host: string; port: number }>,
): Promise<string[]> {
  await mkdir(dir, { recursive: true, mode: 0o755 })
  const written: string[] = []
  for (const d of domains) {
    // Operator never sees TLS/cloudflare nuance — that's the CLI's job at add
    // time. For now every operator-written file is the HTTP proxy variant;
    // SSL + tunnel flags are revisited when let's-encrypt lands.
    const body = renderSite({ host: d.host, port: d.port, isTunnel: false, hasSSL: false })
    const path = join(dir, appConfFilename(app, d.host))
    await writeFile(path, body, { mode: 0o644 })
    written.push(path)
  }
  return written
}

/** Best-effort unlink of every path, swallowing ENOENT-style errors. */
async function cleanupFiles(paths: string[]): Promise<void> {
  for (const p of paths) await rm(p, { force: true })
}

/** Removes every `<app>-*.conf` under `dir`. Returns the removed paths. */
async function removeAppFiles(dir: string, app: string): Promise<string[]> {
  const prefix = appConfPrefix(app)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith('.conf')) continue
    const p = join(dir, name)
    await rm(p, { force: true })
    removed.push(p)
  }
  return removed
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
      const written = await renderAndWrite(dir, cmd.app, cmd.domains)
      ctx.emitProgress?.({ app: cmd.app, message: 'running nginx -t + reload' })
      const r = await reload(exec)
      if (!r.ok) {
        await cleanupFiles(written)
        // Re-run `nginx -t` so failure mode leaves nginx in a known-good
        // state on disk (files we wrote are gone).
        await exec(['nginx', '-t']).catch(() => undefined)
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
      const removed = await removeAppFiles(dir, cmd.app)
      if (removed.length === 0) {
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
      log.info(`nginx released ${cmd.app} (${removed.length} file(s))`)
      return { success: { subject: SUBJECTS.evt.nginxReleased, body: { app: cmd.app } } }
    },
  )

  return () => {
    claimSub.unsubscribe()
    releaseSub.unsubscribe()
  }
}
