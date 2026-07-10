# Architecture Review and Simplification Plan

## Status

Discussion and sequencing document. Implementation still requires explicit approval for each finding. Finding 1 was approved and implemented on 2026-07-09.

Reviewed on 2026-07-09 for a solo maintainer working with coding agents. The primary goals are reliable changes, explicit behavior, and a single source of truth. Future extensibility is secondary unless the product already has more than one real mode or implementation.

## Product model to preserve

Jib deploys simple applications that follow a consistent structure.

Current product capabilities that are real and should remain explicit:

- Git, local, and Docker image application sources.
- Docker Compose inspection and execution.
- nginx as the current reverse proxy.
- Direct VPS ingress and Cloudflare Tunnel ingress as two route exposure modes.
- Managed app environment files.
- Optional Cloudflare Tunnel daemon setup.
- Git polling and automatic deployment.

Possible future capabilities such as Caddy, GitLab, or additional providers should not drive abstractions until implementation begins.

## Review summary

The implementation is generally disciplined:

- TypeScript is strict.
- Config, state, and generated override writes are mostly atomic.
- Concrete Docker, nginx, GitHub, filesystem, and systemd behavior is tested.
- Modules generally avoid side effects during import.
- The current branch passes tests, typechecking, and linting.

The main architectural problem is not code quality within individual functions. It is that lifecycle policy and persisted-state ownership are spread across too many layers. An agent can make a locally valid change without seeing all other representations of the same concept.

At review time, excluding tests, the codebase has approximately:

- 196 TypeScript implementation files.
- 12,900 implementation lines.
- 103 exported interfaces.
- 134 exported error subclasses.
- 656 exported declarations.
- 24 implementation files in `src/flows/add/` alone.
- One import cycle between add steps and mutation steps.

Commit `cbdc159` had to touch 47 files to move app values to one managed env file. That is a concrete sign that a single policy was leaking across too many boundaries.

## Intended target shape

Prefer three conceptual levels:

1. **CLI commands**
   - Parse arguments.
   - Invoke a use case.
   - Render output or one final error.
2. **Explicit use-case flows**
   - Add, deploy, remove, and init orchestration.
   - Ordering, invariants, and compensation visible together.
3. **Concrete adapters**
   - Config and env files.
   - Git and GitHub.
   - Docker Compose.
   - nginx.
   - cloudflared and systemd.

Do not add planner objects, support objects, generic provider registries, or generic transaction machinery unless there is a current need that simpler functions cannot serve.

## Proposed authoritative state model

This model must be agreed before broad refactoring.

| Artifact | Authority | Intended contents |
| --- | --- | --- |
| `config.yml` | Desired application configuration | Apps, source references, routes, compose files, health checks, and enabled host capabilities |
| `secrets/<app>/.env` | App environment values | The only Jib-managed store for app-provided runtime/build interpolation values |
| Repository Compose files | User-owned deployment input | Services, build args, environment mappings, volumes, and app-specific Compose behavior |
| Managed Compose override | Derived artifact | Ports, labels, restart policy, and logging policy; always regenerable |
| Managed nginx config | Derived artifact | Routes derived from app domains; always regenerable |
| App state JSON | Observed operational state | Last deployment SHA, workdir, status, and error; never desired config |
| Cloudflare credential file | Cloudflare secret | Tunnel token only |
| Migration ledger | Installation history | Applied migration IDs only |

A datum should not be independently editable in more than one artifact. Derived artifacts must be reproducible from authoritative state.

---

# Findings and discussion order

Each finding below is intended to be discussed and approved separately.

## Finding 1: Cloudflare Tunnel has conflicting authorities

**Priority:** Critical
**Status:** Implemented on 2026-07-09
**Recommended first item**

### Evidence

Cloudflare state is currently represented in three places:

