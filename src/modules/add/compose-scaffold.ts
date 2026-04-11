import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const GENERATED_COMPOSE_FILE = 'docker-compose.generated.yml'

export function canScaffoldCompose(workdir: string): boolean {
  return existsSync(join(workdir, 'Dockerfile'))
}

export function scaffoldComposeFromDockerfile(workdir: string): string | null {
  if (!canScaffoldCompose(workdir)) return null
  const dockerfile = readFileSync(join(workdir, 'Dockerfile'), 'utf8')
  writeFileSync(
    join(workdir, GENERATED_COMPOSE_FILE),
    renderGeneratedCompose(parseDockerfileExpose(dockerfile)),
  )
  return GENERATED_COMPOSE_FILE
}

export function parseDockerfileExpose(dockerfile: string): number | undefined {
  for (const rawLine of dockerfile.split('\n')) {
    const line = rawLine.trim()
    if (!/^EXPOSE\s+/i.test(line)) continue
    const value = line.replace(/^EXPOSE\s+/i, '').split(/\s+/)[0] ?? ''
    const port = Number.parseInt(value.split('/')[0] ?? '', 10)
    if (Number.isInteger(port) && port > 0) return port
  }
  return undefined
}

export function renderGeneratedCompose(containerPort?: number): string {
  const lines = ['services:', '  app:', '    build:', '      context: .']
  if (containerPort) lines.push('    expose:', `      - "${containerPort}"`)
  return `${lines.join('\n')}\n`
}
