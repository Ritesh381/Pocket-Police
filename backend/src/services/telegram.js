import { config } from '../config.js';

const api = (method) => `https://api.telegram.org/bot${config.telegram.botToken}/${method}`;

async function call(method, payload) {
  if (!config.telegram.botToken) return { ok: false, description: 'bot token not configured' };
  try {
    const res = await fetch(api(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      const desc = body?.description || `HTTP ${res.status}`;
      console.error(`[telegram] ${method} error: ${desc}`);
      return { ok: false, description: desc };
    }
    return body;
  } catch (e) {
    console.error(`[telegram] ${method} failed:`, e.message);
    return { ok: false, description: e.message };
  }
}

// Sends a message to a Telegram chat. No-op if the bot token isn't configured.
export async function sendMessage(chatId, text, extra = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

// Edits an existing message (used to collapse the inline keyboard after a tap).
// Returns the Telegram API result so callers can detect failure.
export async function editMessageText(chatId, messageId, text, extra = {}) {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

// Acknowledges a callback query so Telegram stops the button's loading spinner.
export async function answerCallbackQuery(callbackQueryId, text) {
  return call('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}