- The tunnel token is written by `cloudflaredSaveTunnelToken()` in `src/modules/cloudflared/service.ts`.
- Enablement is stored as `config.modules.cloudflared` by the init flow.
- `cloudflaredReadStatus()` in `src/modules/cloudflared/status.ts` reads only `config.tunnel`.
- `configValidate()` in `src/modules/config/validate.ts` requires `config.tunnel` when any route uses `cloudflare-tunnel`.
- No production flow writes `config.tunnel`.
- `configWrite()` serializes a typed object without rerunning whole-config domain validation.

### Consequences

- Init can save a valid token and enable cloudflared while status reports "not configured".
- Adding a tunnel route can write a config that fails the next `configLoad()`.
- Agents have no clear answer for which representation owns Cloudflare readiness.

### Proposed direction

- Remove the unused `config.tunnel` metadata unless a current operation consumes tunnel/account IDs.
- Treat `config.modules.cloudflared` as desired enablement.
- Treat the managed token file as credential presence.
- Make status inspect the same state used by setup and startup.
- Before accepting a tunnel route, verify the required Cloudflare capability and token.
- Validate the complete config before every config write.

### Critical test

One scenario should perform:

1. Cloudflare setup.
2. Add an app with a tunnel route.
3. Reload `config.yml`.
4. Read Cloudflare status.
5. Assert all operations agree that Cloudflare is configured.

### Decision

Cloudflare readiness is defined as both:

- `modules.cloudflared` explicitly enabled, and
- A managed tunnel token present.

The stale `config.tunnel` block was removed. Setup now persists module enablement, status reads module/token state, add rejects tunnel routes without readiness, and config writes run domain validation before serialization.

Validation after implementation:

- 81 test files passed, 410 tests passed.
- Typecheck passed.
- Lint passed.

---

## Finding 2: Deploy timeout does not cancel deployment

**Priority:** Critical

### Evidence

`deployWithTimeout()` in `src/flows/deploy/run.ts` resolves a timeout error through `setTimeout()`, but the underlying deployment promise continues running.

### Consequences

- A user can receive a timeout failure while deployment later succeeds.
- The deploy lock remains held until the background deployment eventually completes.
- During `jib add`, timeout triggers rollback while deployment continues to read or mutate resources being removed.
- Config, checkout, env, containers, ingress, and state can race with rollback.

### Proposed direction

Choose one explicit contract:

1. Remove the application-level timeout and allow Docker/system commands to finish, or
2. Propagate an `AbortSignal` to every cancellable process and wait for termination before returning, or
3. Treat timeout as "still running" rather than failure and do not roll back.

Do not return a normal deployment failure while work is still active.

### Critical test

A delayed deployment must prove that timeout cannot run concurrently with add rollback.

### Decision required

Choose whether deployment should be cancellable or simply have no orchestration-level timeout.

---

## Finding 3: Remove reports success after partial cleanup

**Priority:** Critical

### Evidence

`src/flows/remove/service.ts`:

- Runs ingress release and Compose shutdown as best effort.
- Deletes the app from config.
- Runs checkout, env, state, override, and managed Compose cleanup as best effort.
- Returns `{ removed: true }` even when cleanup produced warnings.

The EACCES incident recorded in `docs/TODO.md` exhibited this exact behavior: repository cleanup failed, but the command printed success.

### Consequences

- The app is no longer in config, so normal `jib remove <app>` cannot retry cleanup.
- Stale ingress, containers, secrets, checkouts, or generated files may remain unmanaged.
- Add rollback delegates to remove and can claim rollback succeeded despite leftovers.

### Proposed direction

- Distinguish complete removal from partial removal.
- Keep failed removal retryable.
- Do not delete the config entry before required cleanup succeeds unless a persistent tombstone records remaining work.
- Return a non-success result with an actionable list of failed resources.
- Decide which cleanup steps are required and which are genuinely optional.

### Critical test

Inject a repository or ingress cleanup failure and assert:

- The command is not reported as fully successful.
- A second invocation can complete cleanup.
- Remaining authoritative state identifies the app and unfinished work.

### Decision required

