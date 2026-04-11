import { writeFile } from 'node:fs/promises'
import { loadConfig } from '@jib/config'
import { ensureCredsDir } from '@jib/paths'
import { log, note, promptInt, promptPEM, promptSelect, promptString } from '@jib/tui'
import type { SourceSetupContext } from '../../types.ts'
import { appPemPath } from './auth.ts'
import { addGitHubAppSource, addGitHubKeySource, sourceNameAvailable } from './config-edit.ts'
import { deployKeyPaths, generateDeployKey } from './keygen.ts'

/**
 * Interactive GitHub source setup, shared between `jib sources setup`
 * and auth-recovery prompts. Prompts the user to
 * choose between SSH deploy key, GitHub App, or skip.
 */
export async function setup(ctx: SourceSetupContext): Promise<string | null> {
  const choice = await promptSelect<'key' | 'app' | 'skip'>({
    message: 'Set up a git source ref? (needed for private repos)',
    options: [
      { value: 'key', label: 'SSH deploy key (simplest, per-repo)' },
      { value: 'app', label: 'GitHub App (recommended for orgs)' },
      { value: 'skip', label: 'Skip — public repos only or set up later' },
    ],
  })
  if (choice === 'key') return await setupDeployKey(ctx)
  if (choice === 'app') return await setupGitHubApp(ctx)
  return null
}

export async function setupDeployKey(ctx: SourceSetupContext): Promise<string | null> {
  try {
    const name = await promptString({ message: 'Source name (e.g. my-org-key)' })
    const cfg = await loadConfig(ctx.paths.configFile)
    sourceNameAvailable(cfg, name)
    const pubKey = await generateDeployKey(name, ctx.paths)
    await addGitHubKeySource(ctx.paths.configFile, name)
    const keyPaths = deployKeyPaths(ctx.paths, name)
    log.success(`GitHub source "${name}" added to config`)
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
    return name
  } catch (err) {
    log.warning(`key setup failed: ${err instanceof Error ? err.message : String(err)}`)
    log.info('you can retry later: jib sources setup')
    return null
  }
}

export async function setupGitHubApp(ctx: SourceSetupContext): Promise<string | null> {
  try {
    const name = await promptString({ message: 'Source name (e.g. my-org)' })
    const cfg = await loadConfig(ctx.paths.configFile)
    sourceNameAvailable(cfg, name)
    log.info('create the app at github.com → Settings → Developer settings → GitHub Apps')
    const appId = await promptInt({ message: 'GitHub App ID', min: 1 })
    const pem = await promptPEM({ message: 'Private key PEM' })
    const pemPath = appPemPath(ctx.paths, name)
    await ensureCredsDir(ctx.paths, 'github-app')
    await writeFile(pemPath, pem, { mode: 0o640 })
    await addGitHubAppSource(ctx.paths.configFile, name, appId)
    log.success(`source "${name}" (GitHub App ${appId}) created`)
    return name
  } catch (err) {
    log.warning(`app setup failed: ${err instanceof Error ? err.message : String(err)}`)
    log.info('you can retry later: jib sources setup')
    return null
  }
}
