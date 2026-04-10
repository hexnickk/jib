import { rm } from 'node:fs/promises'
import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/core'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { appsUsingSource, getGitHubSource, removeGitHubSource } from '../../config-edit.ts'
import { deployKeyPaths } from '../../keygen.ts'

export default defineCommand({
  meta: { name: 'remove', description: 'Remove a deploy key source' },
  args: { name: { type: 'positional', required: true } },
  async run({ args }) {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)
    const source = getGitHubSource(cfg, args.name)
    if (!source || source.type !== 'key')
      return consola.error(`source "${args.name}" is not a deploy key`)
    const apps = appsUsingSource(cfg, args.name)
    if (apps.length > 0) return consola.error(`cannot remove: used by ${apps.join(', ')}`)
    const { privateKey, publicKey } = deployKeyPaths(paths, args.name)
    await rm(privateKey, { force: true })
    await rm(publicKey, { force: true })
    await removeGitHubSource(paths.configFile, args.name)
    consola.success(`removed "${args.name}"`)
  },
})
