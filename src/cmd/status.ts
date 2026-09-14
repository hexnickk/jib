import { pathsGetPaths } from '@jib/paths'
import type { AppStatus, ServiceStatus, SourceStatus } from '@jib/state'
import type { CommandModule } from 'yargs'
import { statusCollectSnapshot } from '@/flows/status/report.ts'
import { machineFormatStatus, machineWarnings } from '@/modules/machine/status.ts'
import { notificationsStatus } from '@/modules/notifications/service.ts'
import { cmdCreateHandler } from './handler.ts'

/** Renders a human-readable relative time for the status screen. */
function timeAgo(iso: string): string {
  if (!iso) {
    return ''
  }
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) {
    return 'just now'
  }
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) {
    return `${mins}m ago`
  }
  const hours = Math.floor(mins / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
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
    if (index > 0) {
      printLine()
    }
    const sha = app.sha ? app.sha.slice(0, 7) : 'never deployed'
    const ago = timeAgo(app.lastDeploy)
    const deployState = app.lastDeployStatus || 'unknown'
    const deployInfo = app.lastDeploy ? `${deployState}  ${sha}  ${ago}` : `${deployState}  ${sha}`
    printLine(`  ${app.name}`)
    printLine(`    deploy:   ${deployInfo}`)
    if (app.containerError) {
      printLine(`    containers: unknown (${app.containerError})`)
    } else if (app.containers.length === 0) {
      printLine('    containers: none')
    }
    for (const container of app.containers) {
      printLine(
        `    service:  ${container.service.padEnd(16)} ${container.state}  ${container.status}`,
      )
    }
    if (app.domains.length > 0) {
      for (const domain of app.domains) {
        printLine(`    ingress:  ${domain.host} -> :${domain.port ?? '?'}`)
      }
    }
  })
}

const cliStatusCommand = {
  command: 'status',
  describe: 'Show machine resources, services, sources, apps, and notifications',
  handler: cmdCreateHandler(statusRunCommand),
} satisfies CommandModule

/** Collects status data and writes the text status view. */
async function statusRunCommand() {
  const ctx = { paths: pathsGetPaths() }
  const [snapshot, notifications] = await Promise.all([
    statusCollectSnapshot(ctx),
    notificationsStatus(ctx),
  ])
  if (snapshot instanceof Error) {
    return snapshot
  }
  const { machine, services, sources, apps } = snapshot
  for (const warning of machineWarnings(machine)) {
    printLine(`⚠ ${warning}`)
  }
  printLine(`machine · ${machine.hostname}`)
  machineFormatStatus(machine).forEach((line) => printLine(`  ${line}`))
  printLine()
  printServices(services)
  printSources(sources)
  if (!(apps instanceof Error)) {
    printApps(apps)
  }
  printLine()
  if (!(notifications instanceof Error)) {
    printLine(notifications)
  }
  return apps instanceof Error ? apps : notifications instanceof Error ? notifications : undefined
}

export default cliStatusCommand
