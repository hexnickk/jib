import type { Config } from '@jib/config'
import { dockerCollectContainerStatus, type DockerContainerStatus } from '@jib/docker'
import { InternalError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { type SourceStatus, sourcesCollectStatuses } from '@jib/sources'
import { $ } from '@/libs/shell'
import { stateLoad } from './store.ts'

export interface ServiceStatus {
  name: string
  active: boolean
  status: string
}

export type ContainerStatus = DockerContainerStatus

export interface AppStatus {
  name: string
  sha: string
  lastDeploy: string
  lastDeployStatus: string
  containers: ContainerStatus[]
  containerError?: string
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
  const results: AppStatus[] = []
  for (const [name, app] of Object.entries(cfg.apps)) {
    const state = await stateLoad(paths.stateDir, name)
    if (state instanceof Error) {
      return state
    }
    const containers = await dockerCollectContainerStatus(name)
    results.push({
      name,
      sha: state.deployed_sha,
      lastDeploy: state.last_deploy,
      lastDeployStatus: state.last_deploy_status,
      containers: containers instanceof Error ? [] : containers,
      ...(containers instanceof Error ? { containerError: containers.message } : {}),
      domains: app.domains.map((domain) => ({ host: domain.host, port: domain.port })),
    })
  }
  return results
}
