import { InternalError } from '@jib/errors'
import { z } from 'zod'
import { $ } from '@/libs/shell'
import { dockerProjectName } from './compose.ts'

export interface DockerContainerStatus {
  service: string
  state: string
  status: string
}

/** Owns Compose's project naming, JSON/JSON-lines variants, and status error mapping. */
export async function dockerCollectContainerStatus(
  app: string,
): Promise<DockerContainerStatus[] | InternalError> {
  try {
    const res = await $({
      timeout: '10s',
    })`docker compose -p ${dockerProjectName(app)} ps --all --format json`
    if (res.exitCode !== 0) {
      return new InternalError('container status unavailable')
    }
    const stdout = res.stdout.trim()
    if (!stdout) {
      return []
    }
    const rows: unknown = stdout.startsWith('[')
      ? JSON.parse(stdout)
      : stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
    const parsed = z
      .array(z.object({ Service: z.string(), State: z.string(), Status: z.string() }))
      .safeParse(rows)
    if (!parsed.success) {
      return new InternalError('container status unavailable: invalid Docker response')
    }
    return parsed.data.map((row) => ({
      service: row.Service,
      state: row.State,
      status: row.Status,
    }))
  } catch (error) {
    return new InternalError('container status unavailable', { cause: error })
  }
}
