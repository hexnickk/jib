import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { EnsureCredsDirError, PathLookupError } from './errors.ts'

export interface Paths {
  root: string
  configFile: string
  stateDir: string
  locksDir: string
  secretsDir: string
  overridesDir: string
  composeDir: string
  reposDir: string
  repoRoot: string
  nginxDir: string
  cloudflaredDir: string
}

const DEFAULT_ROOT = '/opt/jib'
const CREDS_DIR_MODE = '2770'

/**
 * Resolves every jib-managed directory under a single root. `$JIB_ROOT`
 * overrides the default `/opt/jib`; callers may pass an explicit root for
 * tests. Shared disk state is the contract.
 */
export function getPaths(root?: string): Paths {
  const base = root ?? process.env.JIB_ROOT ?? DEFAULT_ROOT
  return {
    root: base,
    configFile: join(base, 'config.yml'),
    stateDir: join(base, 'state'),
    locksDir: join(base, 'locks'),
    secretsDir: join(base, 'secrets'),
    overridesDir: join(base, 'overrides'),
    composeDir: join(base, 'compose'),
    reposDir: join(base, 'repos'),
    repoRoot: join(base, 'src'),
    nginxDir: join(base, 'nginx'),
    cloudflaredDir: join(base, 'cloudflared'),
  }
}

/**
 * Returns true for repo strings that are already complete clone URLs
 * (file://, ssh://, http(s)://, git://, git@host:…, or absolute paths).
 * These bypass GitHub URL construction and land under `repos/external/<app>`.
 */
export function isExternalRepoURL(repo: string): boolean {
  return (
    repo.startsWith('/') ||
    repo.startsWith('file://') ||
    repo.startsWith('http://') ||
    repo.startsWith('https://') ||
    repo.startsWith('ssh://') ||
    repo.startsWith('git://') ||
    /^git@[^:]+:/.test(repo)
  )
}

/**
 * On-disk path for an app's git checkout. Local repos land under
 * `repos/local/<app>`, external URLs under `repos/external/<app>`, and
 * GitHub `owner/name` repos under `repos/github/<owner>/<name>`.
 */
export function repoPath(paths: Paths, app: string, repo: string): string {
  if (repo === '' || repo === 'local') {
    return join(paths.reposDir, 'local', app)
  }
  if (isExternalRepoURL(repo)) {
    return join(paths.reposDir, 'external', app)
  }
  return join(paths.reposDir, 'github', repo)
}

/**
 * Path for a jib-managed credential under `secrets/_jib/<kind>/<name>`.
 * Mirrors Go `CredsPath`.
 */
export function credsPath(paths: Paths, kind: string, name: string): string {
  return join(paths.secretsDir, '_jib', kind, name)
}

/** Deterministic path for an app's jib-managed generated compose file. */
export function managedComposePath(paths: Paths, app: string): string {
  return join(paths.composeDir, `${app}.yml`)
}

/**
 * Creates credential directories beneath the shared `secrets/_jib` tree.
 * Existing directories are left alone so a non-root CLI does not try to chmod
 * root-owned paths; migrations repair older installs in place.
 */
export async function ensureCredsDir(paths: Paths, kind: string): Promise<string> {
  const ensured = await ensureCredsDirResult(paths, kind)
  if (ensured instanceof EnsureCredsDirError) throw ensured
  return ensured
}

export async function ensureCredsDirResult(
  paths: Paths,
  kind: string,
): Promise<EnsureCredsDirError | string> {
  const baseDir = join(paths.secretsDir, '_jib')
  const dir = join(baseDir, kind)
  const baseExists = await pathExistsResult(baseDir)
  if (baseExists instanceof PathLookupError) {
    return new EnsureCredsDirError(kind, baseDir, { cause: baseExists })
  }
  if (!baseExists) {
    const created = await createCredsDir(kind, baseDir)
    if (created instanceof EnsureCredsDirError) return created
  }
  const dirExists = await pathExistsResult(dir)
  if (dirExists instanceof PathLookupError) {
    return new EnsureCredsDirError(kind, dir, { cause: dirExists })
  }
  if (!dirExists) {
    const created = await createCredsDir(kind, dir)
    if (created instanceof EnsureCredsDirError) return created
  }
  return dir
}

/** Returns true if a file or directory exists at `path`. */
export async function pathExists(path: string): Promise<boolean> {
  const exists = await pathExistsResult(path)
  if (exists instanceof PathLookupError) throw exists
  return exists
}

export async function pathExistsResult(path: string): Promise<boolean | PathLookupError> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isMissingPathError(error)) return false
    return new PathLookupError(path, { cause: toError(error) })
  }
}

async function createCredsDir(kind: string, dir: string): Promise<EnsureCredsDirError | undefined> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o770 })
    await Bun.$`chmod ${CREDS_DIR_MODE} ${dir}`.quiet()
  } catch (error) {
    return new EnsureCredsDirError(kind, dir, { cause: toError(error) })
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error))
}
