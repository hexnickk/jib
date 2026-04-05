import { ConfigError } from '@jib/core'
import type { Config } from './schema.ts'

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/
// GitHub slug: `owner/name` — both segments [A-Za-z0-9._-], no `..`, no slashes.
const GITHUB_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/
const EXTERNAL_REPO_PREFIXES = ['file://', 'http://', 'https://', 'ssh://', 'git://']

/**
 * Returns an error message if `repo` is not a supported shape, else `null`.
 * Accepted: `"local"`, `""`, an absolute path, a scheme URL, `git@host:path`,
 * or an `owner/name` GitHub slug. Rejects anything containing `..` segments
 * or embedded slashes beyond the one in the GitHub slug — those would let a
 * maliciously-crafted config escape `$JIB_ROOT/repos/` via `repoPath`.
 */
export function validateRepo(repo: string): string | null {
  if (repo === '' || repo === 'local') return null
  if (repo.includes('..')) return 'contains ".." path segment'
  if (repo.startsWith('/')) return null
  if (repo.startsWith('git@') && /^git@[^:\s]+:[^\s]+$/.test(repo)) return null
  for (const prefix of EXTERNAL_REPO_PREFIXES) {
    if (repo.startsWith(prefix)) return null
  }
  if (GITHUB_SLUG_RE.test(repo)) return null
  return 'must be "local", "owner/name", an absolute path, or a file://, http(s)://, ssh://, git://, or git@host: URL'
}

/**
 * Parses a duration string like `5m`, `30s`, `1h`, `1h30m`, `1.5h`, `0s`.
 * Returns milliseconds, or `null` on parse failure. Supported units: `s`, `m`,
 * `h`. Non-negative only — `-5s`, empty strings, unit-less numbers (`5`), and
 * any unknown unit all return `null`. Narrower than Go's `time.ParseDuration`
 * (no `ns`/`us`/`ms`) but covers every value jib's config actually uses.
 */
export function parseDuration(s: string): number | null {
  if (!s) return null
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 }
  const re = /(\d+(?:\.\d+)?)([smh])/g
  let total = 0
  let matched = 0
  for (const m of s.matchAll(re)) {
    const [, n, unit] = m
    const mult = unit ? units[unit] : undefined
    if (!mult || n === undefined) return null
    total += Number.parseFloat(n) * mult
    matched += m[0].length
  }
  return matched === s.length && matched > 0 ? total : null
}

/** Runs domain-level checks that zod can't express. Throws `ConfigError`. */
export function validate(cfg: Config): void {
  const errs: string[] = []

  if (parseDuration(cfg.poll_interval) === null) {
    errs.push(`poll_interval: invalid duration "${cfg.poll_interval}"`)
  }

  const providerNames = new Set(Object.keys(cfg.github?.providers ?? {}))
  for (const name of providerNames) {
    if (!APP_NAME_RE.test(name)) {
      errs.push(`github.providers '${name}': name must match [a-z0-9-]+`)
    }
    const p = cfg.github?.providers?.[name]
    if (p?.type === 'app' && (p.app_id === undefined || p.app_id <= 0)) {
      errs.push(`github.providers '${name}': app_id is required for type 'app'`)
    }
  }

  let needsTunnel = false
  for (const [name, app] of Object.entries(cfg.apps)) {
    if (!APP_NAME_RE.test(name)) errs.push(`app '${name}': name must match [a-z0-9-]+`)
    const repoErr = validateRepo(app.repo)
    if (repoErr) errs.push(`app '${name}': repo "${app.repo}" ${repoErr}`)
    if (app.provider && app.repo !== 'local' && !providerNames.has(app.provider)) {
      errs.push(`app '${name}': provider "${app.provider}" not found in github.providers`)
    }
    for (const d of app.domains) {
      if (d.host !== d.host.toLowerCase() || !DOMAIN_RE.test(d.host)) {
        errs.push(`app '${name}': invalid hostname "${d.host}"`)
      }
      if (d.ingress === 'cloudflare-tunnel') needsTunnel = true
    }
    for (const h of app.health ?? []) {
      if (!h.path.startsWith('/')) {
        errs.push(`app '${name}': health check path must start with '/'`)
      }
    }
  }

  if (needsTunnel && !cfg.tunnel) {
    errs.push('tunnel: config required when any domain uses cloudflare-tunnel ingress')
  }

  if (errs.length > 0) throw new ConfigError(errs.join('\n'))
}
