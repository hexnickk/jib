import { handleShell, parseRunArgs } from '@jib/docker'
import { defineCommand } from 'citty'
import { consola } from 'consola'

export default defineCommand({
  meta: { name: 'run', description: 'Run a one-off command in a new container' },
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
      await handleShell(parseRunArgs(rawArgs), 'run')
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  },
})
