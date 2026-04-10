import { rm } from 'node:fs/promises'
import type { App, Config } from '@jib/config'
import { JibError, type Paths, pathExists, repoPath } from '@jib/core'
import * as git from './git.ts'
import { resolveSourceDriver } from './registry.ts'
import type {
  InspectionCheckout,
  PreparedSource,
  ProbeSourceDeps,
  ResolvedSource,
  SourceProbe,
  SourceTarget,
} from './types.ts'

function resolveApp(cfg: Config, target: SourceTarget): App {
  const existing = cfg.apps[target.app]
  if (existing) return existing
  if (!target.repo) throw new Error(`app "${target.app}" not found in config`)
  return {
    repo: target.repo,
    branch: target.branch ?? 'main',
    domains: [],
    env_file: '.env',
    ...(target.source ? { source: target.source } : {}),
  }
}

export async function resolve(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
  ref?: string,
): Promise<ResolvedSource> {
  const existing = cfg.apps[target.app]
  const app = resolveApp(cfg, target)
  if (app.repo === 'local') {
    throw new Error(`app "${target.app}" uses a local repo and has no remote source`)
  }
  const workdir = repoPath(paths, target.app, app.repo)
  const driver = resolveSourceDriver(cfg, app)
  const remote = await driver.resolve(cfg, app, paths)
  const branch =
    target.branch ??
    existing?.branch ??
    (await git.defaultBranch(remote.url, remote.env)) ??
    app.branch
  return {
    app: app.branch === branch ? app : { ...app, branch },
    branch,
    ref: ref ?? branch,
    workdir,
    ...remote,
  }
}

export async function syncApp(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
  ref?: string,
): Promise<PreparedSource> {
  const app = resolveApp(cfg, target)
  if (app.repo === 'local') {
    const workdir = repoPath(paths, target.app, app.repo)
    if (!(await pathExists(workdir)) || !(await git.isRepo(workdir))) {
      throw new JibError('git', `local repo missing at ${workdir}`)
    }
    await git.checkout(workdir, ref ?? app.branch)
    return { workdir, sha: await git.currentSHA(workdir) }
  }

  const source = await resolve(cfg, paths, target, ref)
  await ensureCheckout(source.workdir, source.url, source.branch, source.env)
  await source.applyAuth(source.workdir)
  await git.fetch(source.workdir, source.ref, source.env)
  const sha = await git.fetchedSHA(source.workdir)
  await git.checkout(source.workdir, sha)
  return { workdir: source.workdir, sha }
}

export async function cloneForInspection(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
): Promise<InspectionCheckout> {
  const prepared = await syncApp(cfg, paths, target)
  return { workdir: prepared.workdir }
}

export async function probe(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
  deps: ProbeSourceDeps = {},
): Promise<SourceProbe | null> {
  const app = resolveApp(cfg, target)
  if (app.repo === 'local') return null
  const source = await resolve(cfg, paths, target)
  const lsRemote = deps.lsRemote ?? git.lsRemote
  const sha = await lsRemote(source.url, source.ref, source.env)
  return sha ? { branch: source.branch, workdir: source.workdir, sha } : null
}

export async function removeCheckout(paths: Paths, app: string, repo: string): Promise<void> {
  const workdir = repoPath(paths, app, repo)
  await rm(workdir, { recursive: true, force: true })
}

async function ensureCheckout(
  workdir: string,
  url: string,
  branch: string,
  env: git.GitEnv,
): Promise<void> {
  if (await pathExists(workdir)) {
    const [repoReady, hasRemote] = await Promise.all([git.isRepo(workdir), git.hasRemote(workdir)])
    if (!repoReady || !hasRemote) {
      await rm(workdir, { recursive: true, force: true })
    }
  }

  if (!(await pathExists(workdir))) {
    try {
      await git.clone(url, workdir, { branch, env })
    } catch (error) {
      await rm(workdir, { recursive: true, force: true })
      throw error
    }
    return
  }

  await git.setRemoteURL(workdir, url)
}
