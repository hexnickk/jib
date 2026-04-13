import { mkdir, rm } from 'node:fs/promises'
import type { App, Config } from '@jib/config'
import { type Paths, dockerHubImage, repoPath } from '@jib/paths'
import { sourcesErrorOptions } from './checkout.ts'
import {
  SourceLocalRepoError,
  SourceMissingAppError,
  SourceProbeError,
  SourceRemoteResolveError,
  SourceWorkdirPrepareError,
} from './errors.ts'
import * as git from './git.ts'
import { resolveSourceDriverResult } from './registry.ts'
import { sourcesSyncLocalCheckout, sourcesSyncRemoteCheckout } from './sync.ts'
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

  const remote = await driver.resolve(cfg, app, paths)
  if (remote instanceof Error) {
    return new SourceRemoteResolveError(target.app, sourcesErrorOptions(remote))
  }

  const defaultBranch =
    target.branch || existing?.branch
      ? undefined
      : await git.sourcesGitDefaultBranch(remote.url, remote.env)
  if (defaultBranch instanceof Error) {
    return new SourceRemoteResolveError(target.app, sourcesErrorOptions(defaultBranch))
  }

  const branch = target.branch ?? existing?.branch ?? defaultBranch ?? app.branch
  return {
    app: app.branch === branch ? app : { ...app, branch },
    branch,
    ref: ref ?? branch,
    workdir,
    ...remote,
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
      return new SourceWorkdirPrepareError(target.app, workdir, sourcesErrorOptions(error))
    }
    return { workdir, sha: app.image }
  }

  if (app.repo === 'local') {
    return sourcesSyncLocalCheckout(
      target.app,
      repoPath(paths, target.app, app.repo),
      ref ?? app.branch,
    )
  }

  const source = await sourcesResolve(cfg, paths, target, ref)
  if (source instanceof Error) return source
  return sourcesSyncRemoteCheckout(target.app, source)
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
  const lsRemote = deps.lsRemote ?? git.sourcesGitLsRemote

  try {
    const sha = await lsRemote(source.url, source.ref, source.env)
    if (sha instanceof Error) {
      return new SourceProbeError(target.app, source.ref, sourcesErrorOptions(sha))
    }
    return sha ? { branch: source.branch, workdir: source.workdir, sha } : null
  } catch (error) {
    return new SourceProbeError(target.app, source.ref, sourcesErrorOptions(error))
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
