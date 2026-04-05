import { JibError } from '@jib/core'
import { type DockerExec, realExec } from './exec.ts'

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
