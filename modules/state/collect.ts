import type { Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { type SourceStatus, collectSourceStatuses } from '@jib/sources'
import { $ } from 'bun'
import { StateError } from './errors.ts'
import { createStateStore, loadState } from './store.ts'

export interface ServiceStatus {
  name: string
  active: boolean
  status: string
}

export interface ContainerStatus {
  service: string
  state: string
  status: string
}

export interface AppStatus {
  name: string
  sha: string
  lastDeploy: string
  lastDeployStatus: string
  containers: ContainerStatus[]
  domains: { host: string; port?: number | undefined }[]
}

const WATCHER_SERVICE = 'jib-watcher'
const CLOUDFLARED_SERVICE = 'jib-cloudflared'

export function managedServiceNames(hasCloudflared: boolean): string[] {
  return hasCloudflared ? [WATCHER_SERVICE, CLOUDFLARED_SERVICE] : [WATCHER_SERVICE]
}

export async function collectServices(hasCloudflared: boolean): Promise<ServiceStatus[]> {
  return Promise.all(managedServiceNames(hasCloudflared).map(checkUnit))
}

export function normalizeUnitStatus(output: string, exitCode: number): string {
  const raw = output.trim()
  if (!raw) return exitCode === 0 ? 'unknown' : 'unavailable'
  const firstLine = raw.split('\n', 1)[0]?.trim() ?? ''
  return /^[a-z-]+$/.test(firstLine) ? firstLine : 'unavailable'
}

async function checkUnit(name: string): Promise<ServiceStatus> {
  const res = await $`systemctl is-active ${name}`.quiet().nothrow()
  const output = res.stdout.toString() || res.stderr.toString()
  const status = normalizeUnitStatus(output, res.exitCode)
  return { name, active: status === 'active', status }
}

export async function collectSources(cfg: Config, paths: Paths): Promise<SourceStatus[]> {
  return collectSourceStatuses(cfg, paths)
}

export async function collectApps(cfg: Config, paths: Paths): Promise<AppStatus[]> {
  const store = createStateStore(paths.stateDir)
  const results: AppStatus[] = []
  for (const [name, app] of Object.entries(cfg.apps)) {
    const state = await loadState(store, name)
    if (state instanceof StateError) throw state
    const containers = await collectContainers(name)
    results.push({
      name,
      sha: state.deployed_sha,
      lastDeploy: state.last_deploy,
      lastDeployStatus: state.last_deploy_status,
      containers,
      domains: app.domains.map((d) => ({ host: d.host, port: d.port })),
    })
  }
  return results
}

async function collectContainers(app: string): Promise<ContainerStatus[]> {
  const res = await $`docker compose -p jib-${app} ps --format json`.quiet().nothrow()
  if (res.exitCode !== 0) return []
  const stdout = res.stdout.toString().trim()
  if (!stdout) return []
  try {
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const obj = JSON.parse(line) as { Service: string; State: string; Status: string }
        return { service: obj.Service, state: obj.State, status: obj.Status }
      })
  } catch {
    return []
  }
}
