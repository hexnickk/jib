import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Config } from '@jib/config'
import type { ModuleContext } from '@jib/core'
import { log, note, promptInt, promptPEM, promptSelect, promptString } from '@jib/tui'
import { appPemPath } from './auth.ts'
import { addAppProvider, addKeyProvider } from './config-edit.ts'
import { deployKeyPaths, generateDeployKey } from './keygen.ts'

/**
 * Interactive git auth setup, shared between `jib init` (first-run wizard)
 * and potentially `jib github setup` (standalone). Prompts the user to
 * choose between SSH deploy key, GitHub App, or skip.
 */
export async function setup(ctx: ModuleContext<Config>): Promise<void> {
  const choice = await promptSelect<'key' | 'app' | 'skip'>({
    message: 'Set up a git auth provider? (needed for private repos)',
    options: [
      { value: 'key', label: 'SSH deploy key (simplest, per-repo)' },
      { value: 'app', label: 'GitHub App (recommended for orgs)' },
      { value: 'skip', label: 'Skip — public repos only or set up later' },
    ],
  })
  if (choice === 'key') await setupDeployKey(ctx)
  else if (choice === 'app') await setupGitHubApp(ctx)
}

export async function setupDeployKey(ctx: ModuleContext<Config>): Promise<void> {
  const name = await promptString({ message: 'Provider name (e.g. my-org-key)' })
  const pubKey = await generateDeployKey(name, ctx.paths)
  await addKeyProvider(ctx.paths.configFile, name)
  const keyPaths = deployKeyPaths(ctx.paths, name)
  log.success(`deploy key "${name}" added to config`)
  note(
    [
      'Add this public key to your GitHub repo → Settings → Deploy Keys:',
      '',
      pubKey,
      '',
      `Private key: ${keyPaths.privateKey}`,
    ].join('\n'),
    'Deploy Key',
  )
}

export async function setupGitHubApp(ctx: ModuleContext<Config>): Promise<void> {
  const name = await promptString({ message: 'Provider name (e.g. my-org)' })
  log.info('create the app at github.com → Settings → Developer settings → GitHub Apps')
  const appId = await promptInt({ message: 'GitHub App ID', min: 1 })
  const pem = await promptPEM({ message: 'Private key PEM' })
  const pemPath = appPemPath(ctx.paths, name)
  await mkdir(dirname(pemPath), { recursive: true, mode: 0o750 })
  await writeFile(pemPath, pem, { mode: 0o640 })
  await addAppProvider(ctx.paths.configFile, name, appId)
  log.success(`provider "${name}" (app ${appId}) created`)
}
