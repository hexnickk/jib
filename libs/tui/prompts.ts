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

/**
 * Runs `fn` (a thin clack call) under interactive-mode guard and unwraps
 * clack's cancel symbol into a `ValidationError`. Every wrapper in this file
 * delegates here so the interactive/cancel/return shape lives in one place.
 */
async function ask<T>(fn: () => Promise<T | symbol>): Promise<T> {
  assertInteractive()
  const value = await fn()
  if (clack.isCancel(value)) throw new ValidationError('cancelled')
  return value as T
}

/**
 * Drop `hint: undefined` so clack (compiled under `exactOptionalPropertyTypes`)
 * accepts the literal. Centralized so every select/multiselect call stays typed.
 */
function mapOptions<T extends string>(
  options: SelectOpts<T>['options'],
): { value: T; label: string }[] {
  return options.map((o) =>
    o.hint !== undefined
      ? ({ value: o.value, label: o.label, hint: o.hint } as { value: T; label: string })
      : { value: o.value, label: o.label },
  )
}

export function promptString(opts: StrOpts): Promise<string> {
  return ask(() =>
    clack.text({
      message: opts.message,
      ...(opts.placeholder !== undefined && { placeholder: opts.placeholder }),
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
      validate: (v: string) => (v.length === 0 ? 'value required' : undefined),
    }),
  )
}

export function promptStringOptional(opts: StrOpts): Promise<string> {
  return ask(() =>
    clack.text({
      message: opts.message,
      ...(opts.placeholder !== undefined && { placeholder: opts.placeholder }),
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
    }),
  )
}

export async function promptInt(opts: IntOpts): Promise<number> {
  const v = await ask(() =>
    clack.text({
      message: opts.message,
      ...(opts.initialValue !== undefined && { initialValue: String(opts.initialValue) }),
      validate: (s: string) => {
        const n = Number(s)
        if (!Number.isInteger(n)) return 'must be an integer'
        if (opts.min !== undefined && n < opts.min) return `must be >= ${opts.min}`
        if (opts.max !== undefined && n > opts.max) return `must be <= ${opts.max}`
        return undefined
      },
    }),
  )
  return Number(v)
}

export function promptPassword(opts: { message: string }): Promise<string> {
  return ask(() => clack.password({ message: opts.message }))
}

export function promptSelect<T extends string>(opts: SelectOpts<T>): Promise<T> {
  const options = mapOptions(opts.options) as Parameters<typeof clack.select<T>>[0]['options']
  return ask<T>(() =>
    clack.select<T>({
      message: opts.message,
      options,
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
    }),
  )
}

export function promptMultiSelect<T extends string>(opts: SelectOpts<T>): Promise<T[]> {
  const options = mapOptions(opts.options) as Parameters<typeof clack.multiselect<T>>[0]['options']
  return ask<T[]>(() => clack.multiselect<T>({ message: opts.message, options, required: false }))
}

export function promptConfirm(opts: ConfirmOpts): Promise<boolean> {
  return ask(() =>
    clack.confirm({
      message: opts.message,
      ...(opts.initialValue !== undefined && { initialValue: opts.initialValue }),
    }),
  )
}
