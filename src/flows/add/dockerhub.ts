import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { InternalError } from '@jib/errors'
import { pathsDockerHubImage, pathsRepoPath } from '@jib/paths'
import type { Paths } from '@jib/paths'
import { GENERATED_COMPOSE_FILE } from './compose-scaffold.ts'

/** Prepares a generated compose workdir for a Docker Hub image or returns a typed filesystem error. */
export async function addPrepareDockerHubWorkdir(
  paths: Paths,
  app: string,
  repo: string,
  persistPaths: string[],
): Promise<string | InternalError | undefined> {
  const image = pathsDockerHubImage(repo)
  if (!image) {
    return undefined
  }
  const workdir = pathsRepoPath(paths, app, 'local')
  try {
    await mkdir(workdir, { recursive: true, mode: 0o750 })
    await writeFile(
      join(workdir, GENERATED_COMPOSE_FILE),
      renderDockerHubCompose(image, persistPaths),
    )
    return workdir
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`prepare Docker Hub workdir: ${message}`, { cause: error })
  }
}

/** Renders a one-service compose file for a Docker Hub image and requested persistent paths. */
function renderDockerHubCompose(image: string, persistPaths: string[]): string {
  const lines = ['services:', '  app:', `    image: ${image}`, '    restart: unless-stopped']
  if (persistPaths.length > 0) {
    lines.push('    volumes:')
    for (const [index, path] of persistPaths.entries()) {
      lines.push(`      - app-data-${index + 1}:${path}`)
    }
    lines.push('volumes:')
    for (const [index] of persistPaths.entries()) {
      lines.push(`  app-data-${index + 1}: {}`)
    }
  }
  return `${lines.join('\n')}\n`
}
