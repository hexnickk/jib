import { afterEach, describe, expect, test } from 'bun:test'
import { LogLevels } from 'consola'

import { loggingCreateLogger } from './index'

const originalDebug = process.env.JIB_DEBUG

afterEach(() => {
  if (originalDebug === undefined) {
    Reflect.deleteProperty(process.env, 'JIB_DEBUG')
    return
  }

  process.env.JIB_DEBUG = originalDebug
})

describe('loggingCreateLogger', () => {
  test('defaults to warn when JIB_DEBUG is unset', () => {
    Reflect.deleteProperty(process.env, 'JIB_DEBUG')

    const logger = loggingCreateLogger('demo')

    expect(logger.level).toBe(LogLevels.warn)
  })

  test('enables debug for supported truthy JIB_DEBUG values', () => {
    for (const value of ['1', 'true', 'yes', 'on', 'TRUE']) {
      process.env.JIB_DEBUG = value

      const logger = loggingCreateLogger('demo')

      expect(logger.level).toBe(LogLevels.debug)
    }
  })
})
