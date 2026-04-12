import { writeFile } from 'node:fs/promises'
import { ConfigError, configLoad } from '@jib/config'
import { ensureCredsDir } from '@jib/paths'
import { log, note, promptInt, promptPEM, promptSelect, promptString } from '@jib/tui'
import type { SourceSetupContext } from '../../types.ts'
import { appPemPath } from './auth.ts'
import { githubAddAppSource, githubAddKeySource, githubValidateSourceName } from './config-edit.ts'
import { deployKeyPaths, generateDeployKey } from './keygen.ts'

interface SetupDeps {
  githubAddAppSource?: typeof githubAddAppSource
  githubAddKeySource?: typeof githubAddKeySource
  ensureCredsDir?: typeof ensureCredsDir
  generateDeployKey?: typeof generateDeployKey
  loadConfig?: typeof configLoad
  log?: typeof log
  note?: typeof note
  promptInt?: typeof promptInt
  promptPEM?: typeof promptPEM
  promptString?: typeof promptString
  githubValidateSourceName?: typeof githubValidateSourceName
  writeFile?: typeof writeFile
}

function githubSetupFail(uiLog: typeof log, error: unknown): null {
  uiLog.warning(`setup failed: ${error instanceof Error ? error.message : String(error)}`)
  uiLog.info('you can retry later: jib sources setup')
  return null
}

/**
 * Interactive GitHub source setup shared between `jib sources setup` and
 * auth-recovery prompts.
 */
export async function githubSetup(ctx: SourceSetupContext): Promise<string | null> {
  const choice = await promptSelect<'key' | 'app' | 'skip'>({
    message: 'Set up a git source ref? (needed for private repos)',
    options: [
      { value: 'key', label: 'SSH deploy key (simplest, per-repo)' },
      { value: 'app', label: 'GitHub App (recommended for orgs)' },
      { value: 'skip', label: 'Skip — public repos only or set up later' },
    ],
  })
  if (choice === 'key') return githubSetupDeployKey(ctx)
  if (choice === 'app') return githubSetupApp(ctx)
  return null
}

export async function githubSetupDeployKey(
  ctx: SourceSetupContext,
  deps: SetupDeps = {},
): Promise<string | null> {
  const uiLog = deps.log ?? log
  try {
    const promptForString = deps.promptString ?? promptString
    const load = deps.loadConfig ?? configLoad
    const validateSourceName = deps.githubValidateSourceName ?? githubValidateSourceName
    const generateKey = deps.generateDeployKey ?? generateDeployKey
    const addKeySource = deps.githubAddKeySource ?? githubAddKeySource
    const uiNote = deps.note ?? note

    const name = await promptForString({ message: 'Source name (e.g. my-org-key)' })
    const cfg = await load(ctx.paths.configFile)
    if (cfg instanceof ConfigError) return githubSetupFail(uiLog, cfg)

    const nameError = validateSourceName(cfg, name)
    if (nameError) return githubSetupFail(uiLog, nameError)

    const pubKey = await generateKey(name, ctx.paths)
    const writeError = await addKeySource(ctx.paths.configFile, name)
    if (writeError instanceof Error) return githubSetupFail(uiLog, writeError)

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
  } catch (error) {
    return githubSetupFail(uiLog, error)
  }
}

export async function githubSetupApp(
  ctx: SourceSetupContext,
  deps: SetupDeps = {},
): Promise<string | null> {
  const uiLog = deps.log ?? log
  try {
    const promptForString = deps.promptString ?? promptString
    const load = deps.loadConfig ?? configLoad
    const validateSourceName = deps.githubValidateSourceName ?? githubValidateSourceName
    const promptForInt = deps.promptInt ?? promptInt
    const promptForPEM = deps.promptPEM ?? promptPEM
    const ensureDir = deps.ensureCredsDir ?? ensureCredsDir
    const write = deps.writeFile ?? writeFile
    const addAppSource = deps.githubAddAppSource ?? githubAddAppSource

    const name = await promptForString({ message: 'Source name (e.g. my-org)' })
    const cfg = await load(ctx.paths.configFile)
    if (cfg instanceof ConfigError) return githubSetupFail(uiLog, cfg)

    const nameError = validateSourceName(cfg, name)
    if (nameError) return githubSetupFail(uiLog, nameError)

    uiLog.info('create the app at github.com → Settings → Developer settings → GitHub Apps')
    const appId = await promptForInt({ message: 'GitHub App ID', min: 1 })
    const pem = await promptForPEM({ message: 'Private key PEM' })
    const pemPath = appPemPath(ctx.paths, name)
    await ensureDir(ctx.paths, 'github-app')
    await write(pemPath, pem, { mode: 0o640 })

    const writeError = await addAppSource(ctx.paths.configFile, name, appId)
    if (writeError instanceof Error) return githubSetupFail(uiLog, writeError)

    uiLog.success(`source "${name}" (GitHub App ${appId}) created`)
    return name
  } catch (error) {
    return githubSetupFail(uiLog, error)
  }
}
