import { config } from '../config.js';

const api = (method) => `https://api.telegram.org/bot${config.telegram.botToken}/${method}`;

async function call(method, payload) {
  if (!config.telegram.botToken) return;
  try {
    await fetch(api(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error(`[telegram] ${method} failed:`, e.message);
  }
}

// Sends a message to a Telegram chat. No-op if the bot token isn't configured.
export async function sendMessage(chatId, text, extra = {}) {
  await call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

// Edits an existing message (used to collapse the inline keyboard after a tap).
export async function editMessageText(chatId, messageId, text, extra = {}) {
  await call('editMessageText', {
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
  await call('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}
