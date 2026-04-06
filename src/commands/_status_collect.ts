import { existsSync, readFileSync } from 'node:fs'
import type { Config } from '@jib/config'
import { type Paths, credsPath, pathExists } from '@jib/core'
import { Store } from '@jib/state'
import { $ } from 'bun'

export interface ServiceStatus {
  name: string
  active: boolean
  status: string
}

export interface ProviderStatus {
  name: string
  type: 'key' | 'app'
  appId?: number
  hasCredential: boolean
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
  domains: { host: string; port?: number }[]
}

const JIB_SERVICES = ['jib-bus', 'jib-deployer', 'jib-gitsitter', 'nginx']

export async function collectServices(hasTunnel: boolean): Promise<ServiceStatus[]> {
  const names = hasTunnel ? [...JIB_SERVICES, 'jib-cloudflared'] : JIB_SERVICES
  return Promise.all(names.map(checkUnit))
}

async function checkUnit(name: string): Promise<ServiceStatus> {
  const res = await $`systemctl is-active ${name}`.quiet().nothrow()
  const status = res.stdout.toString().trim() || 'unknown'
  return { name, active: status === 'active', status }
}

export async function collectProviders(cfg: Config, paths: Paths): Promise<ProviderStatus[]> {
  const providers = cfg.github?.providers ?? {}
  const results: ProviderStatus[] = []
  for (const [name, p] of Object.entries(providers)) {
    const credPath =
      p.type === 'app'
        ? credsPath(paths, 'github-app', `${name}.pem`)
        : credsPath(paths, 'github-key', name)
    results.push({
      name,
      type: p.type,
      appId: p.type === 'app' ? p.app_id : undefined,
      hasCredential: await pathExists(credPath),
    })
  }
  return results
}

export async function collectApps(cfg: Config, paths: Paths): Promise<AppStatus[]> {
  const store = new Store(paths.stateDir)
  const results: AppStatus[] = []
  for (const [name, app] of Object.entries(cfg.apps)) {
    const state = await store.load(name)
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
  // docker compose ps --format json outputs one JSON object per line
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

export function hasTunnelToken(paths: Paths): boolean {
  const tokenPath = credsPath(paths, 'cloudflare', 'tunnel.env')
  return existsSync(tokenPath) && readFileSync(tokenPath, 'utf8').trim().length > 0
}
