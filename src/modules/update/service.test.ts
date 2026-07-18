import { InternalError } from '@jib/errors'
import { describe, expect, test } from 'vitest'
import { updateRunResult } from './index.ts'

describe('updateRunResult', () => {
  test('updates from npm and runs Linux maintenance', async () => {
    const commands: Array<{ command: string[]; sudo?: boolean }> = []

    const result = await updateRunResult({
      platform: 'linux',
      runCommand: async (command, options) => {
        commands.push({ command, ...(options?.sudo !== undefined ? { sudo: options.sudo } : {}) })
        return 0
      },
    })

    expect(result).toBeUndefined()
    expect(commands).toEqual([
      { command: ['npm', 'install', '-g', 'deployjib'] },
      { command: ['jib', 'migrate'], sudo: true },
      {
        command: [
          'sh',
          '-c',
          'command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet jib-watcher.service',
        ],
      },
      { command: ['systemctl', 'restart', 'jib-watcher.service'], sudo: true },
      { command: ['jib', 'init', '--check', '--interactive=never'], sudo: true },
    ])
  })

  test('uses the provided npm package spec and skips Linux maintenance on macOS', async () => {
    const commands: string[][] = []

    const result = await updateRunResult({
      platform: 'darwin',
      packageSpec: 'deployjib@2.0.0',
      runCommand: async (command) => {
        commands.push(command)
        return 0
      },
    })

    expect(result).toBeUndefined()
    expect(commands).toEqual([['npm', 'install', '-g', 'deployjib@2.0.0']])
  })

  test('skips watcher restart when the service is not active', async () => {
    const commands: string[][] = []

    const result = await updateRunResult({
      platform: 'linux',
      runCommand: async (command) => {
        commands.push(command)
        return command[0] === 'sh' ? 1 : 0
      },
    })

    expect(result).toBeUndefined()
    expect(commands).not.toContainEqual(['systemctl', 'restart', 'jib-watcher.service'])
  })

  test('returns a typed error when npm install fails', async () => {
    const result = await updateRunResult({
      platform: 'linux',
      runCommand: async (command) => (command[0] === 'npm' ? 1 : 0),
    })

    expect(result).toBeInstanceOf(InternalError)
    expect(result?.message).toContain('npm install exited with status 1')
  })
})
