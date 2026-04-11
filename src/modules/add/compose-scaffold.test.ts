import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GENERATED_COMPOSE_FILE,
  canScaffoldCompose,
  parseDockerfileExpose,
  renderGeneratedCompose,
  scaffoldComposeFromDockerfile,
} from './compose-scaffold.ts'

describe('compose scaffold helpers', () => {
  test('parses the first exposed port from a Dockerfile', () => {
    expect(parseDockerfileExpose('FROM node:20\nEXPOSE 3000/tcp 3001\n')).toBe(3000)
  })

  test('renders a minimal compose file with expose when a port is known', () => {
    expect(renderGeneratedCompose(8080)).toBe(
      'services:\n  app:\n    build:\n      context: .\n    expose:\n      - "8080"\n',
    )
  })

  test('scaffolds docker-compose.generated.yml from a root Dockerfile', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'jib-compose-scaffold-'))
    writeFileSync(join(workdir, 'Dockerfile'), 'FROM nginx\nEXPOSE 80\n')

    expect(canScaffoldCompose(workdir)).toBe(true)
    expect(scaffoldComposeFromDockerfile(workdir)).toBe(GENERATED_COMPOSE_FILE)
    expect(readFileSync(join(workdir, GENERATED_COMPOSE_FILE), 'utf8')).toContain('expose:')
  })

  test('rebuilds the generated compose file when the Dockerfile changes', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'jib-compose-scaffold-'))
    const dockerfile = join(workdir, 'Dockerfile')
    const compose = join(workdir, GENERATED_COMPOSE_FILE)

    writeFileSync(dockerfile, 'FROM nginx\nEXPOSE 80\n')
    scaffoldComposeFromDockerfile(workdir)
    expect(readFileSync(compose, 'utf8')).toContain('"80"')

    writeFileSync(dockerfile, 'FROM nginx\nEXPOSE 3000\n')
    scaffoldComposeFromDockerfile(workdir)
    expect(readFileSync(compose, 'utf8')).toContain('"3000"')
    expect(readFileSync(compose, 'utf8')).not.toContain('"80"')
  })
})
