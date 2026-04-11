import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface Paths {
  root: string
  configFile: string
  stateDir: string
  locksDir: string
  secretsDir: string
  overridesDir: string
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

/**
 * Creates credential directories beneath the shared `secrets/_jib` tree.
 * Existing directories are left alone so a non-root CLI does not try to chmod
 * root-owned paths; migrations repair older installs in place.
 */
export async function ensureCredsDir(paths: Paths, kind: string): Promise<string> {
  const baseDir = join(paths.secretsDir, '_jib')
  const dir = join(baseDir, kind)
  if (!(await pathExists(baseDir))) {
    await mkdir(baseDir, { recursive: true, mode: 0o770 })
    await Bun.$`chmod ${CREDS_DIR_MODE} ${baseDir}`.quiet()
  }
  if (!(await pathExists(dir))) {
    await mkdir(dir, { recursive: true, mode: 0o770 })
    await Bun.$`chmod ${CREDS_DIR_MODE} ${dir}`.quiet()
  }
  return dir
}

/** Returns true if a file or directory exists at `path`. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
