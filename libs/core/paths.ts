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
  busDir: string
  cloudflaredDir: string
}

const DEFAULT_ROOT = '/opt/jib'

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
    busDir: join(base, 'bus'),
    cloudflaredDir: join(base, 'cloudflared'),
  }
}

/**
 * On-disk path for an app's git checkout. Matches Go `RepoPath`: local repos
 * land under `repos/local/<app>`, GitHub repos under `repos/github/<org>/<name>`.
 */
export function repoPath(paths: Paths, app: string, repo: string): string {
  if (repo === '' || repo === 'local') {
    return join(paths.reposDir, 'local', app)
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