Choose between keeping the app config until cleanup completes or introducing an explicit removal tombstone.

---

## Finding 4: Add uses overlapping transaction systems

**Priority:** High

### Evidence

The add path combines:

- `txRunSteps()` from `src/modules/tx/`.
- Add-specific `Step` objects and mutable `AddRunContext`.
- `AddPlanner` and `AddSupport` interfaces.
- An outer `addRunSequence()` for add, deploy, and rollback.
- The separate remove flow for post-add rollback.

There is also an import cycle between `src/flows/add/steps.ts` and `src/flows/add/mutation-steps.ts`.

### Known compensation gaps

- `addClaimIngressStep` has no `down()` operation.
- A cancellation after ingress claim can roll back config and env while leaving nginx state.
- Generated Compose is persisted inside `addBuildResolvedApp()` before the owning step has completed. If later resolution fails, the transaction runner does not know that the file exists.
- Side effects that fail before a step returns successful state are not automatically compensated.
- Add rollback uses remove, whose cleanup is currently best effort.

### Proposed direction

Replace the generic step engine for add with one explicit lifecycle function whose mutations and compensations are adjacent. A possible shape is:

1. Prepare checkout.
2. Inspect and gather input without durable mutation.
3. Build and validate a complete plan.
4. Confirm the plan.
5. Persist app env.
6. Persist config.
7. Regenerate derived ingress/override state.
8. Deploy.
9. On failure, compensate completed mutations in explicit reverse order.

A small local compensation stack is acceptable if it records only real completed side effects and does not require generic exported step types.

### Critical test

Use a table of failure checkpoints and assert the final filesystem/config state for each checkpoint.

### Decision required

Confirm whether add should fully roll back a failed first deploy or retain the configured app for a later `jib deploy` retry.

---

## Finding 5: Docker runtime resolution is duplicated

**Priority:** High

### Evidence

Compose execution configuration is assembled independently by:

- `dockerComposeFor()` in `src/modules/docker/compose-for.ts`.
- `deployNewCompose()` in `src/modules/deploy/support.ts`.

Both know about Compose files, workdir, project name, override path, and managed env path. Different commands use different constructors.

### Consequences

- Deploy, up/down/restart, logs, exec/run, and remove can drift.
- Any env or Compose policy change must update multiple paths.
- The recent env fix had to modify both implementations.

### Proposed direction

Create one canonical app runtime resolver, for example:

```ts
interface AppRuntime {
  app: string
  projectName: string
  workdir: string
  composeFiles: string[]
  overrideFile: string
  envFile?: string
}
```

All Docker operations should create their Compose runner from this resolved value.

Keep runtime resolution pure where possible. File existence checks can be explicit at the boundary.

### Critical test

Resolve one app runtime and assert deploy, logs, exec/run, up/down, and remove all use the same files, env, override, workdir, and project name.

### Decision required

Confirm whether the managed env file should always be required after app creation or remain optional for apps with no values.

---

## Finding 6: Managed env still carries the old runtime/build abstraction

**Priority:** High

### Evidence

The source of truth was unified into one managed `.env`, but add still exposes:

- `--env`
- `--build-arg`
- `--build-env`
- `ConfigScope = 'runtime' | 'build' | 'both'`
- Scope merge, coverage, inference, labels, and prompt logic

All three input modes now write to the same file. Docker Compose determines whether a key is consumed for interpolation, runtime environment, build args, or more than one purpose.

`src/modules/docker/compose.ts` also retains unused `buildArgs` method parameters that can recreate the old second path.

### Consequences

- The CLI implies storage behavior that no longer exists.
- Agents may reintroduce separate build/runtime persistence.
- The add flow carries avoidable scope-merging complexity.

### Proposed direction

- Expose one app-value input such as repeated `--env KEY=VALUE`.
- Continue inspecting Compose references for guidance and summaries only.
- Do not persist or pass a separate scope.
- Remove dead `buildArgs` APIs from the Docker Compose runner.
- Consider renaming the `secrets` module to `app-env` or another name that reflects non-secret values too.

