export interface AddCommandArgv {
  app?: string
  source?: string
  branch?: string
  repo?: string
  backend?: string
  ingress?: string
  compose?: string
  persist?: string | string[]
  domain?: string | string[]
  env?: string | string[]
  'build-arg'?: string | string[]
  'build-env'?: string | string[]
  health?: string | string[]
}

export const addCommandOptions = {
  repo: {
    type: 'string',
    description:
      'Git repo, Docker Hub repo, or local path: "owner/name", docker://image, Docker Hub URL, "local", file:// URL, http(s):// URL, or absolute path',
  },
  backend: {
    type: 'string',
    description: 'Interpret owner/name shorthand as github|dockerhub|other',
  },
  source: { type: 'string', description: 'Configured source ref name' },
  branch: { type: 'string', description: 'Git branch to track (defaults to the repo default)' },
  ingress: {
    type: 'string',
    default: 'direct',
    description: 'Default ingress: direct|cloudflare-tunnel',
  },
  compose: { type: 'string', description: 'Compose file (comma-separated)' },
  persist: {
    type: 'string',
    description: 'Container path to persist via named volume (repeatable, comma-separated)',
  },
  domain: {
    type: 'string',
    description:
      'host=<domain>[,port=<port>][,service=<name>][,ingress=direct|cloudflare-tunnel] (repeatable)',
  },
  env: { type: 'string', description: 'KEY=VALUE runtime env (.env) (repeatable)' },
  'build-arg': { type: 'string', description: 'KEY=VALUE build arg (app.build_args) (repeatable)' },
  'build-env': {
    type: 'string',
    description: 'KEY=VALUE for both runtime .env and app.build_args (repeatable)',
  },
  health: { type: 'string', description: '/path:port (repeatable via comma)' },
} as const
