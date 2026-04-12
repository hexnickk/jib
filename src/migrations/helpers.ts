import { chown, rename, unlink, writeFile } from 'node:fs/promises'
import { ValidateSudoersError, WriteSudoersError, errorMessage } from './errors.ts'

export const GROUP = 'jib'
export const SUDOERS_PATH = '/etc/sudoers.d/jib'

export const MINIMAL_CONFIG = `config_version: 3
poll_interval: 5m
modules: {}
apps: {}
`

interface VisudoCheckResult {
  exitCode: number
  stderr: { toString(): string }
}

interface SudoersDeps {
  check?: (path: string) => VisudoCheckResult
  chown?: (path: string, uid: number, gid: number) => Promise<void>
  rename?: (from: string, to: string) => Promise<void>
  unlink?: (path: string) => Promise<void>
  writeFile?: (path: string, content: string, options?: { mode?: number }) => Promise<void>
}

export function buildSudoersContent(): string {
  return `# jib: allow jib group to manage jib-owned services without password
%jib ALL=(root) NOPASSWD: /usr/bin/systemctl start jib-*, \\
  /usr/bin/systemctl stop jib-*, \\
  /usr/bin/systemctl restart jib-*, \\
  /usr/bin/systemctl enable jib-*, \\
  /usr/bin/systemctl disable jib-*, \\
  /usr/bin/systemctl daemon-reload, \\
  /usr/bin/systemctl reload nginx, \\
  /usr/sbin/nginx -t
`
}

export async function writeValidatedSudoersResult(
  path: string,
  content: string,
  deps: SudoersDeps = {},
): Promise<undefined | ValidateSudoersError | WriteSudoersError> {
  const tmp = `${path}.tmp-${process.pid}`
  const write = deps.writeFile ?? writeFile
  const check =
    deps.check ??
    ((checkPath: string) => Bun.spawnSync(['visudo', '-cf', checkPath]) as VisudoCheckResult)
  const move = deps.rename ?? rename
  const setOwner = deps.chown ?? chown
  const remove = deps.unlink ?? unlink
  let installed = false

  try {
    await write(tmp, content, { mode: 0o440 })
  } catch (error) {
    return new WriteSudoersError(`failed to write sudoers temp file ${tmp}`, {
      cause: error instanceof Error ? error : undefined,
    })
  }

  let checkResult: VisudoCheckResult
  try {
    checkResult = check(tmp)
  } catch (error) {
    await remove(tmp).catch(() => {})
    return new ValidateSudoersError(`failed to validate sudoers file ${path}`, {
      cause: error instanceof Error ? error : undefined,
    })
  }

  if (checkResult.exitCode !== 0) {
    await remove(tmp).catch(() => {})
    const stderr = checkResult.stderr.toString().trim()
    return new ValidateSudoersError(stderr || `visudo rejected ${path}`)
  }

  try {
    await move(tmp, path)
    installed = true
    await setOwner(path, 0, 0)
    return
  } catch (error) {
    await remove(installed ? path : tmp).catch(() => {})
    return new WriteSudoersError(`failed to install sudoers file ${path}: ${errorMessage(error)}`, {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

export async function writeValidatedSudoers(
  path: string,
  content: string,
  deps: SudoersDeps = {},
): Promise<void> {
  const result = await writeValidatedSudoersResult(path, content, deps)
  if (result instanceof Error) throw result
}
