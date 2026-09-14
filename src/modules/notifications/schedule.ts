import { rm, writeFile } from 'node:fs/promises'
import type { NotificationsConfig } from '@jib/config'
import { InternalError } from '@jib/errors'
import { pathsPathExistsResult } from '@jib/paths'
import { $ } from '@/libs/shell'
import type { NotificationsContext } from './storage.ts'

const unit = 'jib-notifications'
const servicePath = `/etc/systemd/system/${unit}.service`
const timerPath = `/etc/systemd/system/${unit}.timer`

// systemd expands both specifiers and (in ExecStart) environment variables.
function quote(value: string, exec = false) {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('%', '%%')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
  return `"${exec ? escaped.replaceAll('$', '$$') : escaped}"`
}

export async function notificationsSyncSchedule(
  ctx: NotificationsContext,
  config: NotificationsConfig | undefined,
) {
  try {
    const hasTimer = await pathsPathExistsResult(timerPath)
    const hasService = await pathsPathExistsResult(servicePath)
    if (hasTimer instanceof Error) {
      return hasTimer
    }
    if (hasService instanceof Error) {
      return hasService
    }
    if (hasTimer) {
      const stopped = await systemctl(['disable', '--now', `${unit}.timer`])
      if (stopped) {
        return stopped
      }
    }
    if (hasService) {
      const stopped = await systemctl(['stop', `${unit}.service`])
      if (stopped) {
        return stopped
      }
    }
    if (config) {
      const exec = [
        process.execPath,
        process.argv[1] ?? '/usr/local/bin/jib',
        'notifications',
        'deliver',
        '--interactive',
        'never',
      ]
        .map((arg) => quote(arg, true))
        .join(' ')
      await writeFile(
        servicePath,
        `[Unit]\nDescription=Jib daily server status\nAfter=network-online.target docker.service\nWants=network-online.target\n\n[Service]\nType=oneshot\nGroup=jib\nEnvironment=${quote(`JIB_ROOT=${ctx.paths.root}`)}\nUMask=0007\nExecStart=${exec}\nTimeoutStartSec=120\n`,
        { mode: 0o644 },
      )
      await writeFile(
        timerPath,
        `[Unit]\nDescription=Jib daily notification schedule\n\n[Timer]\nOnCalendar=*-*-* ${config.dailyAt}:00 ${config.timezone}\nPersistent=false\nAccuracySec=1s\n\n[Install]\nWantedBy=timers.target\n`,
        { mode: 0o644 },
      )
    } else {
      const units = [
        ...(hasTimer ? [`${unit}.timer`] : []),
        ...(hasService ? [`${unit}.service`] : []),
      ]
      if (units.length > 0) {
        const reset = await systemctl(['reset-failed', ...units])
        if (reset) {
          return reset
        }
      }
      await rm(timerPath, { force: true })
      await rm(servicePath, { force: true })
    }
    const reload = await systemctl(['daemon-reload'])
    return reload ?? (config ? await systemctl(['enable', '--now', `${unit}.timer`]) : undefined)
  } catch (error) {
    return new InternalError('cannot configure the notification timer', { cause: error })
  }
}

export async function notificationsReadSchedule() {
  try {
    const result = await $({
      timeout: '5s',
    })`systemctl show ${unit}.timer --property=ActiveState --property=NextElapseUSecRealtime`
    if (result.exitCode !== 0) {
      return 'unknown'
    }
    const active = /^ActiveState=active$/m.test(result.stdout)
    const next = /^NextElapseUSecRealtime=(.+)$/m.exec(result.stdout)?.[1] ?? 'unknown'
    return active ? `active · next report: ${next}` : 'inactive'
  } catch {
    return 'unknown'
  }
}

async function systemctl(args: string[]) {
  try {
    const result = await $({ timeout: '30s' })`systemctl ${args}`
    return result.exitCode === 0
      ? undefined
      : new InternalError(
          `systemctl ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`,
        )
  } catch (error) {
    return new InternalError(`systemctl ${args.join(' ')} failed`, { cause: error })
  }
}