### Critical test

Provide a key referenced by both `environment` and `build.args`, then verify there is one stored value and one Docker env-file input.

### Decision required

Confirm whether all app values, including non-secret public build values, should remain in the protected managed env file.

---

## Finding 7: The ingress backend abstraction is premature and incomplete

**Priority:** Medium

### Evidence

- `IngressBackend` and a default backend registry exist.
- nginx is the only backend.
- `src/cmd/ingress.ts` imports nginx configuration directly.
- Migration `0013_apply_ingress_body_limit` imports nginx directly.
- Generic install/uninstall wrappers delegate to the hard-coded default backend.

The abstraction therefore does not control all backend-specific policy.

### Product distinction

Direct and Cloudflare Tunnel ingress are real route exposure modes. They are not separate reverse-proxy implementations. Both currently use nginx, while cloudflared is a separate host daemon.

### Proposed direction

- Keep route mode as `direct | cloudflare-tunnel`.
- Make nginx concrete and explicit in current code.
- Keep cloudflared lifecycle separate.
- Remove `IngressBackend`, default-backend registry, and forwarding wrappers.
- Extract a Caddy-capable interface only when Caddy implementation starts and actual common/different behavior is known.

### Critical test

Render direct and tunnel routes through nginx and verify their different TLS/ACME behavior without a generic backend fixture.

### Decision required

Confirm that nginx is mandatory for both current route modes.

---

## Finding 8: Source-driver abstraction is ahead of current requirements

**Priority:** Medium

### Evidence

- `SourceDriver` exposes setup, resolution, auth-failure detection, descriptions, and status.
- The driver registry contains only GitHub.
- GitHub handling also acts as the default path for external Git URLs.
- Recovery and setup flows are written generically around a future provider set.

### Consequences

- Git/GitHub behavior is spread across registry, flow, recovery, service, sync, checkout, and backend files.
- Generic types obscure the current source cases: local checkout, external Git URL, GitHub slug, and Docker image.

### Proposed direction

- Represent current source kinds explicitly.
- Keep Git operations generic where they genuinely are protocol-level.
- Call GitHub credential behavior directly for GitHub sources.
- Reintroduce a provider interface when a second provider is implemented.

A discriminated internal source resolution result may improve clarity without making the config more complex.

### Critical test

Cover the real source matrix end to end: local, external URL, public GitHub, GitHub deploy key/App, and Docker image.

### Decision required

Confirm whether GitLab is near enough to justify retaining the driver boundary now.

---

## Finding 9: Init has overlapping registries and migration responsibilities

**Priority:** Medium

### Evidence

The code has:

- A first-party module registry.
- A separate module setup registry.
- Required and optional module filtering.
- Config `modules` flags.
- Migrations that directly install watcher and nginx.
- Init that installs/configures optional modules.
- Reconciliation that infers config from token files.

### Consequences

- It is unclear whether migrations, module hooks, config flags, or detected files own installation state.
- Required modules are statically known but still go through a plugin-like model.
- Adding a feature requires understanding multiple registries and lifecycle paths.

### Proposed direction

- Make bootstrap migrations explicit for required host dependencies.
- Make optional Cloudflare setup one concrete flow.
- Store only current desired optional capabilities in config.
- Remove general module registries until there are multiple independently managed optional capabilities with genuinely shared behavior.

### Critical test

Bootstrap a clean root, configure Cloudflare, rerun both migration and init, and assert idempotent service/config/token state.

### Decision required

Clarify whether watcher is mandatory in the current product. `docs/TODO.md` suggests the watch command may be removed, while the watcher manifest marks it required.

---

## Finding 10: Error modeling adds layers without improving recovery

**Priority:** Medium

### Evidence

There are approximately 134 exported error subclasses. Common patterns include:

