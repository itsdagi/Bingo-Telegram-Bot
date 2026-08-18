// ---------------------------------------------------------------------------
// Telegram bot webhook — launches the Mini App from @Habeshawibingobot
//
// Deploy with (IMPORTANT: --no-verify-jwt, or Telegram's POST will be rejected):
//   supabase functions deploy telegram-bot --no-verify-jwt
//
// Then point Telegram at the deployed function (see README):
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-bot"
//
// Secrets (Edge Function secrets — never in the frontend):
//   TELEGRAM_BOT_TOKEN
//   MINI_APP_URL    (optional; defaults to https://bingo-telegram-bot.vercel.app)
// ---------------------------------------------------------------------------

const DEFAULT_MINI_APP_URL = 'https://bingo-telegram-bot.vercel.app';

const WELCOME_TEXT = '🎱 Bingo\n\nWelcome to Bingo!';

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
}

Deno.serve(async (req) => {
  // Telegram always calls the webhook with POST. Reject anything else early.
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN is not set');
      // Return 200 so Telegram does not retry in a loop.
      return new Response('ok');
    }

    // Never let a missing/blank MINI_APP_URL break the button.
    const miniAppUrl = (Deno.env.get('MINI_APP_URL') || DEFAULT_MINI_APP_URL)
      .trim()
      .replace(/\/+$/, '');

    const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
    const chatId = update?.message?.chat.id;

    if (!chatId) {
      // Not a message we care about (e.g. callback query) — acknowledge it.
      return new Response('ok');
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: WELCOME_TEXT,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🎮 PLAY BINGO',
                // Telegram "web_app" button type — launches the Mini App
                // directly. Not a normal url button.
                web_app: { url: miniAppUrl },
              },
            ],
          ],
        },
      }),
    });

    if (!res.ok) {
      console.error('sendMessage failed', await res.text().catch(() => ''));
    }

    return new Response('ok');
  } catch (err) {
    console.error(err);
    // Always acknowledge so Telegram does not retry endlessly.
    return new Response('ok');
  }
});

