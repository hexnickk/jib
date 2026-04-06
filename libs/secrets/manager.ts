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

/**
 * Owns the `<secretsDir>/<app>/<envFile>` layout. Every write enforces
 * `0600` on the file and `0700` on the containing dir — losing that is how
 * secrets leak.
 */
export class SecretsManager {
  constructor(private readonly dir: string) {}

  symlinkPath(app: string, envFile?: string): string {
    return join(this.dir, app, envFileName(envFile))
  }

  private async ensureAppDir(app: string): Promise<string> {
    const appDir = join(this.dir, app)
    await mkdir(appDir, { recursive: true, mode: DIR_MODE })
    await chmod(appDir, DIR_MODE)
    return appDir
  }

  /**
   * Copies `sourceFile` into the app's secrets dir under `envFile`. The
   * destination is written with `mode: 0600` up front — we deliberately do
   * not use `copyFile` because it creates the target with the default umask
   * first, leaving a brief window where the secret is world-readable.
   */
  async set(app: string, sourceFile: string, envFile?: string): Promise<string> {
    const appDir = await this.ensureAppDir(app)
    const dst = join(appDir, envFileName(envFile))
    const data = await readFile(sourceFile)
    await writeFile(dst, data, { mode: FILE_MODE })
    // `writeFile`'s mode only applies when it creates the file; on overwrite
    // it preserves the existing mode. Belt and braces.
    await chmod(dst, FILE_MODE)
    return dst
  }

  async check(app: string, envFile?: string): Promise<AppSecretStatus> {
    const path = this.symlinkPath(app, envFile)
    try {
      await stat(path)
      return { app, exists: true, path }
    } catch {
      return { app, exists: false, path }
    }
  }

  async readMasked(app: string, envFile?: string): Promise<{ key: string; masked: string }[]> {
    const path = this.symlinkPath(app, envFile)
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
