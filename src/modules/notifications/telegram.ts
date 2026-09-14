import { InternalError, ValidationError } from '@jib/errors'
import { z } from 'zod'

/** Telegram uses tokens in URLs; never propagate URLs or raw API errors into diagnostics. */
export async function telegramSend(ctx: { token: string }, chatId: string, text: string) {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(ctx.token)) {
    return new ValidationError('invalid Telegram bot token; obtain one from @BotFather')
  }
  const bounded =
    text.length > 4000
      ? `${text.slice(0, 3900).replace(/[\uD800-\uDBFF]$/, '')}\n…truncated; run jib status on the server for details.`
      : text
  try {
    const response = await fetch(`https://api.telegram.org/bot${ctx.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: bounded,
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    })
    const body: unknown = await response.json()
    const parsed = z
      .object({
        ok: z.boolean(),
        error_code: z.number().optional(),
        result: z.object({ message_id: z.number() }).optional(),
      })
      .safeParse(body)
    if (!parsed.success) {
      return new InternalError('Telegram returned an invalid response')
    }
    if (!response.ok || !parsed.data.ok) {
      const messages: Record<number, string> = {
        400: 'check the chat ID and bot permissions; for private chats, send /start to the bot first',
        401: 'replace the bot token with one from @BotFather',
        403: 'add the bot to the chat with permission to post',
        429: 'rate limit reached; try again later',
      }
      return new InternalError(
        `Telegram: ${messages[parsed.data.error_code ?? response.status] ?? 'request failed; try again later'}`,
      )
    }
    return parsed.data.result ? undefined : new InternalError('Telegram did not confirm delivery')
  } catch (error) {
    return new InternalError('Telegram request failed or timed out; check connectivity', {
      cause: error,
    })
  }
}
