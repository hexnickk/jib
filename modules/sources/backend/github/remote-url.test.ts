import { describe, expect, test } from 'bun:test'
import { httpsCloneURL, sshCloneURL } from './remote-url.ts'

describe('sshCloneURL', () => {
  test('matches GitHub SSH format', () => {
    expect(sshCloneURL('acme/site')).toBe('git@github.com:acme/site.git')
  })
})

describe('httpsCloneURL', () => {
  test('omits the token when none supplied', () => {
    expect(httpsCloneURL('acme/site')).toBe('https://github.com/acme/site.git')
  })

  test('embeds the x-access-token user when token is set', () => {
    expect(httpsCloneURL('acme/site', 'ghs_abc')).toBe(
      'https://x-access-token:ghs_abc@github.com/acme/site.git',
    )
  })

  test('url-encodes tokens with special characters', () => {
    expect(httpsCloneURL('acme/site', 'a:b@c')).toBe(
      'https://x-access-token:a%3Ab%40c@github.com/acme/site.git',
    )
  })
})
