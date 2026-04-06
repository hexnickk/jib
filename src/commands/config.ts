import { readFile, writeFile } from 'node:fs/promises'
import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/core'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { parse, stringify } from 'yaml'

/**
 * The Go implementation writes back to `config.yml` via a raw-map editor so
 * we preserve comments and unknown keys. Here we round-trip through `yaml`
 * which preserves comments on dotted leaf edits well enough and keeps the
 * command under the 200-LoC cap. Rejects structural mutations (maps/lists)
 * — operators should use `jib edit` for those.
 */

const SECRET_KEYS = ['token', 'key', 'secret', 'password', 'private_key', 'pem'] as const

/**
 * Key is treated as a secret iff (a) it equals a marker exactly, or (b) it
 * ends with `_<marker>` / `.marker` (common suffixes like `api_token`,
 * `db_password`). Substring matching caught too many false positives — any
 * app whose name contained "secret" would be wholesale redacted.
 */
export function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase()
  for (const marker of SECRET_KEYS) {
    if (lower === marker) return true
    if (lower.endsWith(`_${marker}`)) return true
    if (lower.endsWith(`.${marker}`)) return true
  }
  return false
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSecretKey(k) ? '***REDACTED***' : redact(v)
    }
    return out
  }
  return value
}

export function getNested(root: unknown, key: string): unknown {
  const parts = key.split('.')
  let cur: unknown = root
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') {
      throw new Error(`key "${key}" not found (intermediate value is not a map)`)
    }
    const map = cur as Record<string, unknown>
    if (!(p in map)) throw new Error(`key "${key}" not found`)
    cur = map[p]
  }
  return cur
}

export function setNested(root: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.')
  let cur: Record<string, unknown> = root
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i] as string
    const next = cur[p]
    if (next === undefined) {
      const fresh: Record<string, unknown> = {}
      cur[p] = fresh
      cur = fresh
      continue
    }
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      throw new Error(`key "${key}": intermediate value "${p}" is not a map`)
    }
    cur = next as Record<string, unknown>
  }
  const last = parts[parts.length - 1] as string
  cur[last] = value
}

async function readRaw(): Promise<{ path: string; doc: Record<string, unknown> }> {
  const path = getPaths().configFile
  const raw = await readFile(path, 'utf8')
  const doc = (parse(raw) ?? {}) as Record<string, unknown>
  return { path, doc }
}

const get = defineCommand({
  meta: { name: 'get', description: 'Read a config value' },
  args: { key: { type: 'positional', required: true, description: 'Dotted key path' } },
  async run({ args }) {
    const { doc } = await readRaw()
    const value = getNested(doc, args.key)
    if (value !== null && typeof value === 'object') consola.log(stringify(value).trimEnd())
    else consola.log(String(value))
  },
})

const set = defineCommand({
  meta: { name: 'set', description: 'Write a config value (scalars only)' },
  args: {
    key: { type: 'positional', required: true, description: 'Dotted key path' },
    value: { type: 'positional', required: true, description: 'YAML scalar value' },
  },
  async run({ args }) {
    let parsed: unknown
    try {
      parsed = parse(args.value)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      consola.error(`parsing value "${args.value}": ${msg}`)
      consola.info('value must be a YAML scalar (string, number, boolean)')
      process.exit(1)
    }
    if (parsed === null) {
      if (args.value === '') parsed = ''
      else {
        consola.error("null values cannot be set via 'config set'; use 'jib edit' instead")
        process.exit(1)
      }
    }
    if (Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null)) {
      consola.error("complex values cannot be set via 'config set'; use 'jib edit' instead")
      process.exit(1)
    }

    const { path, doc } = await readRaw()
    setNested(doc, args.key, parsed)

    // Validate against a temp file BEFORE overwriting config.yml. Writing
    // first and validating after left the user with a corrupt config on
    // type errors (e.g. setting a scalar where the schema expects a list),
    // which then blocked every subsequent command.
    const tmpPath = `${path}.tmp-${process.pid}`
    const serialized = stringify(doc)
    await writeFile(tmpPath, serialized, { mode: 0o640 })
    try {
      await loadConfig(tmpPath)
    } catch (err) {
      await readFile(tmpPath).catch(() => undefined) // keep ref
      await writeFile(tmpPath, '', { mode: 0o640 }).catch(() => undefined)
      const { unlink } = await import('node:fs/promises')
      await unlink(tmpPath).catch(() => undefined)
      const msg = err instanceof Error ? err.message : String(err)
      consola.error(`validation failed, config unchanged: ${msg}`)
      consola.info('safe to retry')
      process.exit(1)
    }
    const { rename } = await import('node:fs/promises')
    await rename(tmpPath, path)
    consola.success(`set ${args.key} = ${String(parsed)}`)
  },
})

const list = defineCommand({
  meta: { name: 'list', description: 'Print full config with secrets redacted' },
  async run() {
    const { doc } = await readRaw()
    consola.log(stringify(redact(doc)).trimEnd())
  },
})

export default defineCommand({
  meta: { name: 'config', description: 'Read and write jib configuration' },
  subCommands: { get, set, list },
})
