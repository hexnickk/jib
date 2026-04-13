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
export function pathsGetPaths(root?: string): Paths {
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

export { pathsGetPaths as getPaths }

/**
 * Returns true for repo strings that are already complete clone URLs
 * (file://, ssh://, http(s)://, git://, git@host:…, or absolute paths).
 * These bypass GitHub URL construction and land under `repos/external/<app>`.
 */
export function pathsIsExternalRepoURL(repo: string): boolean {
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

export { pathsIsExternalRepoURL as isExternalRepoURL }

/**
 * On-disk path for an app's git checkout. Local repos land under
 * `repos/local/<app>`, external URLs under `repos/external/<app>`, and
 * GitHub `owner/name` repos under `repos/github/<owner>/<name>`.
 */
export function pathsRepoPath(paths: Paths, app: string, repo: string): string {
  if (repo === '' || repo === 'local') {
    return join(paths.reposDir, 'local', app)
  }
  if (pathsIsExternalRepoURL(repo)) {
    return join(paths.reposDir, 'external', app)
  }
  return join(paths.reposDir, 'github', repo)
}

export { pathsRepoPath as repoPath }

/**
 * Path for a jib-managed credential under `secrets/_jib/<kind>/<name>`.
 * Mirrors Go `CredsPath`.
 */
export function pathsCredsPath(paths: Paths, kind: string, name: string): string {
  return join(paths.secretsDir, '_jib', kind, name)
}

export { pathsCredsPath as credsPath }

/** Deterministic path for an app's jib-managed generated compose file. */
export function pathsManagedComposePath(paths: Paths, app: string): string {
  return join(paths.composeDir, `${app}.yml`)
}

export { pathsManagedComposePath as managedComposePath }

/**
 * Creates credential directories beneath the shared `secrets/_jib` tree.
 * Existing directories are left alone so a non-root CLI does not try to chmod
 * root-owned paths; migrations repair older installs in place.
 */
export async function pathsEnsureCredsDir(paths: Paths, kind: string): Promise<string> {
  const ensured = await pathsEnsureCredsDirResult(paths, kind)
  if (ensured instanceof EnsureCredsDirError) throw ensured
  return ensured
}

export { pathsEnsureCredsDir as ensureCredsDir }

/** Ensures the credential directory exists and returns a typed error on failure. */
export async function pathsEnsureCredsDirResult(
  paths: Paths,
  kind: string,
): Promise<EnsureCredsDirError | string> {
  const baseDir = join(paths.secretsDir, '_jib')
  const dir = join(baseDir, kind)
  const baseExists = await pathsPathExistsResult(baseDir)
  if (baseExists instanceof PathLookupError) {
    return new EnsureCredsDirError(kind, baseDir, { cause: baseExists })
  }
  if (!baseExists) {
    const created = await createCredsDir(kind, baseDir)
    if (created instanceof EnsureCredsDirError) return created
  }
  const dirExists = await pathsPathExistsResult(dir)
  if (dirExists instanceof PathLookupError) {
    return new EnsureCredsDirError(kind, dir, { cause: dirExists })
  }
  if (!dirExists) {
    const created = await createCredsDir(kind, dir)
    if (created instanceof EnsureCredsDirError) return created
  }
  return dir
}

export { pathsEnsureCredsDirResult as ensureCredsDirResult }

/** Returns true if a file or directory exists at `path`. */
export async function pathsPathExists(path: string): Promise<boolean> {
  const exists = await pathsPathExistsResult(path)
  if (exists instanceof PathLookupError) throw exists
  return exists
}

export { pathsPathExists as pathExists }

/** Returns true for existing files and directories, or a typed error on stat failures. */
export async function pathsPathExistsResult(path: string): Promise<boolean | PathLookupError> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isMissingPathError(error)) return false
    return new PathLookupError(path, { cause: toError(error) })
  }
}

export { pathsPathExistsResult as pathExistsResult }

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
