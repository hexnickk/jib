# General rules

- If asked to write a plan, keep it at `docs/plans/<YYMMDD>-<file>.md`.
- Don't edit TODO.md unless explicitly asked.
- If approved code intentionally violates a standing rule, leave a short comment explaining the approved exception.
- Name files in lowercase with dash e.g. `my-file-name.ts`.

## Coding

- Don't introduce new env without user approval.
- Do not run git state-changing commands without explicit user approval for each action (e.g. commit or unstage files).
- Side effects must never be executed on module import, except for entrypoint file.
- Prefer plain function modules. Avoid service classes unless explicitly approved by user.
- Exported functions should start with the module name, e.g. `cliRunApp()`, `cliCanPrompt()`, `cliCheckRootHost()`. Private helpers can use shorter local names when the surrounding file already makes the module obvious.
- Keep API inputs product-facing, not implementation-facing. Example: callers send `target: "3d-print"`; backend stores resolved `model: "tencent:hunyuan-3d@3.1-pro"`.
- By default, when installing package use `latest` instead of specific versions.
- Use braces for all `if` statements, including single-line returns.
- Prefer `undefined` for app-owned optional values. Avoid `null | undefined` unions unless mirroring library/API/DB output.
- Prefer camelCase for app-owned API payloads.
- If there are context dependencies, functions should accept `ctx` as a first argument.

### Backend

- Don't add, update, or delete database tables without user approval. Generate schema migrations with the project command first; if generated SQL or metadata is wrong, explain the issue and wait for approval before a precise patch. Fix local DB state locally, not by changing committed migration history.
- Delete flows should account for external artifacts and local caches owned by the resource, not only the database row. If artifact cleanup is intentionally skipped, say so explicitly.

# Detailed rules

### Module/flow structure

Use `modules/` for domain modules, integration adapters, and other single-purpose blocks. Use `flows/` only for cross-module orchestration. Keep entrypoints thin and put implementation in modules or flows.

### Keep ownership boundaries without one-use helpers

Feature modules should own their integration boundaries and keep simple one-path logic inline. Extract helpers, constants, guards, or setup functions only when they make ownership clearer, hide a real library/API boundary, name a domain concept, isolate genuinely complex logic, or avoid meaningful duplication.

**Do not extract tiny one-use helpers**

Do not add a helper just to wrap a small `try`/`catch`, parse one payload, format one value, make one boolean check, or save a couple of lines. If there is no separate behavior to name, inline it. A helper with two call sites can still be noise when it only wraps a trivial expression and the callers stay clearer inline.

Good:

```ts
// Good: one-use expression stays at the call site.
const inputFilename = input.inputFileKey.split("/").pop() || "input-image";
```

Bad:

```ts
// Bad: helper only wraps a simple expression used once.
function filenameFromKey(key: string) {
  return key.split("/").pop() || "input-image";
}

const inputFilename = filenameFromKey(input.inputFileKey);
```

```ts
// Bad: helper only parses one local payload for one call path.
function readEstimatedCost(content: Buffer) {
  const data = JSON.parse(content.toString("utf8"));
  return typeof data.estimatedCost === "number" ? data.estimatedCost : undefined;
}

const estimatedCost = readEstimatedCost(metadata);
```

```ts
// Bad: this only hides a template string; it does not own request setup or error handling.
function telegramApiUrl(botToken: string, method: string) {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

await axios.post(telegramApiUrl(botToken, "sendMessage"), payload);
```

**Shared ownership boundaries are okay**

Use shared constants or small helpers when they define module-owned boundaries used across call sites, such as route paths, schema mappings, or integration payload setup. Prefer plain data/objects when a function is not needed.

For external APIs, prefer a local integration wrapper when it owns authentication/config, request setup, and response/error handling. This is different from a trivial URL builder: the wrapper should make callers simpler by hiding the library/API boundary. Keep the wrapper domain-agnostic; feature-specific payloads, captions, and product wording belong in the owning feature module.

Good:

```ts
// Good: reusable integration wrapper owns auth, request setup, and response mapping.
// It does not know about generations, captions, or product copy.
async function telegramPost(method: TelegramApiMethod, payload: object | FormData) {
  const config = getConfig();
  const body = payload instanceof FormData ? payload : { chat_id: config.telegramChatId, ...payload };
  const response = await axios.post(
    `https://api.telegram.org/bot${config.telegramBotToken}/${method}`,
    body,
  );
  // Validate Telegram response shape and map failures to shared errors here.
  return response.data;
}
```

Bad:

```ts
// Bad: product-specific generation wording belongs in the generation feature, not Telegram client.
export async function telegramSendGeneration(input: { generationId: string }) {
  return telegramPost("sendMediaGroup", generationNotificationPayload(input));
}
```

### Handle expected errors with shared errors

Expected failures should return typed errors/results instead of throwing, and simple absence can use sentinels like `undefined` or `None`. Use the fewest shared error classes needed for distinct response or recovery behavior, preserve original failures with `cause`, catch library failures where appropriate, and log propagated errors once at the owning boundary. Use shared errors directly instead of wrapping them in operation-specific subclasses, delete empty error modules instead of leaving placeholders, and only `throw` / `raise` with clear justification or framework enforcement.

Good:

```typescript
async function userGetById(id: string): Promise<NotFoundError | InternalError | User> {
  try {
    const user = await db.find(id)
    if (!user) {
      return new NotFoundError(`user ${id} not found`)
    }
    return user
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(message, { cause: error })
  }
}
```

Bad:

```typescript
export class UsersReadError extends InternalError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options)
  }
}
```
