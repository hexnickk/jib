import { ValidationError } from '@jib/errors'
import { dockerHubImage } from '@jib/paths'
import { addSplitCommaValues } from './guided.ts'

type RepoBackend = 'github' | 'dockerhub' | 'other'

/** Resolves the repo backend from CLI flags or an interactive prompt. */
export async function addResolveRepoBackend(
  rawBackend: string | undefined,
  repo: string | undefined,
  deps: {
    interactive: () => boolean
    select: typeof import('@jib/tui').promptSelect
  },
): Promise<RepoBackend | undefined> {
  if (rawBackend) return addParseRepoBackend(rawBackend)
  if (repo || !deps.interactive()) return undefined
  return (await deps.select({
    message: 'Source backend',
    options: [
      { value: 'github', label: 'GitHub', hint: 'owner/repo or GitHub URL' },
      { value: 'dockerhub', label: 'Docker Hub', hint: 'owner/repo or Docker Hub URL' },
      { value: 'other', label: 'Other/local', hint: 'absolute path or external git URL' },
    ],
  })) as RepoBackend
}

/** Parses the explicit `--backend` flag into a known backend value. */
export function addParseRepoBackend(rawBackend: string): RepoBackend {
  if (rawBackend === 'github' || rawBackend === 'dockerhub' || rawBackend === 'other') {
    return rawBackend
  }
  throw new ValidationError(`invalid --backend "${rawBackend}" (expected github|dockerhub|other)`)
}

/** Builds the repo prompt copy for the selected backend. */
export function addRepoPrompt(backend: RepoBackend | undefined): {
  message: string
  placeholder?: string
} {
  switch (backend) {
    case 'github':
      return { message: 'GitHub repo (owner/name or URL)', placeholder: 'owner/repo' }
    case 'dockerhub':
      return { message: 'Docker Hub image (owner/name or URL)', placeholder: 'owner/image' }
    case 'other':
      return {
        message: 'Local path or external git URL',
        placeholder: '/srv/app or https://example.com/repo.git',
      }
    default:
      return {
        message: 'Source repo or Docker image URL',
        placeholder: 'owner/repo or https://…',
      }
  }
}

/** Normalizes a raw repo string according to the chosen backend. */
export function addNormalizeRepo(repo: string, backend: RepoBackend | undefined): string {
  if (backend === 'github') return addNormalizeGitHubRepo(repo)
  if (backend !== 'dockerhub') return repo
  if (dockerHubImage(repo)) return repo
  return `docker://${repo}`
}

/** Resolves Docker Hub persistence paths from CLI input or an optional prompt. */
export async function addResolvePersistPaths(
  repo: string,
  rawPersist: string[],
  deps: {
    interactive: () => boolean
    promptOptional: typeof import('@jib/tui').promptStringOptional
  },
): Promise<string[]> {
  if (rawPersist.length > 0) return rawPersist.flatMap(addSplitCommaValues)
  if (!dockerHubImage(repo) || !deps.interactive()) return []
  const raw = await deps.promptOptional({
    message: 'Persistent container path(s) (comma-separated, blank for none)',
    placeholder: '/data',
  })
  return addSplitCommaValues(raw)
}

function addNormalizeGitHubRepo(repo: string): string {
  const https = normalizeGitHubHttpsRepo(repo)
  if (https) return https
  const ssh = repo.match(/^git@github\.com:([^\s]+?)(?:\.git)?$/)
  return ssh?.[1] ?? repo
}

function normalizeGitHubHttpsRepo(repo: string): string | null {
  if (!repo.startsWith('https://github.com/')) return null
  const { pathname } = new URL(repo)
  const parts = pathname.split('/').filter(Boolean)
  const owner = parts[0]
  const name = parts[1]?.replace(/\.git$/, '')
  return owner && name ? `${owner}/${name}` : null
}
