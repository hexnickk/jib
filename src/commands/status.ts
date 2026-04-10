import { loadAppConfig } from '@jib/config'
import { isTextOutput } from '@jib/core'
import {
  type AppStatus,
  type ServiceStatus,
  type SourceStatus,
  collectApps,
  collectServices,
  collectSources,
  hasTunnelToken,
} from '@jib/state'
import { defineCommand } from 'citty'
import { consola } from 'consola'

function timeAgo(iso: string): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function printServices(services: ServiceStatus[]): void {
  consola.log('services')
  for (const s of services) {
    const icon = s.active ? '●' : '○'
    consola.log(`  ${icon} ${s.name.padEnd(18)} ${s.status}`)
  }
}

function printSources(sources: SourceStatus[]): void {
  if (sources.length === 0) {
    consola.log('\nsources  (none)')
    return
  }
  consola.log('\nsources')
  for (const source of sources) {
    const detail =
      source.type === 'app'
        ? `${source.driver} app (id ${source.appId})`
        : `${source.driver} deploy-key`
    const warn = source.hasCredential ? '' : '  ⚠ credential missing'
    consola.log(`  ${source.name.padEnd(18)} ${detail}${warn}`)
  }
}

function printApps(apps: AppStatus[]): void {
  if (apps.length === 0) {
    consola.log('\napps  (none)')
    return
  }
  consola.log('\napps')
  for (const app of apps) {
    const running = app.containers.some((c) => c.state === 'running')
    const icon = running ? '●' : '○'
    const sha = app.sha ? app.sha.slice(0, 7) : 'never deployed'
    const ago = timeAgo(app.lastDeploy)
    const deployState = app.lastDeployStatus || 'unknown'
    const deployInfo = app.lastDeploy ? `${deployState}  ${sha}  ${ago}` : `${deployState}  ${sha}`
    consola.log(`  ${icon} ${app.name.padEnd(18)} ${deployInfo}`)
    for (const c of app.containers) {
      consola.log(`    ${c.service.padEnd(16)} ${c.state}  ${c.status}`)
    }
    if (app.domains.length > 0) {
      for (const d of app.domains) consola.log(`    ingress ${d.host} → :${d.port ?? '?'}`)
    }
  }
}

export default defineCommand({
  meta: { name: 'status', description: 'Show server status: services, sources, apps' },
  async run() {
    const { cfg, paths } = await loadAppConfig()
    const tunnel = hasTunnelToken(paths)

    const [services, sources, apps] = await Promise.all([
      collectServices(tunnel),
      collectSources(cfg, paths),
      collectApps(cfg, paths),
    ])

    if (isTextOutput()) {
      printServices(services)
      printSources(sources)
      printApps(apps)
      return
    }

    return { services, sources, apps }
  },
})
