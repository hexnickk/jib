import { type JibError, ValidationError } from '@jib/errors'
import { pathsDockerHubImage } from '@jib/paths'
import { tuiIsInteractive, tuiPromptSelectResult, tuiPromptStringOptionalResult } from '@jib/tui'
import { addSplitCommaValues } from './guided.ts'

type RepoBackend = 'github' | 'dockerhub' | 'other'

/** Resolves the repo backend from CLI flags or an interactive prompt. */
export async function addResolveRepoBackend(
  rawBackend: string | undefined,
  repo: string | undefined,
): Promise<RepoBackend | JibError | undefined> {
  if (rawBackend) {
    if (rawBackend === 'github' || rawBackend === 'dockerhub' || rawBackend === 'other') {
      return rawBackend
    }
    return new ValidationError(
      `invalid --backend "${rawBackend}" (expected github|dockerhub|other)`,
    )
  }
  if (repo || !tuiIsInteractive()) {
    return undefined
  }
  const backend = await tuiPromptSelectResult({
    message: 'Source backend',
    options: [
      { value: 'github', label: 'GitHub', hint: 'owner/repo or GitHub URL' },
      { value: 'dockerhub', label: 'Docker Hub', hint: 'owner/repo or Docker Hub URL' },
      { value: 'other', label: 'Other/local', hint: 'absolute path or external git URL' },
    ],
  })
  return backend instanceof Error ? backend : (backend as RepoBackend)
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
  if (backend === 'github') {
    if (repo.startsWith('https://github.com/')) {
      const { pathname } = new URL(repo)
      const parts = pathname.split('/').filter(Boolean)
      const owner = parts[0]
      const name = parts[1]?.replace(/\.git$/, '')
      if (owner && name) {
        return `${owner}/${name}`
      }
    }
    const ssh = repo.match(/^git@github\.com:([^\s]+?)(?:\.git)?$/)
    return ssh?.[1] ?? repo
  }
  if (backend !== 'dockerhub') {
    return repo
  }
  if (pathsDockerHubImage(repo)) {
    return repo
  }
  return `docker://${repo}`
}

/** Resolves Docker Hub persistence paths from CLI input or an optional prompt. */
export async function addResolvePersistPaths(
  repo: string,
  rawPersist: string[],
): Promise<string[] | JibError> {
  if (rawPersist.length > 0) {
    return rawPersist.flatMap(addSplitCommaValues)
  }
  if (!pathsDockerHubImage(repo) || !tuiIsInteractive()) {
    return []
  }
  const raw = await tuiPromptStringOptionalResult({
    message: 'Persistent container path(s) (comma-separated, blank for none)',
    placeholder: '/data',
  })
  if (raw instanceof Error) {
    return raw
  }
  return addSplitCommaValues(raw)
}
