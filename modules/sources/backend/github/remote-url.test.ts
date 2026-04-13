import { describe, expect, test } from 'bun:test'
import { githubRemoteHttpsCloneUrl, githubRemoteSshCloneUrl } from './remote-url.ts'

describe('githubRemoteSshCloneUrl', () => {
  test('matches GitHub SSH format', () => {
    expect(githubRemoteSshCloneUrl('acme/site')).toBe('git@github.com:acme/site.git')
  })
})

describe('githubRemoteHttpsCloneUrl', () => {
  test('omits the token when none supplied', () => {
    expect(githubRemoteHttpsCloneUrl('acme/site')).toBe('https://github.com/acme/site.git')
  })

  test('embeds the x-access-token user when token is set', () => {
    expect(githubRemoteHttpsCloneUrl('acme/site', 'ghs_abc')).toBe(
      'https://x-access-token:ghs_abc@github.com/acme/site.git',
    )
  })

  test('url-encodes tokens with special characters', () => {
    expect(githubRemoteHttpsCloneUrl('acme/site', 'a:b@c')).toBe(
      'https://x-access-token:a%3Ab%40c@github.com/acme/site.git',
    )
  })
})
