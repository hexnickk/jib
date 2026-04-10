import { loadConfig } from '@jib/config'
import { getPaths, pathExists } from '@jib/core'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { appsUsingProvider, getProvider } from '../../config-edit.ts'
import { deployKeyPaths, keyFingerprint } from '../../keygen.ts'

export default defineCommand({
  meta: { name: 'status', description: 'Show deploy key fingerprint + usage' },
  args: { name: { type: 'positional', required: true } },
  async run({ args }) {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)
    const p = getProvider(cfg, args.name)
    if (!p || p.type !== 'key') return consola.error(`provider "${args.name}" is not a deploy key`)
    const { publicKey } = deployKeyPaths(paths, args.name)
    if (await pathExists(publicKey)) consola.log(`  key: ${await keyFingerprint(publicKey)}`)
    else consola.warn('  key: file missing')
    const apps = appsUsingProvider(cfg, args.name)
    consola.log(`  used by: ${apps.length === 0 ? '(none)' : apps.join(', ')}`)
  },
})
