import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  addAppProvider,
  addKeyProvider,
  appPemPath,
  deployKeyPaths,
  generateDeployKey,
} from '@jib-module/github'
import { type Config, loadConfig } from '@jib/config'
import type { ModuleContext } from '@jib/core'
import { log, note, promptInt, promptPEM, promptSelect, promptString } from '@jib/tui'

/**
 * Prompt the user to set up a git auth provider (SSH deploy key or GitHub
 * App). Both flows complete inline — no deferred commands.
 */
export async function promptGitAuth(ctx: ModuleContext<Config>): Promise<void> {
  const gitAuth = await promptSelect<'key' | 'app' | 'skip'>({
    message: 'Set up a git auth provider? (needed for private repos)',
    options: [
      { value: 'key', label: 'SSH deploy key (simplest, per-repo)' },
      { value: 'app', label: 'GitHub App (recommended for orgs)' },
      { value: 'skip', label: 'Skip — public repos only or set up later' },
    ],
  })
  if (gitAuth === 'key') {
    await setupDeployKey(ctx)
  } else if (gitAuth === 'app') {
    await setupGitHubApp(ctx)
  }
}

async function setupDeployKey(ctx: ModuleContext<Config>): Promise<void> {
  try {
    const name = await promptString({ message: 'Provider name (e.g. my-org-key)' })
    const cfg = await loadConfig(ctx.paths.configFile)
    if (cfg.github?.providers?.[name]) {
      log.warning(`provider "${name}" already exists — skipping`)
      return
    }
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
  } catch (err) {
    log.warning(`key setup failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function setupGitHubApp(ctx: ModuleContext<Config>): Promise<void> {
  try {
    const name = await promptString({ message: 'Provider name (e.g. my-org)' })
    const cfg = await loadConfig(ctx.paths.configFile)
    if (cfg.github?.providers?.[name]) {
      log.warning(`provider "${name}" already exists — skipping`)
      return
    }
    log.info('create the app at github.com → Settings → Developer settings → GitHub Apps')
    const appId = await promptInt({ message: 'GitHub App ID', min: 1 })
    const pem = await promptPEM({ message: 'Private key PEM' })
    const pemPath = appPemPath(ctx.paths, name)
    await mkdir(dirname(pemPath), { recursive: true, mode: 0o750 })
    await writeFile(pemPath, pem, { mode: 0o640 })
    await addAppProvider(ctx.paths.configFile, name, appId)
    log.success(`provider "${name}" (app ${appId}) created`)
  } catch (err) {
    log.warning(`app setup failed: ${err instanceof Error ? err.message : String(err)}`)
    log.info('you can retry later: jib github app setup <name>')
  }
}
