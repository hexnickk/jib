import { JibError } from '@jib/errors'

export class PathLookupError extends JibError {
  constructor(path: string, options?: ErrorOptions) {
    super('path_lookup_failed', `failed to inspect path "${path}"`, options)
  }
}

export class EnsureCredsDirError extends JibError {
  constructor(kind: string, dir: string, options?: ErrorOptions) {
    super('ensure_creds_dir_failed', `failed to ensure creds dir "${kind}" at "${dir}"`, options)
  }
}
