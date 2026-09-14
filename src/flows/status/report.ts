import { configLoad } from '@jib/config'
import type { Paths } from '@jib/paths'
import { stateCollectApps, stateCollectServices, stateCollectSources } from '@jib/state'
import {
  machineCollectStatus,
  machineFormatStatus,
  machineWarnings,
} from '@/modules/machine/status.ts'

/** Collects one host/services/apps snapshot, shared by local status and daily delivery. */
export async function statusCollectSnapshot(ctx: { paths: Paths }) {
  const cfg = await configLoad(ctx.paths.configFile)
  if (cfg instanceof Error) {
    return cfg
  }
  const [machine, services, sources, apps] = await Promise.all([
    machineCollectStatus(ctx),
    stateCollectServices(cfg.modules.cloudflared === true),
    stateCollectSources(cfg, ctx.paths),
    stateCollectApps(cfg, ctx.paths),
  ])
  return { machine, services, sources, apps }
}

/** Produces a concise, plain-text report without claiming running containers are healthy. */
export async function statusCreateDailyReport(ctx: { paths: Paths }, timezone: string) {
  const snapshot = await statusCollectSnapshot(ctx)
  if (snapshot instanceof Error) {
    return snapshot
  }
  const { machine, services, sources, apps } = snapshot
  const lines = [
    `Jib · ${machine.hostname}`,
    `Daily status · ${new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date())} ${timezone}`,
    '',
    ...machineWarnings(machine).map((warning) => `⚠ ${warning}`),
    '',
    'Machine',
    ...machineFormatStatus(machine),
    '',
    'Jib services',
    ...services.map(
      (service) => `${service.active ? '✓' : '⚠'} ${service.name} — ${service.status}`,
    ),
    '',
    'Sources',
    ...sources.map(
      (source) =>
        `${source.hasCredential ? '✓' : '⚠'} ${source.name} — credentials ${source.hasCredential ? 'present' : 'missing'}`,
    ),
    ...(sources.length === 0 ? ['(none)'] : []),
    '',
    'Apps',
  ]
  if (apps instanceof Error) {
    lines.push('⚠ App status unavailable; run jib status on the server')
  } else {
    for (const app of apps) {
      const running =
        !app.containerError &&
        app.containers.length > 0 &&
        app.containers.every(
          (container) =>
            container.state === 'running' && !/unhealthy|health: starting/i.test(container.status),
        )
      const state = app.containerError
        ? 'unknown'
        : app.containers.length === 0
          ? 'no containers'
          : app.containers
              .map((container) => `${container.service}: ${container.state} (${container.status})`)
              .join(', ')
      lines.push(`${running ? '✓' : '⚠'} ${app.name} — ${state}`)
      if (app.lastDeploy) {
        lines.push(`  Last deploy: ${app.lastDeployStatus} · ${app.lastDeploy}`)
      }
    }
    if (apps.length === 0) {
      lines.push('(none)')
    }
  }
  return lines.join('\n')
}
