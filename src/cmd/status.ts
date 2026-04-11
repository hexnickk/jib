import { isTextOutput } from '@jib/cli'
import { loadAppConfig } from '@jib/config'
import {
  type AppStatus,
  type ServiceStatus,
  type SourceStatus,
  collectApps,
  collectServices,
  collectSources,
} from '@jib/state'
import { defineCommand } from 'citty'

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

function printLine(line = ''): void {
  process.stdout.write(`${line}\n`)
}

function printServices(services: ServiceStatus[]): void {
  printLine('services')
  for (const s of services) {
    const icon = s.active ? '●' : '○'
    printLine(`  ${icon} ${s.name.padEnd(18)} ${s.status}`)
  }
}

function printSources(sources: SourceStatus[]): void {
  if (sources.length === 0) {
    printLine()
    printLine('sources  (none)')
    return
  }
  printLine()
  printLine('sources')
  for (const source of sources) {
    const warn = source.hasCredential ? '' : '  ⚠ credential missing'
    printLine(`  ${source.name.padEnd(18)} ${source.detail}${warn}`)
  }
}

function printApps(apps: AppStatus[]): void {
  if (apps.length === 0) {
    printLine()
    printLine('apps  (none)')
    return
  }
  printLine()
  printLine('apps')
  for (const app of apps) {
    const running = app.containers.some((c) => c.state === 'running')
    const icon = running ? '●' : '○'
    const sha = app.sha ? app.sha.slice(0, 7) : 'never deployed'
    const ago = timeAgo(app.lastDeploy)
    const deployState = app.lastDeployStatus || 'unknown'
    const deployInfo = app.lastDeploy ? `${deployState}  ${sha}  ${ago}` : `${deployState}  ${sha}`
    printLine(`  ${icon} ${app.name.padEnd(18)} ${deployInfo}`)
    for (const c of app.containers) {
      printLine(`    ${c.service.padEnd(16)} ${c.state}  ${c.status}`)
    }
    if (app.domains.length > 0) {
      for (const d of app.domains) printLine(`    ingress ${d.host} → :${d.port ?? '?'}`)
    }
  }
}

export default defineCommand({
  meta: { name: 'status', description: 'Show server status: services, sources, apps' },
  async run() {
    const { cfg, paths } = await loadAppConfig()
    const hasCloudflared = cfg.modules?.cloudflared === true

    const [services, sources, apps] = await Promise.all([
      collectServices(hasCloudflared),
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
