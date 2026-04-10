import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/core'
import { isInteractive, promptInt, promptPEM, promptSelect } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { appPemPath } from '../../auth.ts'
import { addGitHubAppSource, sourceNameAvailable } from '../../config-edit.ts'
import { runManifestFlow } from '../../manifest-flow.ts'

async function savePem(
  paths: ReturnType<typeof getPaths>,
  name: string,
  pem: string,
): Promise<void> {
  const pemPath = appPemPath(paths, name)
  await mkdir(dirname(pemPath), { recursive: true, mode: 0o750 })
  await writeFile(pemPath, pem, { mode: 0o640 })
}

export default defineCommand({
  meta: { name: 'setup', description: 'Register a GitHub App source' },
  args: {
    name: { type: 'positional', required: true },
    'app-id': { type: 'string', description: 'GitHub App ID (skip prompt)' },
    'private-key': { type: 'string', description: 'Path to PEM file' },
  },
  async run({ args }) {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)
    sourceNameAvailable(cfg, args.name)

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
        await addGitHubAppSource(paths.configFile, args.name, res.appId)
        return consola.success(`source "${args.name}" (app ${res.appId}) created`)
      }
    }

    const appId = flagAppId || (await promptInt({ message: 'GitHub App ID', min: 1 }))
    const pem = flagPemPath
      ? await readFile(flagPemPath, 'utf8')
      : await promptPEM({ message: 'Private key PEM' })
    await savePem(paths, args.name, pem)
    await addGitHubAppSource(paths.configFile, args.name, appId)
    consola.success(`source "${args.name}" (app ${appId}) created`)
  },
})
