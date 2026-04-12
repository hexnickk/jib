import { cliIsTextOutput } from '@jib/cli'
import { configLoadContext } from '@jib/config'
import {
  type AppStatus,
  type ServiceStatus,
  type SourceStatus,
  collectApps,
  collectServices,
  collectSources,
} from '@jib/state'
import type { CliCommand } from './command.ts'

/** Renders a human-readable relative time for the status screen. */
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

/** Writes a single line to stdout for the text status view. */
function printLine(line = ''): void {
  process.stdout.write(`${line}\n`)
}

/** Prints the systemd-level services section in text mode. */
function printServices(services: ServiceStatus[]): void {
  printLine('services')
  for (const service of services) {
    const icon = service.active ? '●' : '○'
    printLine(`  ${icon} ${service.name.padEnd(18)} ${service.status}`)
  }
}

/** Prints the configured sources section in text mode. */
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

/** Prints the app deployment overview in text mode. */
function printApps(apps: AppStatus[]): void {
  if (apps.length === 0) {
    printLine()
    printLine('apps  (none)')
    return
  }
  printLine()
  printLine('apps')
  apps.forEach((app, index) => {
    if (index > 0) printLine()
    const sha = app.sha ? app.sha.slice(0, 7) : 'never deployed'
    const ago = timeAgo(app.lastDeploy)
    const deployState = app.lastDeployStatus || 'unknown'
    const deployInfo = app.lastDeploy ? `${deployState}  ${sha}  ${ago}` : `${deployState}  ${sha}`
    printLine(`  ${app.name}`)
    printLine(`    deploy:   ${deployInfo}`)
    for (const container of app.containers) {
      printLine(
        `    service:  ${container.service.padEnd(16)} ${container.state}  ${container.status}`,
      )
    }
    if (app.domains.length > 0) {
      for (const domain of app.domains)
        printLine(`    ingress:  ${domain.host} -> :${domain.port ?? '?'}`)
    }
  })
}

const cliStatusCommand = {
  command: 'status',
  describe: 'Show server status: services, sources, apps',
  async run() {
    const loaded = await configLoadContext()
    if (loaded instanceof Error) return loaded
    const { cfg, paths } = loaded
    const hasCloudflared = cfg.modules?.cloudflared === true
    const [services, sources, apps] = await Promise.all([
      collectServices(hasCloudflared),
      collectSources(cfg, paths),
      collectApps(cfg, paths),
    ])

    if (cliIsTextOutput()) {
      printServices(services)
      printSources(sources)
      printApps(apps)
      return
    }

    return { services, sources, apps }
  },
} satisfies CliCommand

export default cliStatusCommand
