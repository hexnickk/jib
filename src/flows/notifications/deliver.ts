import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { configLoad } from '@jib/config'
import { JibError, ValidationError } from '@jib/errors'
import { loggingCreateLogger } from '@jib/logging'
import { statusCreateDailyReport } from '@/flows/status/report.ts'
import {
  type NotificationsContext,
  notificationsReadToken,
  notificationsWithLock,
  notificationsWriteFile,
} from '@/modules/notifications/storage.ts'
import { telegramSend } from '@/modules/notifications/telegram.ts'

type Notification = { kind: 'test' } | { kind: 'deployment'; text: string } | { kind: 'daily' }

export async function notificationsDeliver(ctx: NotificationsContext, input: Notification) {
  return notificationsWithLock(ctx, async () => {
    const cfg = await configLoad(ctx.paths.configFile)
    if (cfg instanceof Error) {
      return cfg
    }
    const settings = cfg.notifications
    if (!settings) {
      return input.kind === 'test'
        ? new ValidationError('notifications are off; run sudo jib notifications setup')
        : undefined
    }
    const token = await notificationsReadToken(ctx)
    if (token instanceof Error) {
      return token
    }
    if (!token) {
      return new ValidationError('bot token is missing; rerun notification setup')
    }
    if (input.kind === 'daily') {
      const path = join(ctx.paths.stateDir, 'notifications-date')
      const previous = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return undefined
        }
        return Promise.reject(error)
      })
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: settings.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())
      if (previous === date) {
        return undefined
      }
      // Claim before I/O: neither a crash nor a repeated DST hour should replay the report.
      const claimed = await notificationsWriteFile(path, date)
      if (claimed) {
        return claimed
      }
    }
    const text =
      input.kind === 'daily'
        ? await statusCreateDailyReport(ctx, settings.timezone)
        : input.kind === 'test'
          ? `Jib · ${hostname()}\nTest notification`
          : input.text
    return text instanceof Error ? text : telegramSend({ token }, settings.chatId, text)
  })
}

interface DeploymentNotification {
  app: string
  revision: string
  ref?: string
  trigger: 'manual' | 'auto'
  success: boolean
  stage: string
  durationMs: number
}

/** Only metadata leaves the host, never raw errors or build logs. Delivery cannot fail a deploy. */
export async function notificationsNotifyDeployment(
  ctx: NotificationsContext,
  input: DeploymentNotification,
) {
  const log = loggingCreateLogger('notifications')
  try {
    const text = [
      `${input.success ? '✓' : '⚠'} Jib · ${hostname()} · deployment ${input.success ? 'succeeded' : 'failed'}`,
      `App: ${input.app}`,
      ...(input.ref ? [`Ref: ${input.ref}`] : []),
      `Revision: ${/^[a-f\d]{40,64}$/i.test(input.revision) ? input.revision.slice(0, 8) : input.revision || 'unknown'}`,
      `Duration: ${Math.round(input.durationMs / 1000)}s · ${input.trigger === 'auto' ? 'automatic update' : 'manual deploy'}`,
      ...(!input.success ? [`Stage: ${input.stage} · check deployment logs on the server`] : []),
    ].join('\n')
    const error = await notificationsDeliver(ctx, { kind: 'deployment', text })
    if (error) {
      log.warn(`notification failed: ${error.message}`)
    }
  } catch (error) {
    log.warn(
      `notification failed: ${error instanceof JibError ? error.message : 'unexpected delivery error'}`,
    )
  }
}
