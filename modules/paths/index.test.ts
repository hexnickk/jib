import { describe, expect, test } from 'bun:test'
import {
  pathsCredsPath,
  pathsDockerHubImage,
  pathsGetPaths,
  pathsIsDockerHubRepo,
  pathsPathExistsResult,
  pathsRepoPath,
} from './index.ts'

describe('paths index exports', () => {
  test('exposes only prefixed names', async () => {
    const paths = pathsGetPaths('/opt/jib')
    expect(pathsRepoPath(paths, 'demo', 'local')).toBe('/opt/jib/repos/local/demo')
    expect(pathsCredsPath(paths, 'cloudflare', 'tunnel.env')).toBe(
      '/opt/jib/secrets/_jib/cloudflare/tunnel.env',
    )
    expect(pathsDockerHubImage('docker://alpine')).toBe('alpine')
    expect(pathsIsDockerHubRepo('https://hub.docker.com/_/alpine')).toBe(true)
    expect(await pathsPathExistsResult('/definitely/missing')).toBe(false)
  })
})
