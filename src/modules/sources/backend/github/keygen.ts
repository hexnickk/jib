import { chmod, readFile, stat } from 'node:fs/promises'
import { $ } from '@/libs/shell'
import { InternalError, ValidationError } from '@jib/errors'
import { type Paths, pathsCredsPath, pathsEnsureCredsDirResult } from '@jib/paths'

/** Disk layout for a deploy-key source. */
export interface DeployKeyPaths {
  privateKey: string
  publicKey: string
}

/** Returns the private and public key paths for a named deploy-key source. */
export function githubDeployKeyPaths(paths: Paths, name: string): DeployKeyPaths {
  const privateKey = pathsCredsPath(paths, 'github-key', name)
  return { privateKey, publicKey: `${privateKey}.pub` }
}

/** Generates an ed25519 SSH keypair and returns its public key text. */
export async function githubGenerateDeployKey(
  name: string,
  paths: Paths,
): Promise<string | InternalError | ValidationError> {
  const { privateKey, publicKey } = githubDeployKeyPaths(paths, name)
  const existsResult = await keyExists(privateKey)
  if (existsResult instanceof Error) {
    return existsResult
  }
  if (existsResult) {
    return new ValidationError(`deploy key already exists at ${privateKey}`)
  }

  const ensured = await pathsEnsureCredsDirResult(paths, 'github-key')
  if (ensured instanceof Error) {
    return ensured
  }
  const comment = `jib-${name}`
  let generated: { exitCode: number | null; stdout: string; stderr: string }
  try {
    generated = await $`ssh-keygen -t ed25519 -f ${privateKey} -N "" -C ${comment}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`ssh-keygen failed: ${message}`, { cause: error })
  }

  if (generated.exitCode !== 0) {
    return new InternalError(`ssh-keygen failed: ${githubKeygenDetail(generated)}`)
  }
  try {
    await chmod(privateKey, 0o640)
    return (await readFile(publicKey, 'utf8')).trimEnd()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`read ${publicKey}: ${message}`, { cause: error })
  }
}

/** Reads the fingerprint line printed by `ssh-keygen -l -f <pub>`. */
export async function githubReadKeyFingerprint(
  pubKeyPath: string,
): Promise<string | InternalError> {
  try {
    const result = await $`ssh-keygen -l -f ${pubKeyPath}`
    if (result.exitCode !== 0) {
      return new InternalError(`ssh-keygen -l failed: ${githubKeygenDetail(result)}`)
    }
    return result.stdout.toString().trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`ssh-keygen -l failed: ${message}`, { cause: error })
  }
}

function githubKeygenDetail(result: {
  exitCode: number | null
  stdout: string
  stderr: string
}): string {
  return (
    result.stderr.trim() ||
    result.stdout.trim() ||
    `command exited with code ${result.exitCode ?? 1}`
  )
}

async function keyExists(path: string): Promise<boolean | InternalError> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`checking deploy key ${path}: ${message}`, { cause: error })
  }
}
