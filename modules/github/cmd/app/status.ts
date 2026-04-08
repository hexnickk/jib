import { loadConfig } from '@jib/config'
import { getPaths, pathExists } from '@jib/core'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { appPemPath } from '../../auth.ts'
import { appsUsingProvider, getProvider } from '../../config-edit.ts'

export default defineCommand({
  meta: { name: 'status', description: 'Show GitHub App provider status' },
  args: { name: { type: 'positional', required: true } },
  async run({ args }) {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)
    const p = getProvider(cfg, args.name)
    if (!p || p.type !== 'app') return consola.error(`provider "${args.name}" is not a GitHub App`)
    consola.log(`  app id: ${p.app_id}`)
    const pem = appPemPath(paths, args.name)
    consola.log(`  pem: ${(await pathExists(pem)) ? pem : 'missing!'}`)
    const apps = appsUsingProvider(cfg, args.name)
    consola.log(`  used by: ${apps.length === 0 ? '(none)' : apps.join(', ')}`)
  },
})
