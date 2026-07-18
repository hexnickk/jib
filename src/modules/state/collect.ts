import { $ } from '@/libs/shell'
import type { Config } from '@jib/config'
import type { InternalError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { type SourceStatus, sourcesCollectStatuses } from '@jib/sources'
import { stateCreateStore, stateLoad } from './store.ts'

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

/** Returns the systemd units managed by the status screen. */
export function stateManagedServiceNames(hasCloudflared: boolean): string[] {
  return hasCloudflared ? [WATCHER_SERVICE, CLOUDFLARED_SERVICE] : [WATCHER_SERVICE]
}

/** Reads `systemctl is-active` for the managed units and normalizes the result. */
export async function stateCollectServices(hasCloudflared: boolean): Promise<ServiceStatus[]> {
  return Promise.all(stateManagedServiceNames(hasCloudflared).map(checkUnit))
}

/** Normalizes `systemctl is-active` output into a stable display string. */
export function stateNormalizeUnitStatus(output: string, exitCode: number): string {
  const raw = output.trim()
  if (!raw) {
    return exitCode === 0 ? 'unknown' : 'unavailable'
  }
  const firstLine = raw.split('\n', 1)[0]?.trim() ?? ''
  return /^[a-z-]+$/.test(firstLine) ? firstLine : 'unavailable'
}

async function checkUnit(name: string): Promise<ServiceStatus> {
  try {
    const result = await $`systemctl is-active ${name}`
    const output = result.stdout || result.stderr
    const status = stateNormalizeUnitStatus(output, result.exitCode ?? 1)
    return { name, active: status === 'active', status }
  } catch {
    return { name, active: false, status: 'unavailable' }
  }
}

/** Collects source-driver status rows for the status screen. */
export async function stateCollectSources(cfg: Config, paths: Paths): Promise<SourceStatus[]> {
  return sourcesCollectStatuses(cfg, paths)
}

/** Collects app status rows, returning a typed error if app state is unreadable. */
export async function stateCollectApps(
  cfg: Config,
  paths: Paths,
): Promise<AppStatus[] | InternalError> {
  const store = stateCreateStore(paths.stateDir)
  const results: AppStatus[] = []
  for (const [name, app] of Object.entries(cfg.apps)) {
    const state = await stateLoad(store, name)
    if (state instanceof Error) {
      return state
    }
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
  try {
    const res = await $`docker compose -p jib-${app} ps --format json`
    if (res.exitCode !== 0) {
      return []
    }
    const stdout = res.stdout.trim()
    if (!stdout) {
      return []
    }
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
