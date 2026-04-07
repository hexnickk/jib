import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { Config } from '@jib/config'
import type { Paths } from '@jib/core'
import { collectServices, hasTunnelToken } from '@jib/state'
import { $ } from 'bun'

export interface CheckResult {
  ok: boolean
  label: string
  detail?: string
  fixable?: boolean
  fix?: () => Promise<void>
}

export async function runHealthChecks(paths: Paths, config: Config): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  results.push(await checkDirs(paths))
  results.push(await checkPerms(paths))
  results.push(checkConfig(config))
  const hasTunnel = hasTunnelToken(paths)
  const serviceResults = await checkServices(hasTunnel)
  results.push(...serviceResults)
  return results
}

async function checkDirs(paths: Paths): Promise<CheckResult> {
  const dirs = [paths.root, paths.stateDir, paths.secretsDir, paths.reposDir, paths.nginxDir]
  const missing = dirs.filter((d) => !existsSync(d))
  if (missing.length === 0) return { ok: true, label: 'directories' }
  return {
    ok: false,
    label: 'directories',
    detail: `missing: ${missing.join(', ')}`,
  }
}

async function checkPerms(paths: Paths): Promise<CheckResult> {
  try {
    const s = await stat(paths.root)
    const gid = s.gid
    const res = await $`getent group jib`.quiet().nothrow()
    if (res.exitCode !== 0) {
      return { ok: false, label: 'permissions', detail: 'jib group missing' }
    }
    const groupGid = Number(res.stdout.toString().split(':')[2])
    if (gid !== groupGid) {
      return { ok: false, label: 'permissions', detail: `${paths.root} not owned by jib group` }
    }
    return { ok: true, label: 'permissions: root:jib' }
  } catch {
    return { ok: false, label: 'permissions', detail: 'cannot stat root dir' }
  }
}

function checkConfig(config: Config): CheckResult {
  if (config.config_version === 3) {
    return { ok: true, label: 'config schema: v3 (current)' }
  }
  return {
    ok: false,
    label: 'config schema',
    detail: `v${config.config_version} (migration needed)`,
  }
}

async function checkServices(hasTunnel: boolean): Promise<CheckResult[]> {
  const services = await collectServices(hasTunnel)
  return services.map((s) => {
    if (s.active) return { ok: true, label: s.name }
    return {
      ok: false,
      label: s.name,
      detail: s.status,
      fixable: true,
      fix: async () => {
        await $`sudo systemctl restart ${s.name}`.quiet().nothrow()
      },
    }
  })
}
