// ---------------------------------------------------------------------------
// Telegram bot webhook — user-facing entry experience for @Habeshawibingobot
//
// Deploy with: supabase functions deploy telegram-bot --no-verify-jwt
// Then point Telegram at it:
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot"
//
// Secrets (Edge Function secrets, never in the frontend):
//   TELEGRAM_BOT_TOKEN
//   MINI_APP_URL    (default: https://bingo-telegram-bot.vercel.app)
// ---------------------------------------------------------------------------

const DEFAULT_MINI_APP_URL = 'https://bingo-telegram-bot.vercel.app';

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    message?: { chat: { id: number } };
  };
}

const WELCOME_TEXT =
  '🎱 BINGO\n\n' +
  'Welcome to Bingo!\n\n' +
  'Join a live multiplayer Bingo game and play using your Bingo card.';

async function callTelegram(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Telegram ${method} failed`, await res.text().catch(() => ''));
  }
}

Deno.serve(async (req) => {
  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      return new Response('Server is not configured', { status: 500 });
    }

    const miniAppUrl = Deno.env.get('MINI_APP_URL') || DEFAULT_MINI_APP_URL;

    const update = (await req.json().catch(() => ({}))) as TelegramUpdate;

    const chatId =
      update.message?.chat.id ?? update.callback_query?.message?.chat.id;

    if (!chatId) {
      return new Response('ok');
    }

    // Every entry point (start, help, or any message) shows the same welcome.
    await callTelegram(botToken, 'sendMessage', {
      chat_id: chatId,
      text: WELCOME_TEXT,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🎱 PLAY BINGO',
              web_app: { url: miniAppUrl },
            },
          ],
        ],
      },
    });

    return new Response('ok');
  } catch (err) {
    console.error(err);
    return new Response('ok', { status: 200 });
  }
});
