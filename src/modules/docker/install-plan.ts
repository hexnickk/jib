import { DockerInstallUnsupportedPlatformError } from './errors.ts'

export const DOCKER_KEYRING_PATH = '/etc/apt/keyrings/docker.gpg'
export const DOCKER_APT_SOURCE_PATH = '/etc/apt/sources.list.d/docker.list'
export const DOCKER_SAFE_APT_VALUE = /^[a-z0-9._-]+$/i

export interface DockerAptRepository {
  codename: string
  id: 'debian' | 'ubuntu'
}

/** Parses `/etc/os-release` into key/value fields used to choose a Docker apt repo. */
export function dockerParseOsRelease(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed)
    const key = match?.[1]
    if (key) out[key] = unquoteOsReleaseValue(match?.[2] ?? '')
  }
  return out
}

/** Selects the official Docker apt repository for Debian/Ubuntu family hosts. */
export function dockerSelectAptRepository(
  os: Record<string, string>,
): DockerAptRepository | DockerInstallUnsupportedPlatformError {
  const id = (os.ID ?? '').toLowerCase()
  const like = (os.ID_LIKE ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const repoId = id === 'ubuntu' || like.includes('ubuntu') ? 'ubuntu' : debianRepoId(id, like)
  if (!repoId) {
    return new DockerInstallUnsupportedPlatformError(
      `expected Debian/Ubuntu /etc/os-release, got ID=${os.ID ?? '(missing)'}`,
    )
  }

  const codename =
    repoId === 'ubuntu' ? os.UBUNTU_CODENAME || os.VERSION_CODENAME : os.VERSION_CODENAME
  if (!codename || !DOCKER_SAFE_APT_VALUE.test(codename)) {
    return new DockerInstallUnsupportedPlatformError(`missing safe VERSION_CODENAME for ${repoId}`)
  }
  return { id: repoId, codename }
}

/** Returns setup commands needed before writing Docker's apt source list. */
export function dockerAptPrepCommands(
  repo: DockerAptRepository,
): Array<[string, readonly string[]]> {
  return [
    ['refresh apt package index', ['apt-get', 'update']],
    [
      'install Docker apt prerequisites',
      ['apt-get', 'install', '-y', 'ca-certificates', 'curl', 'gnupg'],
    ],
    ['create apt keyring directory', ['install', '-m', '0755', '-d', '/etc/apt/keyrings']],
    [
      'install Docker apt keyring',
      [
        'sh',
        '-c',
        `rm -f ${DOCKER_KEYRING_PATH} && curl -fsSL https://download.docker.com/linux/${repo.id}/gpg | gpg --dearmor -o ${DOCKER_KEYRING_PATH}`,
      ],
    ],
    ['make Docker apt keyring readable', ['chmod', 'a+r', DOCKER_KEYRING_PATH]],
  ]
}

/** Returns package-manager commands that install Docker Engine and Compose. */
export function dockerAptPackageCommands(): Array<[string, readonly string[]]> {
  return [
    ['refresh Docker apt package index', ['apt-get', 'update']],
    [
      'install Docker packages',
      [
        'apt-get',
        'install',
        '-y',
        'docker-ce',
        'docker-ce-cli',
        'containerd.io',
        'docker-buildx-plugin',
        'docker-compose-plugin',
      ],
    ],
  ]
}

/** Renders Docker's apt source list after architecture/distro values have been validated. */
export function dockerAptSourceLine(repo: DockerAptRepository, arch: string): string {
  return `deb [arch=${arch} signed-by=${DOCKER_KEYRING_PATH}] https://download.docker.com/linux/${repo.id} ${repo.codename} stable\n`
}

function debianRepoId(id: string, like: string[]): 'debian' | undefined {
  return id === 'debian' || like.includes('debian') ? 'debian' : undefined
}

function unquoteOsReleaseValue(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value
  return value.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\')
}
