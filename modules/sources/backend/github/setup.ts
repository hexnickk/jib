import { writeFile } from 'node:fs/promises'
import { ConfigError, configLoad } from '@jib/config'
import { ensureCredsDir } from '@jib/paths'
import { log, note, promptInt, promptPEM, promptSelect, promptString } from '@jib/tui'
import type { SourceSetupContext } from '../../types.ts'
import { appPemPath } from './auth.ts'
import { addGitHubAppSource, addGitHubKeySource, sourceNameAvailable } from './config-edit.ts'
import { deployKeyPaths, generateDeployKey } from './keygen.ts'

interface SetupDeps {
  addGitHubAppSource?: typeof addGitHubAppSource
  addGitHubKeySource?: typeof addGitHubKeySource
  ensureCredsDir?: typeof ensureCredsDir
  generateDeployKey?: typeof generateDeployKey
  loadConfig?: typeof configLoad
  log?: typeof log
  note?: typeof note
  promptInt?: typeof promptInt
  promptPEM?: typeof promptPEM
  promptString?: typeof promptString
  sourceNameAvailable?: typeof sourceNameAvailable
  writeFile?: typeof writeFile
}

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

export async function setupDeployKey(
  ctx: SourceSetupContext,
  deps: SetupDeps = {},
): Promise<string | null> {
  try {
    const promptForString = deps.promptString ?? promptString
    const load = deps.loadConfig ?? configLoad
    const ensureSourceNameAvailable = deps.sourceNameAvailable ?? sourceNameAvailable
    const generateKey = deps.generateDeployKey ?? generateDeployKey
    const addKeySource = deps.addGitHubKeySource ?? addGitHubKeySource
    const uiLog = deps.log ?? log
    const uiNote = deps.note ?? note
    const name = await promptForString({ message: 'Source name (e.g. my-org-key)' })
    const cfg = await load(ctx.paths.configFile)
    if (cfg instanceof ConfigError) throw cfg
    ensureSourceNameAvailable(cfg, name)
    const pubKey = await generateKey(name, ctx.paths)
    await addKeySource(ctx.paths.configFile, name)
    const keyPaths = deployKeyPaths(ctx.paths, name)
    uiLog.success(`GitHub source "${name}" added to config`)
    uiNote(
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
    const uiLog = deps.log ?? log
    uiLog.warning(`key setup failed: ${err instanceof Error ? err.message : String(err)}`)
    uiLog.info('you can retry later: jib sources setup')
    return null
  }
}

export async function setupGitHubApp(
  ctx: SourceSetupContext,
  deps: SetupDeps = {},
): Promise<string | null> {
  try {
    const promptForString = deps.promptString ?? promptString
    const load = deps.loadConfig ?? configLoad
    const ensureSourceNameAvailable = deps.sourceNameAvailable ?? sourceNameAvailable
    const uiLog = deps.log ?? log
    const promptForInt = deps.promptInt ?? promptInt
    const promptForPEM = deps.promptPEM ?? promptPEM
    const ensureDir = deps.ensureCredsDir ?? ensureCredsDir
    const write = deps.writeFile ?? writeFile
    const addAppSource = deps.addGitHubAppSource ?? addGitHubAppSource
    const name = await promptForString({ message: 'Source name (e.g. my-org)' })
    const cfg = await load(ctx.paths.configFile)
    if (cfg instanceof ConfigError) throw cfg
    ensureSourceNameAvailable(cfg, name)
    uiLog.info('create the app at github.com → Settings → Developer settings → GitHub Apps')
    const appId = await promptForInt({ message: 'GitHub App ID', min: 1 })
    const pem = await promptForPEM({ message: 'Private key PEM' })
    const pemPath = appPemPath(ctx.paths, name)
    await ensureDir(ctx.paths, 'github-app')
    await write(pemPath, pem, { mode: 0o640 })
    await addAppSource(ctx.paths.configFile, name, appId)
    uiLog.success(`source "${name}" (GitHub App ${appId}) created`)
    return name
  } catch (err) {
    const uiLog = deps.log ?? log
    uiLog.warning(`app setup failed: ${err instanceof Error ? err.message : String(err)}`)
    uiLog.info('you can retry later: jib sources setup')
    return null
  }
}
