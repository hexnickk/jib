import { describe, expect, test } from 'bun:test'
import { basename } from 'node:path'
import { UpdateError, updateRunResult } from './index.ts'

function responseJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status })
}

function responseBytes(value: string, status = 200): Response {
  return new Response(new TextEncoder().encode(value), { status })
}

describe('updateRunResult', () => {
  test('downloads and installs the latest GitHub release to the default prefix', async () => {
    const urls: string[] = []
    const commands: Array<{ command: string[]; sudo?: boolean }> = []

    const result = await updateRunResult({
      platform: 'linux',
      arch: 'x64',
      fetch: async (url) => {
        urls.push(String(url))
        return urls.length === 1 ? responseJson({ tag_name: 'v1.2.3' }) : responseBytes('binary')
      },
      runCommand: async (command, options) => {
        commands.push({ command, ...(options?.sudo !== undefined ? { sudo: options.sudo } : {}) })
        return 0
      },
    })

    const downloadedPath = commands[0]?.command[3]
    expect(result).toBeUndefined()
    expect(urls).toEqual([
      'https://api.github.com/repos/hexnickk/jib/releases/latest',
      'https://github.com/hexnickk/jib/releases/download/v1.2.3/jib-bun-linux-x64',
    ])
    expect(basename(downloadedPath ?? '')).toBe('jib-bun-linux-x64')
    expect(commands).toEqual([
      {
        command: ['install', '-m', '0755', downloadedPath ?? '', '/usr/local/bin/jib'],
        sudo: true,
      },
      { command: ['/usr/local/bin/jib', 'migrate'], sudo: true },
      {
        command: [
          'sh',
          '-c',
          'command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet jib-watcher.service',
        ],
      },
      { command: ['systemctl', 'restart', 'jib-watcher.service'], sudo: true },
      { command: ['/usr/local/bin/jib', 'init', '--check', '--interactive=never'], sudo: true },
    ])
  })

  test('uses the darwin arm64 release asset on supported mac hosts', async () => {
    const urls: string[] = []
    const commands: string[][] = []

    const result = await updateRunResult({
      platform: 'darwin',
      arch: 'arm64',
      fetch: async (url) => {
        urls.push(String(url))
        return urls.length === 1 ? responseJson({ tag_name: 'v2.0.0' }) : responseBytes('binary')
      },
      runCommand: async (command) => {
        commands.push(command)
        return 0
      },
    })

    const downloadedPath = commands[0]?.[3]
    expect(result).toBeUndefined()
    expect(urls).toEqual([
      'https://api.github.com/repos/hexnickk/jib/releases/latest',
      'https://github.com/hexnickk/jib/releases/download/v2.0.0/jib-bun-darwin-arm64',
    ])
    expect(basename(downloadedPath ?? '')).toBe('jib-bun-darwin-arm64')
    expect(commands).toEqual([
      ['install', '-m', '0755', downloadedPath ?? '', '/usr/local/bin/jib'],
    ])
  })

  test('skips watcher restart when the service is not active', async () => {
    const commands: string[][] = []

    const result = await updateRunResult({
      platform: 'linux',
      arch: 'arm64',
      fetch: async (url) =>
        String(url).includes('/releases/latest')
          ? responseJson({ tag_name: 'v1.2.3' })
          : responseBytes('binary'),
      runCommand: async (command) => {
        commands.push(command)
        return command[0] === 'sh' ? 1 : 0
      },
    })

    expect(result).toBeUndefined()
    expect(commands).not.toContainEqual(['systemctl', 'restart', 'jib-watcher.service'])
  })

  test('returns a typed error when a release download fails', async () => {
    const result = await updateRunResult({
      platform: 'linux',
      arch: 'x64',
      fetch: async (url) =>
        String(url).includes('/releases/latest')
          ? responseJson({ tag_name: 'v1.2.3' })
          : responseBytes('missing', 404),
    })

    expect(result).toBeInstanceOf(UpdateError)
    expect(result?.message).toContain('download failed: HTTP 404')
  })
})
