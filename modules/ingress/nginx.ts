import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ExecFn, getExec } from './exec.ts'
import { nginxAppConfDir, nginxConfFilename, renderNginxSite } from './nginx-templates.ts'
import type { IngressClaim, IngressOperator } from './types.ts'

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

export interface NginxIngressDeps {
  nginxDir: string
  exec?: ExecFn
  certExists?: CertExistsFn
}

export function createNginxIngressOperator(deps: NginxIngressDeps): IngressOperator {
  const exec = deps.exec ?? getExec()
  const certExists = deps.certExists ?? defaultCertExists

  return {
    async claim(claim, onProgress) {
      const staged = await stageNginxAppDir(deps.nginxDir, claim.app)
      try {
        onProgress?.({ app: claim.app, message: `writing ${claim.domains.length} config(s)` })
        await renderAndWrite(deps.nginxDir, claim, certExists)
        onProgress?.({ app: claim.app, message: 'running nginx -t + reload' })
        const result = await reloadNginx(exec)
        if (!result.ok) throw new Error(result.error)
        await discardStagedAppDir(staged)
      } catch (error) {
        await restoreStagedAppDir(staged)
        throw error
      }
    },
    async release(app, onProgress) {
      const staged = await stageNginxAppDir(deps.nginxDir, app)
      if (!staged.existed) return
      try {
        onProgress?.({ app, message: `removing configs for ${app}` })
        const result = await reloadNginx(exec)
        if (!result.ok) throw new Error(result.error)
        await discardStagedAppDir(staged)
      } catch (error) {
        await restoreStagedAppDir(staged)
        throw error
      }
    },
  }
}

async function renderAndWrite(
  nginxDir: string,
  claim: IngressClaim,
  certExists: CertExistsFn,
): Promise<void> {
  const dir = nginxAppConfDir(nginxDir, claim.app)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true, mode: 0o755 })
  for (const domain of claim.domains) {
    const hasSSL = domain.isTunnel ? false : await certExists(domain.host)
    const body = renderNginxSite({
      host: domain.host,
      port: domain.port,
      isTunnel: domain.isTunnel,
      hasSSL,
    })
    await writeFile(join(dir, nginxConfFilename(domain.host)), body, { mode: 0o644 })
  }
}

interface StagedAppDir {
  backup: string
  current: string
  existed: boolean
}

async function stageNginxAppDir(nginxDir: string, app: string): Promise<StagedAppDir> {
  const current = nginxAppConfDir(nginxDir, app)
  const backup = `${current}.bak`
  await rm(backup, { recursive: true, force: true })
  try {
    await rename(current, backup)
    return { current, backup, existed: true }
  } catch (error) {
    if (isMissingPathError(error)) return { current, backup, existed: false }
    throw error
  }
}

async function restoreStagedAppDir(staged: StagedAppDir): Promise<void> {
  await rm(staged.current, { recursive: true, force: true })
  if (!staged.existed) return
  await rename(staged.backup, staged.current)
}

async function discardStagedAppDir(staged: StagedAppDir): Promise<void> {
  if (!staged.existed) return
  await rm(staged.backup, { recursive: true, force: true })
}

async function reloadNginx(exec: ExecFn): Promise<{ ok: true } | { ok: false; error: string }> {
  const test = await exec(['sudo', 'nginx', '-t'])
  if (!test.ok) return { ok: false, error: `nginx -t failed: ${test.stderr.trim()}` }
  const reload = await exec(['sudo', 'systemctl', 'reload', 'nginx'])
  if (!reload.ok) {
    return { ok: false, error: `systemctl reload nginx failed: ${reload.stderr.trim()}` }
  }
  return { ok: true }
}

function isMissingPathError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}
