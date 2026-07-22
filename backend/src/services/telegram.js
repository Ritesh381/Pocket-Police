import { config } from '../config.js';

const api = (method) => `https://api.telegram.org/bot${config.telegram.botToken}/${method}`;

// Sends a message to a Telegram chat. No-op if the bot token isn't configured.
export async function sendMessage(chatId, text, extra = {}) {
  if (!config.telegram.botToken) return;
  try {
    await fetch(api('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
    });
  } catch (e) {
    console.error('[telegram] sendMessage failed:', e.message);
  }
}
