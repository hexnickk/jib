import { afterEach, describe, expect, test } from 'bun:test'
import { runCommandApp } from './app.ts'
import { setCliRuntime } from './runtime.ts'

const argvSnapshot = [...process.argv]
const envSnapshot = { JIB_OUTPUT: process.env.JIB_OUTPUT }
const originalExit = process.exit
const originalStderrWrite = process.stderr.write.bind(process.stderr)

afterEach(() => {
  process.argv = [...argvSnapshot]
  process.env.JIB_OUTPUT = envSnapshot.JIB_OUTPUT
  process.exit = originalExit
  process.stderr.write = originalStderrWrite
  setCliRuntime({
    interactive: 'auto',
    output: 'text',
    debug: false,
    stdinTty: true,
    stdoutTty: true,
  })
})

function captureStderr(): { lines: string[] } {
  const lines: string[] = []
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    return true
  }) as typeof process.stderr.write
  return { lines }
}

function interceptExit(): { code: number | null } {
  const captured = { code: null as number | null }
  process.exit = ((code?: number) => {
    captured.code = code ?? 0
    return undefined as never
  }) as typeof process.exit
  return captured
}

describe('runCommandApp', () => {
  test('renders json errors for invalid interactive flags when json output is requested', async () => {
    const stderr = captureStderr()
    const exit = interceptExit()
    process.argv = ['bun', 'jib', '--output=json', '--interactive=broken']

    await runCommandApp({
      name: 'jib',
      version: '0.0.0',
      description: 'test',
      subCommands: {},
    })

    expect(exit.code).toBe(1)

    expect(JSON.parse(stderr.lines.join(''))).toEqual({
      ok: false,
      error: {
        code: 'invalid_interactive_mode',
        message: 'invalid --interactive value "broken"',
        exitCode: 1,
        hint: 'expected one of: auto, always, never',
      },
    })
  })

  test('falls back to text errors when output mode itself is invalid', async () => {
    const stderr = captureStderr()
    const exit = interceptExit()
    process.argv = ['bun', 'jib']
    process.env.JIB_OUTPUT = 'yaml'

    await runCommandApp({
      name: 'jib',
      version: '0.0.0',
      description: 'test',
      subCommands: {},
    })

    expect(exit.code).toBe(1)

    expect(stderr.lines.join('')).toContain('invalid --output value "yaml"')
    expect(stderr.lines.join('')).toContain('expected one of: text, json')
  })
})
