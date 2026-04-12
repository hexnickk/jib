const IMAGE_REF_RE = /^[A-Za-z0-9._/-]+(?::[A-Za-z0-9._-]+)?$/

export function dockerHubImage(repo: string): string | null {
  if (repo.startsWith('docker://')) return normalizeImage(repo.slice('docker://'.length))
  if (repo.startsWith('dockerhub://')) return normalizeImage(repo.slice('dockerhub://'.length))
  if (!repo.startsWith('https://hub.docker.com/')) return null
  const { pathname } = new URL(repo)
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'r' && parts[1] && parts[2]) return normalizeImage(`${parts[1]}/${parts[2]}`)
  if (parts[0] === '_' && parts[1]) return normalizeImage(parts[1])
  return null
}

export function isDockerHubRepo(repo: string): boolean {
  return dockerHubImage(repo) !== null
}

function normalizeImage(value: string): string | null {
  return value.length > 0 && IMAGE_REF_RE.test(value) ? value : null
}
