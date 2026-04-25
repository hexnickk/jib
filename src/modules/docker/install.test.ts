import { describe, expect, test } from 'bun:test'
import {
  type DockerInstallCommandResult,
  DockerInstallReadFileError,
  DockerInstallUnsupportedPlatformError,
  dockerEnsureInstalledResult,
  dockerParseOsRelease,
  dockerSelectAptRepository,
} from './index.ts'

function result(exitCode = 0, stdout = '', stderr = ''): DockerInstallCommandResult {
  return { exitCode, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }
}

function key(args: readonly string[]): string {
  return args.join(' ')
}

describe('docker install helpers', () => {
  test('dockerParseOsRelease parses quoted values', () => {
    expect(dockerParseOsRelease('ID=ubuntu\nVERSION_CODENAME="noble"\nID_LIKE="debian"\n')).toEqual(
      { ID: 'ubuntu', VERSION_CODENAME: 'noble', ID_LIKE: 'debian' },
    )
  })

  test('dockerSelectAptRepository selects Ubuntu for derivatives with UBUNTU_CODENAME', () => {
    expect(
      dockerSelectAptRepository({
        ID: 'linuxmint',
        ID_LIKE: 'ubuntu debian',
        VERSION_CODENAME: 'wilma',
        UBUNTU_CODENAME: 'noble',
      }),
    ).toEqual({ id: 'ubuntu', codename: 'noble' })
  })

  test('dockerEnsureInstalledResult skips package install when Docker is already ready', async () => {
    const calls: string[] = []
    const error = await dockerEnsureInstalledResult({
      run: async (args) => {
        calls.push(key(args))
        return result()
      },
    })

    expect(error).toBeUndefined()
    expect(calls).toContain('systemctl enable --now docker.service')
    expect(calls.some((call) => call.startsWith('apt-get '))).toBe(false)
  })

  test('dockerEnsureInstalledResult installs Docker from apt when runtime pieces are missing', async () => {
    const calls: string[] = []
    let installed = false
    let source = ''

    const error = await dockerEnsureInstalledResult({
      readOsRelease: async () => 'ID=ubuntu\nVERSION_CODENAME=noble\n',
      writeFile: async (_path, data) => {
        source = data
      },
      run: async (args) => {
        const call = key(args)
        calls.push(call)
        if (call === 'sh -c command -v systemctl >/dev/null 2>&1') return result()
        if (call === 'sh -c command -v apt-get >/dev/null 2>&1') return result()
        if (call === 'sh -c command -v docker >/dev/null 2>&1') {
          return installed ? result(0, '/usr/bin/docker\n') : result(1)
        }
        if (call === 'docker compose version') {
          return installed ? result(0, 'Docker Compose version v2\n') : result(1)
        }
        if (call === 'systemctl cat docker.service') {
          return installed ? result(0, '[Unit]\n') : result(1)
        }
        if (call === 'dpkg --print-architecture') return result(0, 'amd64\n')
        if (call.includes('docker-ce docker-ce-cli containerd.io')) installed = true
        return result()
      },
    })

    expect(error).toBeUndefined()
    expect(source).toBe(
      'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable\n',
    )
    expect(calls).toContain('apt-get update')
    expect(calls).toContain(
      'apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
    )
    expect(calls).toContain('systemctl enable --now docker.service')
  })

  test('dockerEnsureInstalledResult returns a typed error when systemd is unavailable', async () => {
    const error = await dockerEnsureInstalledResult({ run: async () => result(1, '', 'missing') })

    expect(error).toBeInstanceOf(DockerInstallUnsupportedPlatformError)
    expect(error?.message).toContain('systemd')
  })

  test('dockerEnsureInstalledResult reports os-release read failures accurately', async () => {
    const error = await dockerEnsureInstalledResult({
      readOsRelease: async () => {
        throw new Error('no os-release')
      },
      run: async (args) => {
        const call = key(args)
        if (call === 'sh -c command -v systemctl >/dev/null 2>&1') return result()
        if (call === 'sh -c command -v apt-get >/dev/null 2>&1') return result()
        return result(1)
      },
    })

    expect(error).toBeInstanceOf(DockerInstallReadFileError)
    expect(error?.message).toContain('read /etc/os-release')
  })
})
