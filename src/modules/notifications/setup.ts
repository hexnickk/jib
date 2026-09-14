import { readFile } from 'node:fs/promises'
import { cliCanPrompt, cliCreateMissingInputError } from '@jib/cli'
import { configLoad, configWrite, type NotificationsConfig } from '@jib/config'
import { InternalError, ValidationError } from '@jib/errors'
import {
  tuiLog,
  tuiNote,
  tuiPromptConfirmResult,
  tuiPromptPasswordResult,
  tuiPromptStringResult,
} from '@jib/tui'
import { notificationsConfigure } from './service.ts'
import {
  type NotificationsContext,
  notificationsReadToken,
  notificationsWithLock,
} from './storage.ts'

export interface NotificationsSetupArgs {
  chatId?: string
  at?: string
  timezone?: string
  botTokenFile?: string
}

export async function notificationsRunSetup(
  ctx: NotificationsContext,
  args: NotificationsSetupArgs,
) {
  const cfg = await configLoad(ctx.paths.configFile)
  if (cfg instanceof Error) {
    return cfg
  }
  const existing = cfg.notifications || {
    chatId: '',
    dailyAt: '09:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
  const stored = await notificationsReadToken(ctx)
  if (stored instanceof Error) {
    return stored
  }
  const canPrompt = cliCanPrompt()
  if (!canPrompt) {
    const missing = [
      ...(!(args.chatId ?? existing.chatId)
        ? [{ field: '--chat-id', message: 'provide a Telegram channel or chat ID' }]
        : []),
      ...(!args.botTokenFile && !stored
        ? [{ field: '--bot-token-file', message: 'provide a file containing the bot token' }]
        : []),
    ]
    if (missing.length > 0) {
      return cliCreateMissingInputError('missing notification settings', missing)
    }
  }
  tuiNote(
    'Daily machine, services, and apps status.\nSuccessful and failed deployments.\nSetup sends a test message to verify delivery.',
    'Send Jib notifications to Telegram',
  )
  let token: string | undefined
  if (args.botTokenFile) {
    try {
      token = (await readFile(args.botTokenFile, 'utf8')).trim()
      if (!token) {
        return new ValidationError('--bot-token-file is empty')
      }
    } catch (error) {
      return new InternalError('cannot read --bot-token-file', { cause: error })
    }
  } else if (canPrompt) {
    const value = await tuiPromptPasswordResult({
      message: `Bot token from @BotFather${stored ? ' (blank to keep existing)' : ''}`,
    })
    if (value instanceof Error) {
      return value
    }
    token = value.trim() || undefined
  }
  const input: NotificationsConfig = {
    chatId: args.chatId ?? existing.chatId,
    dailyAt: args.at ?? existing.dailyAt,
    timezone: args.timezone ?? existing.timezone,
  }
  if (canPrompt) {
    for (const [key, supplied, message] of [
      ['chatId', args.chatId, 'Telegram chat ID (add the bot with permission to post)'],
      ['dailyAt', args.at, 'Daily status time (HH:mm)'],
      ['timezone', args.timezone, 'Timezone (IANA name)'],
    ] as const) {
      if (supplied !== undefined) {
        continue
      }
      const value = await tuiPromptStringResult({ message, initialValue: input[key] })
      if (value instanceof Error) {
        return value
      }
      input[key] = value.trim()
    }
    const save = await tuiPromptConfirmResult({
      message: `Send a test and save notifications for ${input.chatId}? Daily status: ${input.dailyAt} ${input.timezone}`,
      initialValue: true,
    })
    if (save instanceof Error || !save) {
      return save instanceof Error ? save : undefined
    }
  }
  const result = await notificationsConfigure(ctx, {
    ...input,
    ...(token ? { botToken: token } : {}),
  })
  if (result instanceof Error) {
    return result
  }
  tuiLog.success(
    `Notifications on · Telegram ${result.chatId} · daily at ${result.dailyAt} ${result.timezone}, plus deployment outcomes`,
  )
  return undefined
}

export async function notificationsOfferSetup(ctx: NotificationsContext) {
  const cfg = await configLoad(ctx.paths.configFile)
  if (cfg instanceof Error || cfg.notifications !== undefined) {
    return cfg instanceof Error ? cfg : undefined
  }
  const configure = await tuiPromptConfirmResult({
    message: 'Send daily server status and deployment notifications via Telegram?',
    initialValue: false,
  })
  if (configure instanceof Error) {
    return configure
  }
  if (configure) {
    return notificationsRunSetup(ctx, {})
  }
  return notificationsWithLock(ctx, async () => {
    const current = await configLoad(ctx.paths.configFile)
    if (current instanceof Error) {
      return current
    }
    current.notifications ??= false
    return configWrite(ctx.paths.configFile, current)
  })
}
