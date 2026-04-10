import { handleShell, parseExecArgs } from '@jib/docker'
import { defineCommand } from 'citty'
import { consola } from 'consola'

export default defineCommand({
  meta: { name: 'exec', description: 'Execute command in a running container' },
  args: {
    app: { type: 'positional', required: true, description: 'App name' },
    service: {
      type: 'positional',
      required: false,
      description: 'Compose service (auto-detected for single-service apps)',
    },
  },
  async run({ rawArgs }) {
    try {
      await handleShell(parseExecArgs(rawArgs), 'exec')
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      consola.info('ensure app is running: jib up <app>')
      process.exit(1)
    }
  },
})
