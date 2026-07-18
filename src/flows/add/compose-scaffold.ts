import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { InternalError } from '@jib/errors'
import { type Paths, pathsManagedComposePath } from '@jib/paths'

export const GENERATED_COMPOSE_FILE = 'docker-compose.generated.yml'

/** Returns whether a repo has the Dockerfile needed to scaffold a compose file. */
export function addCanScaffoldCompose(workdir: string): boolean {
  return existsSync(join(workdir, 'Dockerfile'))
}

/** Creates a minimal generated compose file from the repo Dockerfile when one is available. */
export function addScaffoldComposeFromDockerfile(
  workdir: string,
): string | InternalError | undefined {
  if (!addCanScaffoldCompose(workdir)) {
    return undefined
  }
  try {
    const dockerfile = readFileSync(join(workdir, 'Dockerfile'), 'utf8')
    writeFileSync(
      join(workdir, GENERATED_COMPOSE_FILE),
      addRenderGeneratedCompose(addParseDockerfileExpose(dockerfile)),
    )
    return GENERATED_COMPOSE_FILE
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`scaffold compose file: ${message}`, { cause: error })
  }
}

/** Copies a generated compose file to jib-managed storage and returns its path or a typed error. */
export async function addPersistGeneratedCompose(
  paths: Paths,
  app: string,
  workdir: string,
): Promise<string | InternalError> {
  const source = join(workdir, GENERATED_COMPOSE_FILE)
  const target = pathsManagedComposePath(paths, app)
  try {
    await mkdir(dirname(target), { recursive: true, mode: 0o750 })
    await copyFile(source, target)
    return target
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`persist generated compose: ${message}`, { cause: error })
  }
}

/** Extracts the first exposed TCP port from Dockerfile text. */
export function addParseDockerfileExpose(dockerfile: string): number | undefined {
  for (const rawLine of dockerfile.split('\n')) {
    const line = rawLine.trim()
    if (!/^EXPOSE\s+/i.test(line)) {
      continue
    }
    const value = line.replace(/^EXPOSE\s+/i, '').split(/\s+/)[0] ?? ''
    const port = Number.parseInt(value.split('/')[0] ?? '', 10)
    if (Number.isInteger(port) && port > 0) {
      return port
    }
  }
  return undefined
}

/** Renders the minimal compose document used for a Dockerfile-only app. */
export function addRenderGeneratedCompose(containerPort?: number): string {
  const lines = ['services:', '  app:', '    build:', '      context: .']
  if (containerPort) {
    lines.push('    expose:', `      - "${containerPort}"`)
  }
  return `${lines.join('\n')}\n`
}
