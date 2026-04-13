import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dockerHubImage, repoPath } from '@jib/paths'
import type { Paths } from '@jib/paths'
import { GENERATED_COMPOSE_FILE } from './compose-scaffold.ts'

export async function addPrepareDockerHubWorkdir(
  paths: Paths,
  app: string,
  repo: string,
  persistPaths: string[],
): Promise<string | null> {
  const image = dockerHubImage(repo)
  if (!image) return null
  const workdir = repoPath(paths, app, 'local')
  await mkdir(workdir, { recursive: true, mode: 0o750 })
  await writeFile(
    join(workdir, GENERATED_COMPOSE_FILE),
    renderDockerHubCompose(image, persistPaths),
  )
  return workdir
}

function renderDockerHubCompose(image: string, persistPaths: string[]): string {
  const lines = ['services:', '  app:', `    image: ${image}`, '    restart: unless-stopped']
  if (persistPaths.length > 0) {
    lines.push('    volumes:')
    for (const [index, path] of persistPaths.entries()) {
      lines.push(`      - app-data-${index + 1}:${path}`)
    }
    lines.push('volumes:')
    for (const [index] of persistPaths.entries()) lines.push(`  app-data-${index + 1}: {}`)
  }
  return `${lines.join('\n')}\n`
}