- Adapter error wrapped by a module error.
- Module error wrapped by a flow-step error.
- Flow error unwrapped by a normalizer.
- Result-returning function wrapped by a function that throws.
- Final CLI normalization by `instanceof`.

Examples include add step errors and the two deploy entry points `runDeployResult()` and `runDeploy()`.

Some source wrapper messages omit the underlying actionable error message, leaving details only in `cause`, which the text CLI does not render.

### Consequences

- Agents must choose among many nearly identical error paths.
- Root causes can become less visible after wrapping.
- Tests tend to assert architecture-specific subclasses instead of user recovery behavior.
- Returned-error and thrown-error contracts are mixed.

### Proposed direction

- Keep one base `JibError` with a typed code, message, cause, hint, and optional field issues.
- Add subclasses only when callers need distinct data or recovery behavior.
- Do not wrap solely to rename the current step.
- Preserve actionable underlying messages.
- Use returned expected errors inside use cases and convert thrown library/process failures once at an adapter or CLI boundary.
- Avoid paired result/throwing variants unless a framework requires both.

### Critical test

Assert final CLI message, hint, and exit behavior for representative config, Git, Docker, ingress, and filesystem failures.

### Decision required

Approve relaxing the AGENTS rule from "typed custom error classes" to "typed domain errors/codes".

---

## Finding 11: File and export fragmentation increases agent search space

**Priority:** Medium

### Evidence

- About 196 implementation files for 12,900 lines.
- About 66 lines per implementation file on average.
- The add flow alone has 24 implementation files.
- Broad barrel modules are among the most imported files.
- Many functions and types are exported primarily for narrow unit tests.

### Consequences

- A small behavior change requires opening many files.
- Naming and forwarding functions make call graphs harder to scan.
- Broad barrels hide the actual implementation dependency.
- Agents can select a plausible but incomplete entry point.

### Proposed direction

- Prefer cohesive modules, even when they exceed 200 lines.
- Keep pure parsing/rendering helpers separate only when independently meaningful.
- Keep orchestration together.
- Export only entry points and types used across module boundaries.
- Import implementation files directly inside a domain when that makes dependencies clearer.
- Collapse forwarding modules and one-line registries.

A reasonable first target is reducing add to a small set such as:

- Command boundary.
- Input and prompt handling.
- Compose inspection and plan building.
- One lifecycle orchestration file.
- Focused scenario tests.

### Decision required

Approve cohesion taking precedence over the current ~200-line implementation target.

---

## Finding 12: Tests emphasize layers more than invariants

**Priority:** Medium

### Evidence

At review time:

- 81 test files and 407 tests pass.
- Cloudflare state can still disagree across setup, status, validation, and add.
- Remove can still report full success after partial cleanup.
- Deploy timeout can still race with rollback.

### Consequences

- Refactoring interfaces creates large test churn even when behavior is unchanged.
- Passing tests provide less confidence in cross-module correctness than their count suggests.
- Agents are rewarded for preserving existing seams rather than simplifying them.

### Proposed direction

Prefer a small critical scenario suite around authoritative artifacts and lifecycle outcomes:

1. Clean bootstrap and rerun.
2. Add and deploy a direct-ingress app.
3. Add and deploy a tunnel-ingress app.
4. App env used for both runtime and build interpolation.
5. Add failure at each durable mutation checkpoint.
6. Retryable partial remove.
7. Manual and watcher deploy sharing the same runtime resolution.

Retain focused unit tests for parsers, templates, and security-sensitive path/auth behavior. Remove tests whose only purpose is preserving forwarding abstractions after those abstractions are deleted.

### Decision required

Agree on the minimum critical scenario matrix before simplifying implementation tests.

---

## Finding 13: Documentation and samples are not authoritative

**Priority:** Medium

### Evidence

- `README.md` contains only installation and update instructions.
- `samples/config.yml` contains unsupported or stale fields including `certbot_email`, `strategy`, `warmup`, `secrets_env`, and `tailscale` ingress.
- Tailscale remains a backlog idea while the sample presents it as configured behavior.
- The architecture and persisted artifact ownership are undocumented outside source code.

