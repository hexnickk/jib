import { cliCheckLinuxHost, cliCheckRootHost } from '@jib/cli'
import { pathsGetPaths } from '@jib/paths'
import type { CommandModule } from 'yargs'
import { notificationsDeliver } from '@/flows/notifications/deliver.ts'
import { notificationsRemove, notificationsStatus } from '@/modules/notifications/service.ts'
import {
  notificationsRunSetup,
  type NotificationsSetupArgs,
} from '@/modules/notifications/setup.ts'
import { cmdCreateHandler } from './handler.ts'

const notificationsCommand = {
  command: 'notifications',
  describe: 'Daily server status and deployment notifications via Telegram',
  builder: (parser) =>
    parser
      .command({
        command: 'setup',
        describe: 'Configure Telegram notifications and verify delivery with a test message',
        builder: {
          'chat-id': { type: 'string', description: 'Numeric Telegram chat ID or @public_channel' },
          'bot-token-file': { type: 'string', description: 'Import a bot token from this file' },
          at: { type: 'string', description: 'Daily status time, HH:mm (default: 09:00)' },
          timezone: { type: 'string', description: 'IANA timezone (default: server timezone)' },
        },
        handler: cmdCreateHandler<NotificationsSetupArgs>((args) =>
          notificationsRunCommand('setup', args),
        ),
      })
      .command({
        command: 'status',
        describe: 'Show notification settings and daily timer status',
        handler: cmdCreateHandler(() => notificationsRunCommand('status')),
      })
      .command({
        command: 'test',
        describe: 'Send a test notification',
        handler: cmdCreateHandler(() => notificationsRunCommand('test')),
      })
      .command({
        command: 'remove',
        describe: 'Turn notifications off and delete settings, credentials, and timer',
        handler: cmdCreateHandler(() => notificationsRunCommand('remove')),
      })
      .command({
        command: 'deliver',
        describe: false,
        handler: cmdCreateHandler(() => notificationsRunCommand('deliver')),
      })
      .demandCommand(1),
  handler: () => undefined,
} satisfies CommandModule

async function notificationsRunCommand(
  action: 'setup' | 'status' | 'test' | 'remove' | 'deliver',
  args: NotificationsSetupArgs = {},
) {
  const hostError = cliCheckLinuxHost(`notifications ${action}`)
  if (hostError) {
    return hostError
  }
  if (action === 'setup' || action === 'remove') {
    const rootError = cliCheckRootHost(`notifications ${action}`)
    if (rootError) {
      return rootError
    }
  }
  const ctx = { paths: pathsGetPaths() }
  switch (action) {
    case 'setup':
      return notificationsRunSetup(ctx, args)
    case 'deliver':
      return notificationsDeliver(ctx, { kind: 'daily' })
    case 'status': {
      const status = await notificationsStatus(ctx)
      if (status instanceof Error) {
        return status
      }
      process.stdout.write(`${status}\n`)
      return undefined
    }
    default: {
      const error =
        action === 'test'
          ? await notificationsDeliver(ctx, { kind: 'test' })
          : await notificationsRemove(ctx)
      if (error) {
        return error
      }
      process.stdout.write(
        action === 'test'
          ? 'Test notification sent.\n'
          : 'Notifications off. Settings, credentials, and timer removed; previous Telegram messages retained.\n',
      )
      return undefined
    }
  }
}

export default notificationsCommand
