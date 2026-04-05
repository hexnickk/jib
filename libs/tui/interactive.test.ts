import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ValidationError } from '@jib/core'
import { assertInteractive, isInteractive } from './interactive.ts'

// biome-ignore lint/suspicious/noExplicitAny: test-only overrides of TTY flags
const stdin = process.stdin as any
// biome-ignore lint/suspicious/noExplicitAny: test-only overrides of TTY flags
const stdout = process.stdout as any

describe('isInteractive', () => {
  const envPrev = process.env.JIB_NON_INTERACTIVE
  const stdinPrev = stdin.isTTY
  const stdoutPrev = stdout.isTTY

  beforeEach(() => {
    process.env.JIB_NON_INTERACTIVE = undefined
  })
  afterEach(() => {
    process.env.JIB_NON_INTERACTIVE = envPrev
    stdin.isTTY = stdinPrev
    stdout.isTTY = stdoutPrev
  })

  test('false when JIB_NON_INTERACTIVE set', () => {
    process.env.JIB_NON_INTERACTIVE = '1'
    stdin.isTTY = true
    stdout.isTTY = true
    expect(isInteractive()).toBe(false)
  })

  test('false when stdin not a TTY', () => {
    stdin.isTTY = false
    stdout.isTTY = true
    expect(isInteractive()).toBe(false)
  })

  test('true when both TTYs and env unset', () => {
    stdin.isTTY = true
    stdout.isTTY = true
    expect(isInteractive()).toBe(true)
  })

  test('assertInteractive throws ValidationError in non-interactive mode', () => {
    process.env.JIB_NON_INTERACTIVE = '1'
    expect(() => assertInteractive()).toThrow(ValidationError)
  })
})
