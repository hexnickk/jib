import { chmod, readFile, stat } from 'node:fs/promises'
import { type Paths, pathsCredsPath, pathsEnsureCredsDirResult } from '@jib/paths'
import {
  GitHubDeployKeyExistsError,
  GitHubDeployKeyGenerateError,
  GitHubKeyFingerprintError,
} from './errors.ts'

/** Disk layout for a deploy-key source. Mirrors Go `ghPkg.KeyPath`. */
export interface DeployKeyPaths {
  privateKey: string
  publicKey: string
}

/**
 * Returns the private + public key paths for a named deploy-key source.
 * Lives under `secrets/_jib/github-key/<name>{,.pub}` so permissions follow
 * the rest of the jib-managed secret tree.
 */
export function githubDeployKeyPaths(paths: Paths, name: string): DeployKeyPaths {
  const privateKey = pathsCredsPath(paths, 'github-key', name)
  return { privateKey, publicKey: `${privateKey}.pub` }
}

/**
 * Generates an ed25519 SSH keypair via `ssh-keygen`. Throws if the key already
 * exists — callers are expected to run `remove` first. Returns the public key
 * text so the CLI can print it for the user to paste into GitHub.
 */
export async function githubGenerateDeployKey(name: string, paths: Paths): Promise<string | Error> {
  const { privateKey, publicKey } = githubDeployKeyPaths(paths, name)
  if (await exists(privateKey)) {
    return new GitHubDeployKeyExistsError(privateKey)
  }
  const ensured = await pathsEnsureCredsDirResult(paths, 'github-key')
  if (ensured instanceof Error) return ensured
  const comment = `jib-${name}`
  const res = await Bun.$`ssh-keygen -t ed25519 -f ${privateKey} -N "" -C ${comment}`
    .quiet()
    .nothrow()
  if (res.exitCode !== 0) {
    return new GitHubDeployKeyGenerateError(`ssh-keygen failed: ${res.stderr.toString()}`)
  }
  try {
    await chmod(privateKey, 0o640)
    return (await readFile(publicKey, 'utf8')).trimEnd()
  } catch (error) {
    return new GitHubDeployKeyGenerateError(
      `read ${publicKey}: ${error instanceof Error ? error.message : String(error)}`,
      error,
    )
  }
}

/** Parses the fingerprint line printed by `ssh-keygen -l -f <pub>`. */
export async function githubReadKeyFingerprint(pubKeyPath: string): Promise<string | Error> {
  const res = await Bun.$`ssh-keygen -l -f ${pubKeyPath}`.quiet().nothrow()
  if (res.exitCode !== 0) {
    return new GitHubKeyFingerprintError(res.stderr.toString())
  }
  return res.stdout.toString().trim()
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
