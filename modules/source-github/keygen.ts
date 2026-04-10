import { chmod, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { JibError, type Paths, credsPath } from '@jib/core'
import { $ } from 'bun'

/** Disk layout for a deploy-key provider. Mirrors Go `ghPkg.KeyPath`. */
export interface DeployKeyPaths {
  privateKey: string
  publicKey: string
}

/**
 * Returns the private + public key paths for a named deploy-key provider.
 * Lives under `secrets/_jib/github-key/<name>{,.pub}` so permissions follow
 * the rest of the jib-managed secret tree.
 */
export function deployKeyPaths(paths: Paths, name: string): DeployKeyPaths {
  const privateKey = credsPath(paths, 'github-key', name)
  return { privateKey, publicKey: `${privateKey}.pub` }
}

/**
 * Generates an ed25519 SSH keypair via `ssh-keygen`. Throws if the key already
 * exists — callers are expected to run `remove` first. Returns the public key
 * text so the CLI can print it for the user to paste into GitHub.
 */
export async function generateDeployKey(name: string, paths: Paths): Promise<string> {
  const { privateKey, publicKey } = deployKeyPaths(paths, name)
  if (await exists(privateKey)) {
    throw new JibError('github.keygen', `deploy key already exists at ${privateKey}`)
  }
  await mkdir(dirname(privateKey), { recursive: true, mode: 0o750 })
  const comment = `jib-${name}`
  const res = await $`ssh-keygen -t ed25519 -f ${privateKey} -N "" -C ${comment}`.quiet().nothrow()
  if (res.exitCode !== 0) {
    throw new JibError('github.keygen', `ssh-keygen failed: ${res.stderr.toString()}`)
  }
  await chmod(privateKey, 0o640)
  return (await readFile(publicKey, 'utf8')).trimEnd()
}

/** Parses the fingerprint line printed by `ssh-keygen -l -f <pub>`. */
export async function keyFingerprint(pubKeyPath: string): Promise<string> {
  const res = await $`ssh-keygen -l -f ${pubKeyPath}`.quiet().nothrow()
  if (res.exitCode !== 0) {
    throw new JibError('github.keygen', `ssh-keygen -l failed: ${res.stderr.toString()}`)
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
