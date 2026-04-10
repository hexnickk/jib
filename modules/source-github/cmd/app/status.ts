import { loadConfig } from '@jib/config'
import { getPaths, pathExists } from '@jib/core'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { appPemPath } from '../../auth.ts'
import { appsUsingSource, getGitHubSource } from '../../config-edit.ts'

export default defineCommand({
  meta: { name: 'status', description: 'Show GitHub App source status' },
  args: { name: { type: 'positional', required: true } },
  async run({ args }) {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)
    const source = getGitHubSource(cfg, args.name)
    if (!source || source.type !== 'app')
      return consola.error(`source "${args.name}" is not a GitHub App`)
    consola.log(`  app id: ${source.app_id}`)
    const pem = appPemPath(paths, args.name)
    consola.log(`  pem: ${(await pathExists(pem)) ? pem : 'missing!'}`)
    const apps = appsUsingSource(cfg, args.name)
    consola.log(`  used by: ${apps.length === 0 ? '(none)' : apps.join(', ')}`)
  },
})
