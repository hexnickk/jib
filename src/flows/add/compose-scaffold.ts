import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type Paths, pathsManagedComposePath } from '@jib/paths'

export const GENERATED_COMPOSE_FILE = 'docker-compose.generated.yml'

export function addCanScaffoldCompose(workdir: string): boolean {
  return existsSync(join(workdir, 'Dockerfile'))
}

export function addScaffoldComposeFromDockerfile(workdir: string): string | null {
  if (!addCanScaffoldCompose(workdir)) return null
  const dockerfile = readFileSync(join(workdir, 'Dockerfile'), 'utf8')
  writeFileSync(
    join(workdir, GENERATED_COMPOSE_FILE),
    addRenderGeneratedCompose(addParseDockerfileExpose(dockerfile)),
  )
  return GENERATED_COMPOSE_FILE
}

export async function addPersistGeneratedCompose(
  paths: Paths,
  app: string,
  workdir: string,
): Promise<string> {
  const source = join(workdir, GENERATED_COMPOSE_FILE)
  const target = pathsManagedComposePath(paths, app)
  await mkdir(dirname(target), { recursive: true, mode: 0o750 })
  await copyFile(source, target)
  return target
}

export function addParseDockerfileExpose(dockerfile: string): number | undefined {
  for (const rawLine of dockerfile.split('\n')) {
    const line = rawLine.trim()
    if (!/^EXPOSE\s+/i.test(line)) continue
    const value = line.replace(/^EXPOSE\s+/i, '').split(/\s+/)[0] ?? ''
    const port = Number.parseInt(value.split('/')[0] ?? '', 10)
    if (Number.isInteger(port) && port > 0) return port
  }
  return undefined
}

export function addRenderGeneratedCompose(containerPort?: number): string {
  const lines = ['services:', '  app:', '    build:', '      context: .']
  if (containerPort) lines.push('    expose:', `      - "${containerPort}"`)
  return `${lines.join('\n')}\n`
}
