import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { ComposeService } from '@jib/docker'

function service(partial: Partial<ComposeService> = {}): ComposeService {
  return {
    name: 'web',
    ports: [],
    expose: [],
    envRefs: [],
    buildArgRefs: [],
    ...partial,
  }
}

afterEach(() => {
  mock.restore()
})

describe('addPromptForServices', () => {
  test('lets detected compose env values be left blank', async () => {
    const optionalPrompts: string[] = []
    mock.module('@jib/tui', () => ({
      tuiIsInteractive: () => true,
      tuiNote: () => undefined,
      tuiPromptConfirmResult: async (opts: { message: string }) =>
        opts.message.startsWith('Use these placements'),
      tuiPromptLinesResult: async () => [],
      tuiPromptSelectResult: async () => 'runtime',
      tuiPromptStringOptionalResult: async (opts: { message: string }) => {
        optionalPrompts.push(opts.message)
        return ''
      },
      tuiPromptStringResult: async () => new Error('domain prompt should not run'),
    }))
    const { addPromptForServices } = await import('./service-prompts.ts')

    const result = await addPromptForServices(
      [],
      [service({ envRefs: ['TELEGRAM_BOT_TOKEN'] })],
      [],
    )

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(optionalPrompts).toEqual([
      'Value for TELEGRAM_BOT_TOKEN (optional, leave blank to skip)',
    ])
    expect(result[0]?.configEntries).toEqual([])
  })
})
