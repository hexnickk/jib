import { describe, expect, test } from 'bun:test'
import {
  tuiIsInteractive,
  tuiPromptConfirmResult,
  tuiPromptStringResult,
  tuiReadPemBlockResult,
} from './index.ts'

describe('index exports', () => {
  test('exposes the prefixed result-style APIs', () => {
    expect(tuiIsInteractive).toBeDefined()
    expect(tuiPromptStringResult).toBeDefined()
    expect(tuiPromptConfirmResult).toBeDefined()
    expect(tuiReadPemBlockResult).toBeDefined()
  })
})
