import * as clack from '@clack/prompts'
import { ValidationError } from '@jib/core'
import { assertInteractive } from './interactive.ts'

export { intro, outro, spinner } from '@clack/prompts'

type StrOpts = { message: string; placeholder?: string; initialValue?: string }
type IntOpts = { message: string; initialValue?: number; min?: number; max?: number }
type SelectOpts<T extends string> = {
  message: string
  options: { value: T; label: string; hint?: string }[]
  initialValue?: T
}
type ConfirmOpts = { message: string; initialValue?: boolean }

function unwrap<T>(value: T | symbol): T {
  if (clack.isCancel(value)) throw new ValidationError('cancelled')
  return value as T
}

/**
 * Strip keys whose value is `undefined`. Needed because clack is compiled
 * under `exactOptionalPropertyTypes`, so explicit `undefined` fails type
 * checks even though the underlying field is optional.
 */
// biome-ignore lint/suspicious/noExplicitAny: intentionally opaque to callers
function clean<T extends Record<string, any>>(obj: T): any {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out
}

export async function promptString(opts: StrOpts): Promise<string> {
  assertInteractive()
  return unwrap(
    await clack.text(
      clean({
        message: opts.message,
        placeholder: opts.placeholder,
        initialValue: opts.initialValue,
        validate: (v: string) => (v.length === 0 ? 'value required' : undefined),
      }),
    ),
  )
}

export async function promptStringOptional(opts: StrOpts): Promise<string> {
  assertInteractive()
  return unwrap(
    await clack.text(
      clean({
        message: opts.message,
        placeholder: opts.placeholder,
        initialValue: opts.initialValue,
      }),
    ),
  )
}

export async function promptInt(opts: IntOpts): Promise<number> {
  assertInteractive()
  const res = await clack.text(
    clean({
      message: opts.message,
      initialValue: opts.initialValue?.toString(),
      validate: (v: string) => {
        const n = Number(v)
        if (!Number.isInteger(n)) return 'must be an integer'
        if (opts.min !== undefined && n < opts.min) return `must be ≥ ${opts.min}`
        if (opts.max !== undefined && n > opts.max) return `must be ≤ ${opts.max}`
        return undefined
      },
    }),
  )
  return Number(unwrap(res))
}

export async function promptPassword(opts: { message: string }): Promise<string> {
  assertInteractive()
  return unwrap(await clack.password({ message: opts.message }))
}

export async function promptSelect<T extends string>(opts: SelectOpts<T>): Promise<T> {
  assertInteractive()
  return unwrap(
    await clack.select<T>(
      clean({
        message: opts.message,
        options: opts.options.map((o) => clean(o)),
        initialValue: opts.initialValue,
      }),
    ),
  )
}

export async function promptMultiSelect<T extends string>(opts: SelectOpts<T>): Promise<T[]> {
  assertInteractive()
  return unwrap(
    await clack.multiselect<T>({
      message: opts.message,
      options: opts.options.map((o) => clean(o)),
      required: false,
    }),
  )
}

export async function promptConfirm(opts: ConfirmOpts): Promise<boolean> {
  assertInteractive()
  return unwrap(
    await clack.confirm(clean({ message: opts.message, initialValue: opts.initialValue })),
  )
}

/**
 * Multiline PEM paste. Clack has no native multiline widget, so we collect
 * lines until an empty line terminates the block.
 */
export async function promptPEM(opts: { message: string }): Promise<string> {
  assertInteractive()
  clack.log.info(`${opts.message} (end with blank line)`)
  const lines: string[] = []
  while (true) {
    const line = unwrap(await clack.text({ message: '' }))
    if (line === '') break
    lines.push(line)
  }
  return lines.join('\n')
}
