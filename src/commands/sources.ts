import { setup as setupGitHubSource } from '@jib-module/github'
import { loadConfig } from '@jib/config'
import { type ModuleContext, createLogger, getPaths } from '@jib/core'
import { defineCommand } from 'citty'

const setupCmd = defineCommand({
  meta: { name: 'setup', description: 'Set up a git source provider' },
  async run() {
    const paths = getPaths()
    const config = await loadConfig(paths.configFile)
    const ctx: ModuleContext<typeof config> = {
      config,
      logger: createLogger('sources'),
      paths,
    }
    await setupGitHubSource(ctx)
    return { ok: true }
  },
})

export default defineCommand({
  meta: { name: 'sources', description: 'Manage git source providers' },
  subCommands: { setup: setupCmd },
})