### Consequences

- Users can copy invalid config.
- Coding agents can infer obsolete behavior from samples.
- Source code and historical plans become the only architecture reference.

### Proposed direction

- Keep one schema-valid sample config covered by a test.
- Document the app lifecycle and authoritative artifact table.
- Document direct versus Cloudflare Tunnel route modes.
- Clearly mark future ideas as unsupported.
- Add a short contributor-oriented change checklist for cross-cutting config/runtime changes.

### Critical test

Load every shipped config sample through `configLoad()`.

### Decision required

Choose whether samples should be executable fixtures or documentation-only files. Executable fixtures are recommended.

---

## Finding 14: Project instructions reinforce over-abstraction

**Priority:** Medium

### Evidence

`AGENTS.md` currently emphasizes:

- A target of roughly 200 lines per implementation file.
- Mandatory `modules/`, `flows/`, and `libs/` classification.
- Typed custom error classes for expected failures.

These rules were followed literally, contributing to file fragmentation and error-class proliferation.

### Proposed direction

Amend the instructions to include:

- Cohesion takes precedence over file length; ask before materially exceeding a higher soft boundary rather than splitting orchestration mechanically.
- Do not introduce an extension interface until there are two current implementations or an immediate approved implementation plan.
- Every persisted datum must have one named owning module and one authoritative artifact.
- Derived files must not become independent configuration sources.
- Do not wrap errors unless adding actionable context, recovery data, or a meaningful boundary conversion.
- Prefer scenario tests for lifecycle invariants over mock-heavy tests for forwarding layers.
- When changing config/runtime behavior, trace add, deploy, up/down, logs/exec, watcher, remove, migration, and status paths.

### Decision required

Approve updating `AGENTS.md` before large refactors so future agents do not recreate deleted layers.

---

## Finding 15: Migration persistence is heavier than current needs

**Priority:** Low

### Evidence

SQLite, better-sqlite3, Drizzle ORM, and Drizzle Kit are used only for the `jib_migrations` table. App operational state is stored separately as JSON.

Relevant dependencies and files include:

- `better-sqlite3`
- `drizzle-orm`
- `drizzle-kit`
- `src/modules/state/db.ts`
- `src/modules/state/tables.ts`
- `drizzle.config.ts`

### Consequences

- Native dependency installation and packaging complexity.
- Multiple persistence technologies for a small amount of data.
- More migration infrastructure than the current schema requires.

### Proposed direction

After higher-priority lifecycle work, consider an atomically written migration ledger file containing applied IDs. If SQLite remains, consider using it directly without Drizzle for one table.

### Critical test

Run migrations twice, simulate an interrupted ledger write, and verify migrations are not silently marked applied.

### Decision required

Choose whether future state requirements justify retaining SQLite.

---

# Recommended sequence

Do not execute all findings as one refactor.

1. Resolve Cloudflare authoritative state.
2. Resolve deploy timeout semantics.
3. Make remove failures visible and retryable.
4. Define and centralize app runtime resolution.
5. Simplify app env inputs and remove dead build-arg paths.
6. Simplify add orchestration and rollback.
7. Remove premature ingress abstraction while preserving route modes.
8. Reassess source and init registries.
9. Simplify error modeling.
10. Consolidate files and exports.
11. Replace layer-preserving tests with critical scenarios.
12. Repair documentation and samples throughout the work.
13. Reassess SQLite/Drizzle last.

Before implementation of each item:

- Confirm the product behavior decision listed for that finding.
- Identify authoritative and derived artifacts affected.
- Write or update the smallest end-to-end invariant test.
- Make one focused change.
- Run tests, typechecking, and linting.
- Review whether the change removed choices for future agents rather than adding another compatibility layer.

## Validation baseline

The review did not modify application code. At review time:

- `npm test -- --reporter=dot`: 81 files passed, 407 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
