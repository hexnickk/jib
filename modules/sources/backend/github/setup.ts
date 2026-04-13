import { writeFile } from 'node:fs/promises'
import { ConfigError, configLoad } from '@jib/config'
import { pathsEnsureCredsDirResult } from '@jib/paths'
import {
  tuiLog,
  tuiNote,
  tuiPromptIntResult,
  tuiPromptPemResult,
  tuiPromptSelectResult,
  tuiPromptStringResult,
} from '@jib/tui'
import type { SourceSetupContext } from '../../types.ts'
import { githubAuthPemPath } from './auth.ts'
import { githubAddAppSource, githubAddKeySource, githubValidateSourceName } from './config-edit.ts'
import { githubDeployKeyPaths, githubGenerateDeployKey } from './keygen.ts'

interface SetupDeps {
  githubAddAppSource?: typeof githubAddAppSource
  githubAddKeySource?: typeof githubAddKeySource
  ensureCredsDir?: typeof pathsEnsureCredsDirResult
  generateDeployKey?: typeof githubGenerateDeployKey
  loadConfig?: typeof configLoad
  log?: typeof tuiLog
  note?: typeof tuiNote
  promptInt?: typeof tuiPromptIntResult
  promptPEM?: typeof tuiPromptPemResult
  promptSelect?: typeof tuiPromptSelectResult
  promptString?: typeof tuiPromptStringResult
  githubValidateSourceName?: typeof githubValidateSourceName
  writeFile?: typeof writeFile
}

function githubSetupFail(uiLog: typeof tuiLog, error: unknown): null {
  uiLog.warning(`setup failed: ${error instanceof Error ? error.message : String(error)}`)
  uiLog.info('you can retry later: jib sources setup')
  return null
}

/**
 * Interactive GitHub source setup shared between `jib sources setup` and
 * auth-recovery prompts.
 */
export async function githubSetup(ctx: SourceSetupContext): Promise<string | null> {
  const choice = await tuiPromptSelectResult<'key' | 'app' | 'skip'>({
    message: 'Set up a git source ref? (needed for private repos)',
    options: [
      { value: 'key', label: 'SSH deploy key (simplest, per-repo)' },
      { value: 'app', label: 'GitHub App (recommended for orgs)' },
      { value: 'skip', label: 'Skip — public repos only or set up later' },
    ],
  })
  if (choice instanceof Error) return null
  if (choice === 'key') return githubSetupDeployKey(ctx)
  if (choice === 'app') return githubSetupApp(ctx)
  return null
}

export async function githubSetupDeployKey(
  ctx: SourceSetupContext,
  deps: SetupDeps = {},
): Promise<string | null> {
  const uiLog = deps.log ?? tuiLog
  try {
    const promptForString = deps.promptString ?? tuiPromptStringResult
    const load = deps.loadConfig ?? configLoad
    const validateSourceName = deps.githubValidateSourceName ?? githubValidateSourceName
    const generateKey = deps.generateDeployKey ?? githubGenerateDeployKey
    const addKeySource = deps.githubAddKeySource ?? githubAddKeySource
    const uiNote = deps.note ?? tuiNote

    const name = await promptForString({ message: 'Source name (e.g. my-org-key)' })
    if (name instanceof Error) return githubSetupFail(uiLog, name)
    const cfg = await load(ctx.paths.configFile)
    if (cfg instanceof ConfigError) return githubSetupFail(uiLog, cfg)

    const nameError = validateSourceName(cfg, name)
    if (nameError) return githubSetupFail(uiLog, nameError)

    const pubKey = await generateKey(name, ctx.paths)
    if (pubKey instanceof Error) return githubSetupFail(uiLog, pubKey)
    const writeError = await addKeySource(ctx.paths.configFile, name)
    if (writeError instanceof Error) return githubSetupFail(uiLog, writeError)

    const keyPaths = githubDeployKeyPaths(ctx.paths, name)
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
  const uiLog = deps.log ?? tuiLog
  try {
    const promptForString = deps.promptString ?? tuiPromptStringResult
    const load = deps.loadConfig ?? configLoad
    const validateSourceName = deps.githubValidateSourceName ?? githubValidateSourceName
    const promptForInt = deps.promptInt ?? tuiPromptIntResult
    const promptForPEM = deps.promptPEM ?? tuiPromptPemResult
    const ensureDir = deps.ensureCredsDir ?? pathsEnsureCredsDirResult
    const write = deps.writeFile ?? writeFile
    const addAppSource = deps.githubAddAppSource ?? githubAddAppSource

    const name = await promptForString({ message: 'Source name (e.g. my-org)' })
    if (name instanceof Error) return githubSetupFail(uiLog, name)
    const cfg = await load(ctx.paths.configFile)
    if (cfg instanceof ConfigError) return githubSetupFail(uiLog, cfg)

    const nameError = validateSourceName(cfg, name)
    if (nameError) return githubSetupFail(uiLog, nameError)

    uiLog.info('create the app at github.com → Settings → Developer settings → GitHub Apps')
    const appId = await promptForInt({ message: 'GitHub App ID', min: 1 })
    if (appId instanceof Error) return githubSetupFail(uiLog, appId)
    const pem = await promptForPEM({ message: 'Private key PEM' })
    if (pem instanceof Error) return githubSetupFail(uiLog, pem)
    const pemPath = githubAuthPemPath(ctx.paths, name)
    const ensured = await ensureDir(ctx.paths, 'github-app')
    if (ensured instanceof Error) return githubSetupFail(uiLog, ensured)
    await write(pemPath, pem, { mode: 0o640 })

    const writeError = await addAppSource(ctx.paths.configFile, name, appId)
    if (writeError instanceof Error) return githubSetupFail(uiLog, writeError)

    uiLog.success(`source "${name}" (GitHub App ${appId}) created`)
    return name
  } catch (error) {
    return githubSetupFail(uiLog, error)
  }
}
