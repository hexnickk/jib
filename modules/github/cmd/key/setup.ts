import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/core'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { addKeyProvider, providerNameAvailable } from '../../config-edit.ts'
import { generateDeployKey } from '../../keygen.ts'

export default defineCommand({
  meta: { name: 'setup', description: 'Generate an SSH deploy key provider' },
  args: { name: { type: 'positional', required: true } },
  async run({ args }) {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)
    providerNameAvailable(cfg, args.name)
    consola.info('generating ed25519 deploy key...')
    const pub = await generateDeployKey(args.name, paths)
    consola.log('\n=== Deploy Key (public) ===')
    consola.log(pub)
    consola.log('\nAdd it to your repo at https://github.com/<org>/<repo>/settings/keys')
    await addKeyProvider(paths.configFile, args.name)
    consola.success(`provider "${args.name}" (deploy key) created`)
  },
})
