// Central config. Env is loaded by `node --env-file=../.env` (see package.json scripts).
// Fails fast if a required Supabase value is missing.

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\n[config] Missing required env var: ${name}`);
    console.error('Add it to the project-root .env file (see .env.example).\n');
    process.exit(1);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 4000,

  supabase: {
    url: required('SUPABASE_URL'),
    // "secret" key = the service role key in the new API-key format. Bypasses RLS.
    secretKey: required('SUPABASE_SECRET_KEY'),
    // JWKS endpoint used to verify user JWTs coming from the mobile app.
    jwksUrl: required('SUPABASE_JWKS_URL'),
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY, // not used server-side, kept for reference
  },

  // Shared secret the GitHub Actions cron uses to call the reminder endpoint.
  cronSecret: process.env.CRON_SECRET || '',

  email: {
    // SMTP transport (e.g. Gmail / Google Workspace with an App Password).
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT) || 587,
    smtpSecure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587 (STARTTLS)
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    from: process.env.REMINDER_FROM_EMAIL || process.env.SMTP_USER || 'Pocket Police <no-reply@example.com>',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    smsFrom: process.env.TWILIO_SMS_FROM || '',           // e.g. +14155550123
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || '', // e.g. whatsapp:+14155550123
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    botUsername: (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  },

  // CORS: comma-separated list of allowed origins, or "*" for any (dev only).
  corsOrigins: process.env.CORS_ORIGINS || '*',
};

export const isTelegramConfigured = () =>
  Boolean(config.telegram.botToken && config.telegram.botUsername);

export const isEmailConfigured = () =>
  Boolean(config.email.smtpHost && config.email.smtpUser && config.email.smtpPass);
export const isTwilioConfigured = () =>
  Boolean(config.twilio.accountSid && config.twilio.authToken);
