import { existsSync } from 'node:fs'
import { JibError } from '@jib/core'
import { type DockerExec, type ExecResult, realExec } from './exec.ts'

export interface ComposeConfig {
  app: string
  dir: string
  files: string[]
  envFile?: string
  override?: string
  /** Injected exec, defaults to Bun.$ — tests pass a stub. */
  exec?: DockerExec
}

export interface UpOptions {
  services?: string[]
  buildArgs?: Record<string, string>
}

/**
 * Thin wrapper around `docker compose` mirroring the Go implementation. All
 * shell-outs go through `exec` so tests can stub the subprocess layer without
 * touching real docker.
 */
export class Compose {
  private readonly runner: DockerExec

  constructor(readonly cfg: ComposeConfig) {
    this.runner = cfg.exec ?? realExec
  }

  projectName(): string {
    return `jib-${this.cfg.app}`
  }

  /** `compose -p jib-<app> -f file1 -f file2 [-f override]` shared prefix. */
  baseArgs(): string[] {
    const args = ['compose', '-p', this.projectName()]
    for (const f of this.cfg.files) args.push('-f', f)
    if (this.cfg.override && existsSync(this.cfg.override)) {
      args.push('-f', this.cfg.override)
    }
    return args
  }

  private envArgs(): string[] {
    return this.cfg.envFile ? ['--env-file', this.cfg.envFile] : []
  }

  async build(buildArgs: Record<string, string> = {}): Promise<void> {
    const args = ['docker', ...this.baseArgs(), ...this.envArgs(), 'build']
    await this.runOrThrow(args, { env: buildArgs })
  }

  async up(opts: UpOptions = {}): Promise<void> {
    const args = [
      'docker',
      ...this.baseArgs(),
      ...this.envArgs(),
      'up',
      '-d',
      '--force-recreate',
      '--remove-orphans',
      ...(opts.services ?? []),
    ]
    await this.runOrThrow(args, opts.buildArgs ? { env: opts.buildArgs } : {})
  }

  async down(removeVolumes = false): Promise<void> {
    const args = ['docker', ...this.baseArgs(), 'down']
    if (removeVolumes) args.push('-v')
    await this.runOrThrow(args)
  }

  async restart(services: string[] = []): Promise<void> {
    await this.runOrThrow(['docker', ...this.baseArgs(), 'restart', ...services])
  }

  async exec(service: string, cmd: string[]): Promise<void> {
    await this.runOrThrow(['docker', ...this.baseArgs(), 'exec', service, ...cmd])
  }

  async run(service: string, cmd: string[]): Promise<void> {
    await this.runOrThrow([
      'docker',
      ...this.baseArgs(),
      ...this.envArgs(),
      'run',
      '--rm',
      service,
      ...cmd,
    ])
  }

  async logs(service?: string, opts: { follow?: boolean; tail?: number } = {}): Promise<void> {
    const args = ['docker', ...this.baseArgs(), 'logs']
    if (opts.follow) args.push('-f')
    if (opts.tail && opts.tail > 0) args.push('--tail', String(opts.tail))
    if (service) args.push(service)
    await this.runOrThrow(args)
  }

  async ps(): Promise<ExecResult> {
    return this.capture(['docker', ...this.baseArgs(), 'ps', '--format', 'json'])
  }

  private async runOrThrow(
    args: string[],
    opts: { env?: Record<string, string> } = {},
  ): Promise<void> {
    const callOpts: Parameters<DockerExec>[1] = { cwd: this.cfg.dir }
    if (opts.env) callOpts.env = opts.env
    const res = await this.runner(args, callOpts)
    if (res.exitCode !== 0) {
      throw new JibError(
        'docker',
        `${args.slice(0, 4).join(' ')} exited ${res.exitCode}: ${res.stderr}`,
      )
    }
  }

  private async capture(args: string[]): Promise<ExecResult> {
    const res = await this.runner(args, { cwd: this.cfg.dir, capture: true })
    if (res.exitCode !== 0) {
      throw new JibError(
        'docker',
        `${args.slice(0, 4).join(' ')} exited ${res.exitCode}: ${res.stderr}`,
      )
    }
    return res
  }
}
