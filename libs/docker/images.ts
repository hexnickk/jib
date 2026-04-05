import { JibError } from '@jib/core'
import type { Compose } from './compose.ts'
import { type DockerExec, realExec } from './exec.ts'

/**
 * Tags the current image for every service in this compose project as
 * `jib-<app>-<service>:rollback`. Runs before a redeploy so multi-service
 * apps can revert every container, not just the last one.
 */
export async function tagRollbackImages(
  compose: Compose,
  exec: DockerExec = realExec,
): Promise<void> {
  const args = ['docker', ...compose.baseArgs(), 'images', '--format', '{{.Service}} {{.ID}}']
  const res = await exec(args, { cwd: compose.cfg.dir, capture: true })
  if (res.exitCode !== 0) {
    throw new JibError('docker.images', `compose images failed: ${res.stderr}`)
  }
  for (const line of res.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const [service, imageId] = parts as [string, string]
    const tag = `${compose.projectName()}-${service}:rollback`
    const tagRes = await exec(['docker', 'tag', imageId, tag], { cwd: compose.cfg.dir })
    if (tagRes.exitCode !== 0) {
      throw new JibError('docker.images', `tagging ${imageId} as ${tag} failed: ${tagRes.stderr}`)
    }
  }
}

export async function pruneImages(exec: DockerExec = realExec): Promise<void> {
  const res = await exec(['docker', 'image', 'prune', '-f'], {})
  if (res.exitCode !== 0) {
    throw new JibError('docker.images', `prune failed: ${res.stderr}`)
  }
}

export async function imageExists(tag: string, exec: DockerExec = realExec): Promise<boolean> {
  const res = await exec(['docker', 'image', 'inspect', tag], { capture: true })
  return res.exitCode === 0
}
