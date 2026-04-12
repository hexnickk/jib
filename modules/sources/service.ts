import { mkdir, rm } from 'node:fs/promises'
import type { App, Config } from '@jib/config'
import { type Paths, dockerHubImage, pathExists, repoPath } from '@jib/paths'
import { ensureCheckout, sourceErrorOptions } from './checkout.ts'
import {
  SourceLocalCheckoutError,
  SourceLocalRepoError,
  SourceMissingAppError,
  SourceProbeError,
  SourceRemoteResolveError,
  SourceRemoteSyncError,
  SourceWorkdirPrepareError,
} from './errors.ts'
import * as git from './git.ts'
import { resolveSourceDriverResult } from './registry.ts'
import type {
  InspectionCheckout,
  PreparedSource,
  ProbeSourceDeps,
  ResolvedSource,
  SourceProbe,
  SourceTarget,
} from './types.ts'

/**
 * Resolves the app config for a source operation, synthesizing a temporary app
 * when callers pass `repo` directly for a not-yet-configured app.
 */
function resolveTargetApp(cfg: Config, target: SourceTarget): App | SourceMissingAppError {
  const existing = cfg.apps[target.app]
  if (existing) return existing
  if (!target.repo) return new SourceMissingAppError(target.app)
  const image = dockerHubImage(target.repo)
  return {
    repo: image ? 'local' : target.repo,
    branch: target.branch ?? 'main',
    domains: [],
    env_file: '.env',
    ...(image ? { image } : {}),
    ...(target.source ? { source: target.source } : {}),
  }
}

/** Resolves remote metadata for a source target without creating a checkout. */
export async function sourcesResolve(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
  ref?: string,
): Promise<ResolvedSource | Error> {
  const existing = cfg.apps[target.app]
  const app = resolveTargetApp(cfg, target)
  if (app instanceof Error) return app
  if (app.repo === 'local') return new SourceLocalRepoError(target.app)
  const workdir = repoPath(paths, target.app, app.repo)
  const driver = resolveSourceDriverResult(cfg, app)
  if (driver instanceof Error) return driver

  try {
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
  } catch (error) {
    return new SourceRemoteResolveError(target.app, sourceErrorOptions(error))
  }
}

/** Ensures the local workdir is ready for inspection or deploy and returns the pinned SHA. */
export async function sourcesSync(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
  ref?: string,
): Promise<PreparedSource | Error> {
  const app = resolveTargetApp(cfg, target)
  if (app instanceof Error) return app

  if (app.image) {
    const workdir = repoPath(paths, target.app, app.repo)
    try {
      await mkdir(workdir, { recursive: true, mode: 0o750 })
    } catch (error) {
      return new SourceWorkdirPrepareError(target.app, workdir, sourceErrorOptions(error))
    }
    return { workdir, sha: app.image }
  }

  if (app.repo === 'local') {
    const workdir = repoPath(paths, target.app, app.repo)
    try {
      if (!(await pathExists(workdir)) || !(await git.isRepo(workdir))) {
        return new SourceLocalCheckoutError(target.app, workdir)
      }
      await git.checkout(workdir, ref ?? app.branch)
      return { workdir, sha: await git.currentSHA(workdir) }
    } catch (error) {
      return new SourceLocalCheckoutError(target.app, workdir, sourceErrorOptions(error))
    }
  }

  const source = await sourcesResolve(cfg, paths, target, ref)
  if (source instanceof Error) return source

  try {
    await ensureCheckout(source.workdir, source.url, source.branch, source.env)
    await source.applyAuth(source.workdir)
    await git.fetch(source.workdir, source.ref, source.env)
    const sha = await git.fetchedSHA(source.workdir)
    await git.checkout(source.workdir, sha)
    return { workdir: source.workdir, sha }
  } catch (error) {
    return new SourceRemoteSyncError(target.app, source.ref, sourceErrorOptions(error))
  }
}

/** Prepares a checkout for compose inspection and returns the inspection workdir. */
export async function sourcesCloneForInspection(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
): Promise<InspectionCheckout | Error> {
  const prepared = await sourcesSync(cfg, paths, target)
  if (prepared instanceof Error) return prepared
  return { workdir: prepared.workdir }
}

/** Resolves the remote SHA for a source target without mutating the local checkout. */
export async function sourcesProbe(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
  deps: ProbeSourceDeps = {},
): Promise<SourceProbe | Error | null> {
  const app = resolveTargetApp(cfg, target)
  if (app instanceof Error) return app
  if (app.repo === 'local') return null

  const source = await sourcesResolve(cfg, paths, target)
  if (source instanceof Error) return source
  const lsRemote = deps.lsRemote ?? git.lsRemote

  try {
    const sha = await lsRemote(source.url, source.ref, source.env)
    return sha ? { branch: source.branch, workdir: source.workdir, sha } : null
  } catch (error) {
    return new SourceProbeError(target.app, source.ref, sourceErrorOptions(error))
  }
}

export async function sourcesRemoveCheckout(
  paths: Paths,
  app: string,
  repo: string,
): Promise<void> {
  const workdir = repoPath(paths, app, repo)
  await rm(workdir, { recursive: true, force: true })
}
