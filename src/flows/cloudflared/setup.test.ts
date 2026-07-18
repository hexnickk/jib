import { InternalError } from '@jib/errors'
import { pathsGetPaths } from '@jib/paths'
import { describe, expect, test } from 'vitest'
import { cloudflaredRunSetup, cloudflaredRunSetupResult } from './setup.ts'

function createLogger() {
  const messages: string[] = []
  return {
    messages,
    info(message: string) {
      messages.push(`info:${message}`)
    },
    success(message: string) {
      messages.push(`success:${message}`)
    },
    warning(message: string) {
      messages.push(`warning:${message}`)
    },
  }
}

describe('cloudflaredRunSetupResult', () => {
  const paths = pathsGetPaths('/tmp/jib-cloudflared-setup')

  test('returns typed prompt errors when replacement confirmation fails', async () => {
    const result = await cloudflaredRunSetupResult(paths, {
      hasToken: () => true,
      promptConfirm: async () => {
        throw new Error('stdin unavailable')
      },
    })

    expect(result).toBeInstanceOf(InternalError)
    if (result instanceof InternalError) {
      expect(result.message).toContain('confirm tunnel token replacement')
    }
  })

  test('returns a skipped result for invalid token input', async () => {
    const logger = createLogger()
    const result = await cloudflaredRunSetupResult(paths, {
      hasToken: () => false,
      logger,
      promptPassword: async () => 'not-a-token',
      saveToken: async () => false,
    })

    expect(result).toEqual({ status: 'skipped', reason: 'invalid_token' })
    expect(logger.messages).toEqual([
      'info:Get a token at dash.cloudflare.com → Zero Trust → Networks → Connectors,',
      'info:then create a tunnel and copy the install command or token.',
    ])
  })

  test('returns typed save errors when token persistence fails', async () => {
    const result = await cloudflaredRunSetupResult(paths, {
      hasToken: () => false,
      logger: createLogger(),
      promptPassword: async () => 'eyJhIjoiNzQ',
      saveToken: async () => new InternalError('disk full'),
    })

    expect(result).toBeInstanceOf(InternalError)
    if (result instanceof InternalError) {
      expect(result.cause).toBeInstanceOf(Error)
      expect(result.message).toContain('disk full')
    }
  })

  test('returns typed start errors when cloudflared does not start', async () => {
    const result = await cloudflaredRunSetupResult(paths, {
      hasToken: () => true,
      promptConfirm: async () => false,
      enableService: async () => ({ ok: false, detail: 'permission denied' }),
    })

    expect(result).toBeInstanceOf(InternalError)
    if (result instanceof InternalError) {
      expect(result.message).toContain('permission denied')
    }
  })
})

describe('cloudflaredRunSetup', () => {
  const paths = pathsGetPaths('/tmp/jib-cloudflared-setup')

  test('keeps the boolean wrapper behavior for existing callers', async () => {
    const logger = createLogger()

    const ok = await cloudflaredRunSetup(paths, {
      hasToken: () => false,
      logger,
      promptPassword: async () => 'eyJhIjoiNzQ',
      saveToken: async () => true,
      enableService: async () => ({ ok: true, detail: '' }),
    })

    expect(ok).toBe(true)
    expect(logger.messages).toEqual([
      'info:Get a token at dash.cloudflare.com → Zero Trust → Networks → Connectors,',
      'info:then create a tunnel and copy the install command or token.',
      'success:tunnel token saved',
      'success:cloudflared started',
    ])
  })

  test('logs typed failures as warnings and returns false', async () => {
    const logger = createLogger()

    const ok = await cloudflaredRunSetup(paths, {
      hasToken: () => true,
      promptConfirm: async () => {
        throw new Error('cancelled')
      },
      logger,
    })

    expect(ok).toBe(false)
    expect(logger.messages).toEqual([
      'warning:tunnel token setup skipped: confirm tunnel token replacement: cancelled',
    ])
  })

  test('does not print setup instructions when keeping an existing token', async () => {
    const logger = createLogger()

    const ok = await cloudflaredRunSetup(paths, {
      hasToken: () => true,
      promptConfirm: async () => false,
      logger,
      enableService: async () => ({ ok: true, detail: '' }),
    })

    expect(ok).toBe(true)
    expect(logger.messages).toEqual(['success:keeping existing tunnel token'])
  })

  test('renders setup instructions in the wrapper for token-stage failures', async () => {
    const logger = createLogger()

    const ok = await cloudflaredRunSetup(paths, {
      hasToken: () => false,
      logger,
      promptPassword: async () => {
        throw new Error('cancelled')
      },
    })

    expect(ok).toBe(false)
    expect(logger.messages).toEqual([
      'info:Get a token at dash.cloudflare.com → Zero Trust → Networks → Connectors,',
      'info:then create a tunnel and copy the install command or token.',
      'warning:tunnel token setup skipped: read tunnel token input: cancelled',
    ])
  })
})
