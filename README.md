# jib

## Install

```sh
npm install -g deployjib
```

This installs the `jib` CLI.

## Update

```sh
jib update
```

## Releases

<!-- Preset v9 is intentional: v10 needs a newer writer than semantic-release currently ships. -->

Pushes to `main` release automatically after lint, typecheck, and build pass. Version bumps use Conventional Commits:

- `fix:` or `perf:` → patch
- `feat:` → minor
- `!` after the type/scope (e.g. `feat!:` or `fix(cli)!:`), or a `BREAKING CHANGE:` footer → major

The highest bump among commits since the last release wins. Other commits, such as `docs:`, `chore:`, or `ci:`, do not trigger a release unless they declare a breaking change.

semantic-release publishes to npm using the existing trusted publisher for `release.yml`, then creates a matching GitHub release. Version tags are created automatically; pushing a tag does not publish anything. The package version is set only in CI, and `prepack` rebuilds the CLI with that version.
