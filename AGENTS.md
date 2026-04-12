# Purpose

This file describes how agents should work in this repo.

# Functionality

- CLI features must work in both interactive and non-interactive modes. Do not make functionality prompt-only or automation-only.

# Important rules

- Files should target ~100 LoC. Any implementation file over 200 LoC requires explicit approval, including existing files.
- Tests are exempt from the 200 LoC approval rule, but should stay as small as practical.
- Don't commit until asked to do so.
- Don't edit TODO.md unless explicitly asked.
- Use the 80/20 principle everywhere, especially for tests.
- Prefer the structural fix over a quick patch that reinforces bad structure.
- Fight entropy. Leave the codebase better than you found it.

# Code style

- Prefer plain function modules with names like `moduleAction(ctx, params)`.
- Avoid service classes unless there is a clear reason they are simpler.
- For expected failures, return typed custom error classes instead of throwing.
- `throw` needs clear justification. If an underlying library throws, `try {}` / `catch {}` is acceptable, but convert it into returned typed errors.
- Use specific error names. Avoid vague catch-all names like `AppError` or `ServiceError`.
- Sentinel values like `undefined` are fine for simple absence. Use returned typed errors for actual failures.
- Prefer patterns like:

  ```ts
  async function getUser(id: string): Promise<NotFoundError | User> {
    try {
      const user = await db.find(id)
      if (!user) return new NotFoundError(`user ${id} not found`)
      return user
    } catch (error) {
      return new DbError(error instanceof Error ? error.message : String(error))
    }
  }

  const user = await getUser(id)
  if (user instanceof NotFoundError) return
  if (user instanceof DbError) return
  console.log(user.username)
  ```

# Test style

- Prefer the fewest tests that catch critical bugs.
- Prefer high-signal integration tests for critical behavior.
- Use unit tests when they clearly earn their keep, especially for pure parsing, small deterministic algorithms, error mapping, rollback logic, or cases that are expensive or flaky to cover through integration tests.
- Tests that touch the filesystem must use isolated temp directories and clean up after themselves.
- Test files should usually live next to the implementation as `implementation.ts` and `implementation.test.ts`.
- Cross-file workflow tests should live next to the primary owning entrypoint or module.
