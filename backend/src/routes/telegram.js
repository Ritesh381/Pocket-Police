import { Router } from 'express';
import { randomBytes } from 'crypto';
import { supabase } from '../supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, supabaseError } from '../lib/helpers.js';
import { config, isTelegramConfigured } from '../config.js';
import { sendMessage } from '../services/telegram.js';

const router = Router();

// ── App-facing (require a user JWT) ─────────────────────────

// GET /api/telegram/status — is Telegram set up, and is this user linked (and to what)?
router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('telegram_links')
    .select('telegram_id, username, linked_at')
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) throw supabaseError(error);
  res.json({
    configured: isTelegramConfigured(),
    botUsername: config.telegram.botUsername || null,
    linked: !!data,
    telegram: data
      ? { id: String(data.telegram_id), username: data.username, linked_at: data.linked_at }
      : null,
  });
}));

// POST /api/telegram/link-token — mint a single-use handshake token + deep link.
router.post('/link-token', requireAuth, asyncHandler(async (req, res) => {
  if (!isTelegramConfigured()) {
    const e = new Error('Telegram bot is not configured on the server yet.');
    e.status = 503;
    throw e;
  }
  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from('telegram_link_tokens').delete().eq('user_id', req.user.id); // clear stale
  const { error } = await supabase
    .from('telegram_link_tokens')
    .insert({ token, user_id: req.user.id, expires_at: expiresAt });
  if (error) throw supabaseError(error);
  res.json({ url: `https://t.me/${config.telegram.botUsername}?start=${token}`, token });
}));

// POST /api/telegram/unlink — remove this user's Telegram binding.
router.post('/unlink', requireAuth, asyncHandler(async (req, res) => {
  const { error } = await supabase.from('telegram_links').delete().eq('user_id', req.user.id);
  if (error) throw supabaseError(error);
  res.json({ ok: true });
}));

// ── Telegram-facing webhook (no JWT; verified by secret header) ──
router.post('/webhook', asyncHandler(async (req, res) => {
  if (config.telegram.webhookSecret) {
    if (req.headers['x-telegram-bot-api-secret-token'] !== config.telegram.webhookSecret) {
      return res.status(401).json({ error: 'bad secret' });
    }
  }
  // Process fully before responding (serverless kills the fn after the response).
  try {
    await handleUpdate(req.body || {});
  } catch (e) {
    console.error('[telegram] webhook error:', e.message);
  }
  res.json({ ok: true });
}));

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const tgId = msg.from.id;
  const username = msg.from.username || null;
  const text = msg.text.trim();

  // /start [token] — link the account
  if (text.startsWith('/start')) {
    const token = text.split(/\s+/)[1];
    if (!token) {
      await sendMessage(chatId, '👋 Welcome to <b>Pocket Police</b>!\n\nOpen the app → <b>Settings → Connect Telegram</b> to link your account.');
      return;
    }
    const { data: tok } = await supabase
      .from('telegram_link_tokens').select('*').eq('token', token).maybeSingle();
    if (!tok || new Date(tok.expires_at) < new Date()) {
      await sendMessage(chatId, '⚠️ That connect link has expired. Tap <b>Connect Telegram</b> in the app again.');
      return;
    }
    // Rebind: remove the user's previous link (change account) and any prior link
    // for this Telegram id, then bind fresh. The connection is permanent afterwards.
    await supabase.from('telegram_links').delete().eq('user_id', tok.user_id);
    await supabase.from('telegram_links').delete().eq('telegram_id', tgId);
    const { error: insErr } = await supabase
      .from('telegram_links').insert({ telegram_id: tgId, user_id: tok.user_id, username });
    if (insErr) { await sendMessage(chatId, '❌ Could not link — please try again.'); return; }
    await supabase.from('telegram_link_tokens').delete().eq('token', token);

    const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', tok.user_id).maybeSingle();
    await sendMessage(chatId, `✅ Connected to your Pocket Police account${prof?.full_name ? `, <b>${escape(prof.full_name)}</b>` : ''}!\n\nSoon you'll be able to log who owes you — just by typing here in plain language.`);
    return;
  }

  // /unlink — disconnect this Telegram
  if (text === '/unlink') {
    await supabase.from('telegram_links').delete().eq('telegram_id', tgId);
    await sendMessage(chatId, '🔌 Unlinked. This Telegram is no longer connected to Pocket Police.');
    return;
  }

  // Any other message — must be linked
  const { data: link } = await supabase
    .from('telegram_links').select('user_id').eq('telegram_id', tgId).maybeSingle();
  if (!link) {
    await sendMessage(chatId, "You're not connected yet. Open the app → <b>Settings → Connect Telegram</b>.");
    return;
  }
  if (text === '/help') {
    await sendMessage(chatId, "<b>Pocket Police bot</b>\n\nNatural-language expense logging is coming soon. For now you're connected ✅\n\n/unlink — disconnect this Telegram");
    return;
  }
  await sendMessage(chatId, "✅ You're connected. Natural-language logging (e.g. “Jenil owes 250 for dinner”) is coming soon!");
}

function escape(s = '') {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export default router;
