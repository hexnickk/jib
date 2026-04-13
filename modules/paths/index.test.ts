import { describe, expect, test } from 'bun:test'
import {
  credsPath,
  dockerHubImage,
  getPaths,
  isDockerHubRepo,
  pathExists,
  pathsCredsPath,
  pathsDockerHubImage,
  pathsGetPaths,
  pathsIsDockerHubRepo,
  pathsPathExists,
  pathsRepoPath,
  repoPath,
} from './index.ts'

describe('paths index exports', () => {
  test('exposes prefixed names and compatibility aliases', async () => {
    const paths = pathsGetPaths('/opt/jib')
    expect(getPaths('/opt/jib')).toEqual(paths)
    expect(pathsRepoPath(paths, 'demo', 'local')).toBe(repoPath(paths, 'demo', 'local'))
    expect(pathsCredsPath(paths, 'cloudflare', 'tunnel.env')).toBe(
      credsPath(paths, 'cloudflare', 'tunnel.env'),
    )
    expect(pathsDockerHubImage('docker://alpine')).toBe(dockerHubImage('docker://alpine'))
    expect(pathsIsDockerHubRepo('https://hub.docker.com/_/alpine')).toBe(
      isDockerHubRepo('https://hub.docker.com/_/alpine'),
    )
    expect(await pathsPathExists('/definitely/missing')).toBe(false)
    expect(await pathExists('/definitely/missing')).toBe(false)
  })
})
