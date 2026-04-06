import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface AppSecretStatus {
  app: string
  exists: boolean
  path: string
}

const FILE_MODE = 0o600
const DIR_MODE = 0o700

function envFileName(name?: string): string {
  return name && name !== '' ? name : '.env'
}

/** Parse a .env file into ordered key-value pairs, preserving comments. */
function parseEnv(content: string): { lines: string[]; entries: Map<string, number> } {
  const lines = content.split('\n')
  const entries = new Map<string, number>()
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? ''
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq > 0) entries.set(trimmed.slice(0, eq), i)
  }
  return { lines, entries }
}

/**
 * Owns the `<secretsDir>/<app>/<envFile>` layout. Every write enforces
 * `0600` on the file and `0700` on the containing dir — losing that is how
 * secrets leak.
 */
export class SecretsManager {
  constructor(private readonly dir: string) {}

  envPath(app: string, envFile?: string): string {
    return join(this.dir, app, envFileName(envFile))
  }

  private async ensureAppDir(app: string): Promise<string> {
    const appDir = join(this.dir, app)
    await mkdir(appDir, { recursive: true, mode: DIR_MODE })
    await chmod(appDir, DIR_MODE)
    return appDir
  }

  private async writeSecure(path: string, content: string): Promise<void> {
    await writeFile(path, content, { mode: FILE_MODE })
    await chmod(path, FILE_MODE)
  }

  /** Insert or update a single KEY=VALUE in the app's env file. */
  async upsert(app: string, key: string, value: string, envFile?: string): Promise<void> {
    await this.ensureAppDir(app)
    const path = this.envPath(app, envFile)
    let content = ''
    try {
      content = await readFile(path, 'utf8')
    } catch {
      // file doesn't exist yet
    }
    const { lines, entries } = parseEnv(content)
    const line = `${key}=${value}`
    const idx = entries.get(key)
    if (idx !== undefined) {
      lines[idx] = line
    } else {
      // append, ensuring we don't double-newline
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines[lines.length - 1] = line
        lines.push('')
      } else {
        lines.push(line)
      }
    }
    await this.writeSecure(path, lines.join('\n'))
  }

  /** Remove a key from the app's env file. Returns true if the key existed. */
  async remove(app: string, key: string, envFile?: string): Promise<boolean> {
    const path = this.envPath(app, envFile)
    let content: string
    try {
      content = await readFile(path, 'utf8')
    } catch {
      return false
    }
    const { lines, entries } = parseEnv(content)
    const idx = entries.get(key)
    if (idx === undefined) return false
    lines.splice(idx, 1)
    await this.writeSecure(path, lines.join('\n'))
    return true
  }

  async check(app: string, envFile?: string): Promise<AppSecretStatus> {
    const path = this.envPath(app, envFile)
    try {
      await stat(path)
      return { app, exists: true, path }
    } catch {
      return { app, exists: false, path }
    }
  }

  async readMasked(app: string, envFile?: string): Promise<{ key: string; masked: string }[]> {
    const path = this.envPath(app, envFile)
    const content = await readFile(path, 'utf8')
    return content
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((line) => {
        const eq = line.indexOf('=')
        if (eq === -1) return { key: line.trim(), masked: '***' }
        const key = line.slice(0, eq)
        const val = line.slice(eq + 1)
        const visible = val.length >= 3 ? val.slice(0, 3) : ''
        return { key, masked: `${visible}***` }
      })
  }
}
