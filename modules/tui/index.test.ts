import { describe, expect, test } from 'bun:test'
import {
  promptConfirm,
  promptString,
  readPemBlock,
  tuiIsInteractive,
  tuiPromptConfirm,
  tuiPromptString,
  tuiReadPemBlock,
} from './index.ts'

describe('index exports', () => {
  test('keeps the prefixed exports and compatibility aliases aligned', () => {
    expect(tuiIsInteractive).toBeDefined()
    expect(tuiPromptString).toBe(promptString)
    expect(tuiPromptConfirm).toBe(promptConfirm)
    expect(tuiReadPemBlock).toBe(readPemBlock)
  })
})
