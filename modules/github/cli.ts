import { readFile, rm, writeFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { loadConfig } from '@jib/config'
import { getPaths, pathExists } from '@jib/core'
import { isInteractive, promptInt, promptPEM, promptSelect } from '@jib/tui'
import { type CommandDef, defineCommand } from 'citty'
import { consola } from 'consola'
import { appPemPath } from './auth.ts'
import {
  addAppProvider,
  addKeyProvider,
  appsUsingProvider,
  getProvider,
  providerNameAvailable,
  removeProvider,
} from './config-edit.ts'
import { deployKeyPaths, generateDeployKey, keyFingerprint } from './keygen.ts'
import { runManifestFlow } from './manifest-flow.ts'

/**
 * `jib github key|app {setup,status,remove}`. Mounted under the root CLI via
 * `src/module-cli.ts` discovery. CLI-only concerns (prompts, printing) live
 * here; every disk/network op delegates to a sibling helper.
 */

const keySetup = defineCommand({
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

const keyStatus = defineCommand({
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

const keyRemove = defineCommand({
  meta: { name: 'remove', description: 'Remove a deploy key provider' },
  args: { name: { type: 'positional', required: true } },
  async run({ args }) {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)
    const p = getProvider(cfg, args.name)
    if (!p || p.type !== 'key') return consola.error(`provider "${args.name}" is not a deploy key`)
    const apps = appsUsingProvider(cfg, args.name)
    if (apps.length > 0) return consola.error(`cannot remove: used by ${apps.join(', ')}`)
    const { privateKey, publicKey } = deployKeyPaths(paths, args.name)
    await rm(privateKey, { force: true })
    await rm(publicKey, { force: true })
    await removeProvider(paths.configFile, args.name)
    consola.success(`removed "${args.name}"`)
  },
})

async function savePem(
  paths: ReturnType<typeof getPaths>,
  name: string,
  pem: string,
): Promise<void> {
  const pemPath = appPemPath(paths, name)
  await mkdir(dirname(pemPath), { recursive: true, mode: 0o750 })
  await writeFile(pemPath, pem, { mode: 0o640 })
}

const appSetup = defineCommand({
  meta: { name: 'setup', description: 'Register a GitHub App provider' },
  args: {
    name: { type: 'positional', required: true },
    'app-id': { type: 'string', description: 'GitHub App ID (skip prompt)' },
    'private-key': { type: 'string', description: 'Path to PEM file' },
  },
  async run({ args }) {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)
    providerNameAvailable(cfg, args.name)

    const flagAppId = args['app-id'] ? Number(args['app-id']) : 0
    const flagPemPath = args['private-key'] ?? ''

    if (!flagAppId && !flagPemPath && isInteractive()) {
      const method = await promptSelect<'manifest' | 'manual'>({
        message: 'How would you like to create the GitHub App?',
        options: [
          { value: 'manifest', label: 'Automatic — creates the app in your browser' },
          { value: 'manual', label: 'Manual — provide app-id + PEM file' },
        ],
      })
      if (method === 'manifest') {
        const res = await runManifestFlow(args.name)
        await savePem(paths, args.name, res.pem)
        await addAppProvider(paths.configFile, args.name, res.appId)
        return consola.success(`provider "${args.name}" (app ${res.appId}) created`)
      }
    }

    const appId = flagAppId || (await promptInt({ message: 'GitHub App ID', min: 1 }))
    const pem = flagPemPath
      ? await readFile(flagPemPath, 'utf8')
      : await promptPEM({ message: 'Private key PEM' })
    await savePem(paths, args.name, pem)
    await addAppProvider(paths.configFile, args.name, appId)
    consola.success(`provider "${args.name}" (app ${appId}) created`)
  },
})

const appStatus = defineCommand({
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

const appRemove = defineCommand({
  meta: { name: 'remove', description: 'Remove a GitHub App provider' },
  args: { name: { type: 'positional', required: true } },
  async run({ args }) {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)
    const p = getProvider(cfg, args.name)
    if (!p || p.type !== 'app') return consola.error(`provider "${args.name}" is not a GitHub App`)
    const apps = appsUsingProvider(cfg, args.name)
    if (apps.length > 0) return consola.error(`cannot remove: used by ${apps.join(', ')}`)
    await rm(appPemPath(paths, args.name), { force: true })
    await removeProvider(paths.configFile, args.name)
    consola.success(`removed "${args.name}"`)
  },
})

const commands: CommandDef[] = [
  defineCommand({
    meta: { name: 'github', description: 'Manage GitHub providers' },
    subCommands: {
      key: defineCommand({
        meta: { name: 'key', description: 'Manage SSH deploy key providers' },
        subCommands: { setup: keySetup, status: keyStatus, remove: keyRemove },
      }),
      app: defineCommand({
        meta: { name: 'app', description: 'Manage GitHub App providers' },
        subCommands: { setup: appSetup, status: appStatus, remove: appRemove },
      }),
    },
  }),
]
export default commands
