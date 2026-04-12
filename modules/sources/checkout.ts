import { rm } from 'node:fs/promises'
import { pathExists } from '@jib/paths'
import * as git from './git.ts'

export function sourceErrorOptions(error: unknown): ErrorOptions {
  return { cause: error instanceof Error ? error : new Error(String(error)) }
}

export async function ensureCheckout(
  workdir: string,
  url: string,
  branch: string,
  env: git.GitEnv,
): Promise<void> {
  if (await pathExists(workdir)) {
    const [repoReady, hasRemote] = await Promise.all([git.isRepo(workdir), git.hasRemote(workdir)])
    if (!repoReady || !hasRemote) {
      await rm(workdir, { recursive: true, force: true })
    }
  }

  if (!(await pathExists(workdir))) {
    try {
      await git.clone(url, workdir, { branch, env })
    } catch (error) {
      await rm(workdir, { recursive: true, force: true })
      throw error
    }
    return
  }

  await git.setRemoteURL(workdir, url)
}
