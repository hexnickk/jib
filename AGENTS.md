# General

- App is in active development now, no backwards compatibility is needed

# General coding rules

- Don't commit until asked to do so, even if you were asked commit before in chat history.
- Document functions - purpose and an overview of inputs/outputs/side effects.
- Prefer plain function modules. Avoid service classes unless explicitly approved by user.
- Side effects must never be executed on module import, except for entrypoint file.
- Keep implementation files small: target ~200 LoC where practical, and ask user approval before creating or materially expanding files beyond. Tests, content-heavy, reference-heavy files are exempt, for example - prompt libraries, lookup tables, migrations, or generated files.
- Organize main app code into `modules/`, `flows/`, and `libs/`. `modules/` is the default place for work used for domain modules, integration adapter modules, and other single-purpose blocks. `flows/` are only meant for cross-module orchestration.  `libs/` are only for stable shared/reusable code.
- Use language/framework-idiomatic module file names. Backend modules may use names like `controller`, `store`, `errors`, `types` etc. These examples are directional, not exhaustive.
- Framework-required entrypoints may sit outside `modules/`, `flows/`, and `libs/` when needed, but they should stay thin. Implementation should live in associated modules or flows.

# Error handling

- For expected failures, return typed custom error classes instead of throwing.
  ```typescript
  class UserNotFoundError extends Error {
    constructor(readonly userId: string) {
      super(`user ${userId} not found`)
    }
  }

  class UserReadError extends Error {
    constructor(message: string) {
      super(message)
    }
  }

  async function userGetById(id: string): Promise<UserNotFoundError | UserReadError | User> {
    try {
      const user = await db.find(id)
      if (!user) return new UserNotFoundError(id)
      return user
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new UserReadError(message)
    }
  }

  const user = await userGetById(id)
  if (user instanceof UserNotFoundError) return
  if (user instanceof UserReadError) return
  console.log(user.username)
  ```
- `throw` needs clear justification unless it is a framework-enforced pattern. If an underlying library throws, catch it where appropriate and convert expected failures into typed errors.
- Sentinel values like `undefined` are fine for simple absence. Use returned typed errors for actual failures.

# JS/TS

- Exported functions should start with the module name, e.g. `cliRunApp()`, `cliCanPrompt()`, `cliCheckRootHost()`. Private helpers can use shorter local names when the surrounding file already makes the module obvious.
- If there are context dependencies, functions should accept `ctx` as a first argument.
- Framework entrypoints and framework-required exports are exempt from two rules above; use framework-idiomatic approach.

# Testing

- Prefer the fewest tests that catch critical behavior.
- Tests that touch the filesystem must use isolated temp directories and clean up after themselves.
- Test files should usually live in `test/` next to the owning implementation or module. In JS/TS, use `test/<file>.spec.ts` or `test/<file>.spec.tsx`.

# Docs

- Keep all plans at docs/plans/<YYMMDD>-<file>.md

# Communication

- If there are more than 2 questions or decisions to be made, guide user through them one by one.
- Don't edit TODO.md unless explicitly asked.
- If user asks for anything non trivial, interview them until you have 95% confidence about what they actually want, not what they think they should want.
- If any rule requires user approval, justification must be left in the code as a comment, if there is no such comment, that's a regression.
