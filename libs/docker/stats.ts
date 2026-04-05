import { JibError } from '@jib/core'
import type { Compose } from './compose.ts'
import { type DockerExec, realExec } from './exec.ts'

/**
 * Returns a human-readable table of container resource usage for this app's
 * containers. Parity with the Go helper: filters by
 * `com.docker.compose.project=<projectName>` then invokes `docker stats`
 * against the matching IDs.
 */
export async function composeStats(compose: Compose, exec: DockerExec = realExec): Promise<string> {
  const project = compose.projectName()
  const ps = await exec(
    ['docker', 'ps', '-q', '--filter', `label=com.docker.compose.project=${project}`],
    { cwd: compose.cfg.dir, capture: true },
  )
  if (ps.exitCode !== 0) {
    throw new JibError('docker.stats', `listing containers failed: ${ps.stderr}`)
  }
  const ids = ps.stdout.split(/\s+/).filter(Boolean)
  if (ids.length === 0) return `No running containers for ${project}`

  const args = [
    'docker',
    'stats',
    '--no-stream',
    '--format',
    'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}',
    ...ids,
  ]
  const res = await exec(args, { cwd: compose.cfg.dir, capture: true })
  if (res.exitCode !== 0) {
    throw new JibError('docker.stats', `stats failed: ${res.stderr}`)
  }
  return res.stdout.trim()
}
