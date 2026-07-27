import { config, isTelegramConfigured } from '../config.js';

async function main() {
  if (!isTelegramConfigured()) {
    console.error('❌ TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_USERNAME is missing in env');
    process.exit(1);
  }

  const token = config.telegram.botToken;
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL || 'https://pocket-police.vercel.app/api/telegram/webhook';
  const secret = config.telegram.webhookSecret;

  console.log(`Configuring webhook for Telegram bot @${config.telegram.botUsername}...`);
  console.log(`URL: ${webhookUrl}`);

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret || undefined,
      allowed_updates: ['message', 'callback_query'],
    }),
  });

  const body = await res.json();
  console.log('Result:', body);

  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const infoBody = await infoRes.json();
  console.log('Current Webhook Info:', infoBody);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
