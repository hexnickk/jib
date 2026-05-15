import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UpdateError } from './errors.ts'

const REPO = 'hexnickk/jib'
const INSTALL_PATH = '/usr/local/bin/jib'
const WATCHER_SERVICE = 'jib-watcher.service'

type UpdateFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type UpdateCommandRunner = (command: string[], options?: { sudo?: boolean }) => Promise<number>

interface UpdateRunDeps {
  fetch?: UpdateFetch
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  runCommand?: UpdateCommandRunner
}

/** Maps the current platform and architecture to jib's release asset target. */
function updateAssetTarget(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string | UpdateError {
  const os = platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : undefined
  if (!os) return new UpdateError(`unsupported OS: ${platform} (jib supports linux, darwin)`)

  const cpu = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : undefined
  if (!cpu) return new UpdateError(`unsupported arch: ${arch} (jib supports x64, arm64)`)

  if (os === 'darwin' && cpu === 'x64') {
    return new UpdateError('darwin-x64 is not supported; use an arm64 mac or a linux host')
  }

  return `bun-${os}-${cpu}`
}

/** Looks up the latest GitHub release tag for the hard-coded upstream repository. */
async function updateLatestTag(fetchImpl: UpdateFetch): Promise<string | UpdateError> {
  const api = `https://api.github.com/repos/${REPO}/releases/latest`
  const res = await fetchImpl(api, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) return new UpdateError(`failed to query ${api}: HTTP ${res.status}`)

  const body = (await res.json()) as { tag_name?: unknown }
  const tag = typeof body.tag_name === 'string' ? body.tag_name : undefined
  return tag ?? new UpdateError('could not determine latest release tag')
}

/** Downloads the release binary bytes for a target and tag. */
async function updateDownloadBinary(
  fetchImpl: UpdateFetch,
  target: string,
  tag: string,
): Promise<{ asset: string; bytes: Uint8Array } | UpdateError> {
  const asset = `jib-${target}`
  const url = `https://github.com/${REPO}/releases/download/${tag}/${asset}`
  const res = await fetchImpl(url)
  if (!res.ok) return new UpdateError(`download failed: HTTP ${res.status} from ${url}`)
  return { asset, bytes: new Uint8Array(await res.arrayBuffer()) }
}

/** Runs a subprocess with inherited stdio, optionally through sudo, and returns its exit code. */
async function updateRunCommand(
  command: string[],
  options: { sudo?: boolean } = {},
): Promise<number> {
  const finalCommand = options.sudo && process.getuid?.() !== 0 ? ['sudo', ...command] : command
  const proc = Bun.spawn(finalCommand, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  return await proc.exited
}

/** Runs one command and converts a non-zero exit into an update error. */
async function updateRunChecked(
  run: UpdateCommandRunner,
  command: string[],
  label: string,
  options: { sudo?: boolean } = {},
): Promise<undefined | UpdateError> {
  const code = await run(command, options)
  return code === 0 ? undefined : new UpdateError(`${label} exited with status ${code}`)
}

/** Installs the binary and performs the same Linux maintenance as scripts/install.sh. */
async function updateInstallBinary(
  binaryPath: string,
  platform: NodeJS.Platform,
  run: UpdateCommandRunner,
): Promise<undefined | UpdateError> {
  const installError = await updateRunChecked(
    run,
    ['install', '-m', '0755', binaryPath, INSTALL_PATH],
    'install',
    { sudo: true },
  )
  if (installError) return installError
  if (platform !== 'linux') return undefined

  const migrateError = await updateRunChecked(run, [INSTALL_PATH, 'migrate'], 'migrate', {
    sudo: true,
  })
  if (migrateError) return migrateError

  const watcherActive = await run([
    'sh',
    '-c',
    `command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet ${WATCHER_SERVICE}`,
  ])
  if (watcherActive === 0) {
    const restartError = await updateRunChecked(
      run,
      ['systemctl', 'restart', WATCHER_SERVICE],
      'watcher restart',
      { sudo: true },
    )
    if (restartError) return restartError
  }

  return await updateRunChecked(
    run,
    [INSTALL_PATH, 'init', '--check', '--interactive=never'],
    'optional module check',
    { sudo: true },
  )
}

/** Converts unexpected network, filesystem, or subprocess setup failures into update errors. */
function updateErrorFrom(error: unknown): UpdateError {
  if (error instanceof UpdateError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new UpdateError(message, error instanceof Error ? { cause: error } : undefined)
}

/**
 * Downloads and installs the latest GitHub release binary directly.
 * Inputs are injectable process dependencies for isolated tests.
 * Output is undefined on success or a typed update error; side effects replace the jib binary and run post-install checks.
 */
export async function updateRunResult(deps: UpdateRunDeps = {}): Promise<undefined | UpdateError> {
  try {
    const platform = deps.platform ?? process.platform
    const target = updateAssetTarget(platform, deps.arch ?? process.arch)
    if (target instanceof UpdateError) return target

    const fetchImpl = deps.fetch ?? fetch
    const tag = await updateLatestTag(fetchImpl)
    if (tag instanceof UpdateError) return tag

    const downloaded = await updateDownloadBinary(fetchImpl, target, tag)
    if (downloaded instanceof UpdateError) return downloaded

    const tmp = await mkdtemp(join(tmpdir(), 'jib-update-'))
    try {
      const binaryPath = join(tmp, downloaded.asset)
      await writeFile(binaryPath, downloaded.bytes)
      await chmod(binaryPath, 0o755)
      return await updateInstallBinary(binaryPath, platform, deps.runCommand ?? updateRunCommand)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  } catch (error) {
    return updateErrorFrom(error)
  }
}
