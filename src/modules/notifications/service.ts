import { rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { NotificationsSchema, type NotificationsConfig, configLoad, configWrite } from '@jib/config'
import { InternalError, ValidationError, type JibError } from '@jib/errors'
import { notificationsReadSchedule, notificationsSyncSchedule } from './schedule.ts'
import {
  type NotificationsContext,
  notificationsReadToken,
  notificationsWithLock,
  notificationsWriteToken,
} from './storage.ts'
import { telegramSend } from './telegram.ts'

/** A successful setup verifies delivery, installs the schedule, then publishes configuration. */
export async function notificationsConfigure(
  ctx: NotificationsContext,
  input: NotificationsConfig & { botToken?: string },
) {
  const parsed = NotificationsSchema.safeParse(input)
  if (!parsed.success) {
    return new ValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
    )
  }
  return notificationsWithLock(ctx, async () => {
    const previous = await configLoad(ctx.paths.configFile)
    if (previous instanceof Error) {
      return previous
    }
    const oldToken = await notificationsReadToken(ctx)
    if (oldToken instanceof Error) {
      return oldToken
    }
    const token = input.botToken?.trim() || oldToken
    if (!token) {
      return new ValidationError('provide a bot token interactively or with --bot-token-file')
    }
    const test = await telegramSend(
      { token },
      parsed.data.chatId,
      `Jib · ${hostname()}\nNotification setup: Telegram delivery works.`,
    )
    if (test) {
      return test
    }
    // Workers also take this lock, so an installed timer cannot send before config is saved.
    let failure: JibError | undefined = await notificationsSyncSchedule(ctx, parsed.data)
    if (!failure) {
      failure = await notificationsWriteToken(ctx, token)
    }
    if (!failure) {
      const current = await configLoad(ctx.paths.configFile)
      if (current instanceof Error) {
        failure = current
      } else {
        current.notifications = parsed.data
        failure = await configWrite(ctx.paths.configFile, current)
      }
    }
    if (failure) {
      const secret = await notificationsWriteToken(ctx, oldToken)
      const schedule = await notificationsSyncSchedule(ctx, previous.notifications || undefined)
      return new InternalError(
        `${failure.message}; ${secret || schedule ? 'restoring previous settings failed; rerun setup or remove' : 'previous settings retained'}`,
        { cause: failure },
      )
    }
    return parsed.data
  })
}

export async function notificationsRemove(ctx: NotificationsContext) {
  return notificationsWithLock(ctx, async () => {
    const cfg = await configLoad(ctx.paths.configFile)
    if (cfg instanceof Error) {
      return cfg
    }
    cfg.notifications = false
    const saved = await configWrite(ctx.paths.configFile, cfg)
    if (saved) {
      return saved
    }
    // Stop delivery first; cleanup is retryable even when configuration is already absent.
    const stopped = await notificationsSyncSchedule(ctx, undefined)
    if (stopped) {
      return stopped
    }
    const secret = await notificationsWriteToken(ctx, undefined)
    if (secret) {
      return secret
    }
    await rm(join(ctx.paths.stateDir, 'notifications-date'), { force: true })
    return undefined
  })
}

export async function notificationsStatus(ctx: NotificationsContext) {
  const cfg = await configLoad(ctx.paths.configFile)
  if (cfg instanceof Error) {
    return cfg
  }
  if (!cfg.notifications) {
    return 'notifications: off · configure with sudo jib notifications setup'
  }
  const { chatId, dailyAt, timezone } = cfg.notifications
  const token = await notificationsReadToken(ctx)
  return `notifications: on · Telegram ${chatId}\n  Daily server status: ${dailyAt} ${timezone}\n  Deployments: success and failure\n  Timer: ${await notificationsReadSchedule()}${token instanceof Error || !token ? '\n  ⚠ Bot token unavailable; rerun setup' : ''}`
}
