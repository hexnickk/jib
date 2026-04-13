import { describe, expect, test } from 'bun:test'
import { CloudflaredSaveTunnelTokenError } from '@jib-module/cloudflared'
import { pathsGetPaths } from '@jib/paths'
import {
  CloudflaredSetupPromptError,
  CloudflaredSetupSaveTokenError,
  CloudflaredStartError,
} from './errors.ts'
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

    expect(result).toBeInstanceOf(CloudflaredSetupPromptError)
    if (result instanceof CloudflaredSetupPromptError) {
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
    expect(logger.messages).toEqual([])
  })

  test('returns typed save errors when token persistence fails', async () => {
    const result = await cloudflaredRunSetupResult(paths, {
      hasToken: () => false,
      logger: createLogger(),
      promptPassword: async () => 'eyJhIjoiNzQ',
      saveToken: async () => new CloudflaredSaveTunnelTokenError('disk full'),
    })

    expect(result).toBeInstanceOf(CloudflaredSetupSaveTokenError)
    if (result instanceof CloudflaredSetupSaveTokenError) {
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

    expect(result).toBeInstanceOf(CloudflaredStartError)
    if (result instanceof CloudflaredStartError) {
      expect(result.detail).toBe('permission denied')
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
      'info:Create a tunnel at dash.cloudflare.com → Zero Trust → Tunnels,',
      'info:then paste the install command or just the token.',
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
      'warning:tunnel token setup skipped: failed to confirm tunnel token replacement: cancelled',
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
      'info:Create a tunnel at dash.cloudflare.com → Zero Trust → Tunnels,',
      'info:then paste the install command or just the token.',
      'warning:tunnel token setup skipped: failed to read tunnel token input: cancelled',
    ])
  })
})
