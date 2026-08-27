import { Router } from 'express';
import { randomBytes } from 'crypto';
import { supabase } from '../supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, supabaseError } from '../lib/helpers.js';
import { config, isTelegramConfigured, isLlmConfigured } from '../config.js';
import { sendMessage, editMessageText, answerCallbackQuery } from '../services/telegram.js';
import { runAgentLoop } from '../services/llm.js';
import { applyMutation } from '../services/telegramTools.js';
import {
  getUserContext,
  resolveEntries,
  writeEntries,
  getBalances,
  formatAmount,
  getRecentHistory,
  saveChatMessage,
} from '../services/telegramLedger.js';

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
    console.error('[telegram] webhook error:', e);
    const chatId = req.body?.message?.chat?.id || req.body?.callback_query?.message?.chat?.id || req.body?.callback_query?.from?.id;
    if (chatId) {
      await debugLog(chatId, 'WEBHOOK UNCAUGHT ERROR', e.stack || e.message || String(e));
    }
  }
  res.json({ ok: true });
}));

async function debugLog(chatId, label, data) {
  if (!config.telegram.debug || !chatId) return;
  const str = typeof data === 'string' ? data : (JSON.stringify(data, null, 2) ?? String(data));
  await sendMessage(chatId, `🔍 <b>[DEBUG: ${escape(label)}]</b>\n<pre>${escape((str || '').slice(0, 3500))}</pre>`);
}

async function handleUpdate(update) {
  if (update.callback_query) return handleCallback(update.callback_query);

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
    await sendMessage(chatId, `✅ Connected to your Pocket Police account${prof?.full_name ? `, <b>${escape(prof.full_name)}</b>` : ''}!\n\nNow just type who owes what — e.g. <i>“gave Jenil 300 for dinner”</i>. I'll confirm before saving. Send /help for examples.`);
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
    await sendMessage(chatId, HELP_TEXT);
    return;
  }

  // Everything else = a natural-language expense message.
  await handleExpenseMessage(chatId, tgId, link.user_id, text);
}

const HELP_TEXT =
  '<b>Pocket Police bot</b>\n\n' +
  'Talk to me in plain language — I can read, add, edit and delete anything in your account.\n\n' +
  '<b>Log</b>\n' +
  '• <i>“spent 250 on lunch”</i> — your own spending\n' +
  '• <i>“gave Jenil 300 for pizza”</i> — a friend owes you\n' +
  '• <i>“Shubham -600 paid back”</i> — a repayment\n\n' +
  '<b>Ask</b>\n' +
  '• <i>“who owes me money?”</i>\n' +
  '• <i>“show all transactions with Lakshya”</i>\n' +
  '• <i>“what did I spend on food in July?”</i>\n' +
  '• <i>“am I over budget?”</i>\n\n' +
  '<b>Change</b>\n' +
  '• <i>“rename Lakshya to Lakshya Mewara”</i>\n' +
  '• <i>“change the pizza entry to 400”</i>\n' +
  '• <i>“delete yesterday’s coffee expense”</i>\n' +
  '• <i>“set my monthly budget to 15000”</i>\n' +
  '• <i>“remind Jenil to pay”</i>\n\n' +
  'Anything that edits or deletes shows a preview first — nothing is saved until you tap ✅.\n\n' +
  '/unlink — disconnect this Telegram';

// Agentic turn handler (supports tools + proposals + queries).
async function handleExpenseMessage(chatId, tgId, userId, text) {
  if (!isLlmConfigured()) {
    await sendMessage(chatId, "⚠️ The assistant isn't set up yet. You can still add entries in the app.");
    return;
  }

  // Record incoming user message
  await saveChatMessage(userId, tgId, 'user', text);

  const { currency, people } = await getUserContext(userId);
  const history = await getRecentHistory(userId, 5);
  const today = new Date().toISOString().slice(0, 10);

  let agentResult;
  try {
    agentResult = await runAgentLoop({
      text,
      history,
      peopleNames: people.map((p) => p.name),
      today,
      userId,
    });
  } catch (e) {
    console.error('[telegram] agent loop failed:', e.message);
    await debugLog(chatId, 'AGENT LOOP FAILED', e.stack || e.message);
    const errReply =
      e.code === 'LLM_RATE_LIMITED'
        ? "⏳ I'm being rate limited right now. Give it a minute and send that again."
        : e.code === 'LLM_MODEL_UNAVAILABLE' || e.code === 'LLM_NOT_CONFIGURED'
        ? "⚠️ The assistant is misconfigured on the server (LLM unavailable). Retrying won't help — you can still add entries in the app."
        : "😵 I couldn't process that right now. Please try again.";
    await saveChatMessage(userId, tgId, 'assistant', errReply);
    await sendMessage(chatId, errReply);
    return;
  }

  // Case 1: Direct text answer from agent (e.g. balance query result)
  if (agentResult.type === 'text') {
    const textReply = agentResult.text;
    await saveChatMessage(userId, tgId, 'assistant', textReply);
    await sendMessage(chatId, textReply);
    return;
  }

  // Case 2: An edit/delete/settings change awaiting a tap. Nothing has been
  // written yet — the action is stashed and replayed on Confirm.
  if (agentResult.type === 'confirm') {
    await askToConfirm(chatId, tgId, userId, {
      kind: 'mutation',
      action: agentResult.action,
    }, agentResult.previewHtml);
    return;
  }

  // Case 3: Proposed ledger entries
  const extracted = agentResult.result;

  if (extracted.needs_clarification) {
    const askReply = `🤔 ${extracted.clarification || 'Could you clarify that?'}`;
    await saveChatMessage(userId, tgId, 'assistant', askReply);
    await sendMessage(chatId, `🤔 ${escape(extracted.clarification || 'Could you clarify that?')}`);
    return;
  }
  if (!extracted.entries.length) {
    const noEntryReply = "I didn't catch any amounts to log. Try “Jenil owes 250 for dinner”.";
    await saveChatMessage(userId, tgId, 'assistant', noEntryReply);
    await sendMessage(chatId, noEntryReply);
    return;
  }

  const resolved = resolveEntries(extracted.entries, people);

  const ambiguous = resolved.filter((e) => e.ambiguous);
  if (ambiguous.length) {
    const names = [...new Set(ambiguous.map((e) => e.matchedName))].map(escape).join(', ');
    const ambReply = `🤔 More than one person matches “${names}”. Please use their full name.`;
    await saveChatMessage(userId, tgId, 'assistant', ambReply);
    await sendMessage(chatId, ambReply);
    return;
  }

  await askToConfirm(
    chatId,
    tgId,
    userId,
    { kind: 'ledger_entries', resolved, currency },
    summaryText(resolved, currency),
  );
}

// Stashes a payload the inline buttons refer to by id, and asks. The bot is
// serverless, so the pending action has to survive in the database between the
// question and the tap.
async function askToConfirm(chatId, tgId, userId, payload, previewHtml) {
  const id = randomBytes(8).toString('hex');
  const { error } = await supabase.from('telegram_pending').insert({
    id,
    telegram_id: tgId,
    user_id: userId,
    payload,
  });
  if (error) {
    console.error('[telegram] pending insert failed:', error.message);
    await debugLog(chatId, 'PENDING INSERT ERROR', error);
    await sendMessage(chatId, '❌ Something went wrong. Please try again.');
    return;
  }

  const confirmMsg = `${previewHtml}\n\nConfirm?`;
  await saveChatMessage(userId, tgId, 'assistant', confirmMsg);
  await sendMessage(chatId, confirmMsg, {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Confirm', callback_data: `ok:${id}` },
        { text: '❌ Cancel', callback_data: `no:${id}` },
      ]],
    },
  });
}

// Handles a tap on the Confirm / Cancel inline buttons.
async function handleCallback(cq) {
  const chatId = cq.message?.chat?.id || cq.from?.id;
  const messageId = cq.message?.message_id;
  const tgId = cq.from?.id;
  const [action, id] = String(cq.data || '').split(':');

  await debugLog(chatId, 'CALLBACK RECEIVED', {
    action,
    id,
    tgId,
    chatId,
    messageId,
    cqData: cq.data
  });

  const ackRes = await answerCallbackQuery(cq.id);
  await debugLog(chatId, 'ANSWER CALLBACK RES', ackRes);

  if (!chatId || !id || (action !== 'ok' && action !== 'no')) {
    await debugLog(chatId, 'INVALID CALLBACK PARAMS', { chatId, id, action });
    return;
  }

  const { data: pending, error: pendingErr } = await supabase
    .from('telegram_pending').select('*').eq('id', id).maybeSingle();

  if (pendingErr) {
    await debugLog(chatId, 'PENDING LOOKUP ERROR', pendingErr);
  } else {
    await debugLog(chatId, 'PENDING RECORD FOUND', pending);
  }

  if (!pending || String(pending.telegram_id) !== String(tgId)) {
    await debugLog(chatId, 'EXPIRED OR ID MISMATCH', {
      hasPending: !!pending,
      pendingTgId: pending?.telegram_id,
      userTgId: tgId
    });
    await reply(chatId, messageId, '⌛ This confirmation has expired. Send the message again.');
    return;
  }
  // Consume it either way.
  const { error: delErr } = await supabase.from('telegram_pending').delete().eq('id', id);
  if (delErr) {
    await debugLog(chatId, 'DELETE PENDING ERROR', delErr);
  }

  if (action === 'no') {
    await reply(chatId, messageId, '❌ Cancelled — nothing was saved.');
    return;
  }

  // Payloads written before mutations existed have no `kind`; they are ledger
  // entries by definition.
  if (pending.payload?.kind === 'mutation') {
    await debugLog(chatId, 'APPLYING MUTATION', pending.payload.action);
    try {
      const { message } = await applyMutation(pending.user_id, pending.payload.action);
      await reply(chatId, messageId, message);
    } catch (e) {
      console.error('[telegram] mutation failed:', e);
      await debugLog(chatId, 'MUTATION CATCH ERROR', e.stack || e.message || String(e));
      await reply(
        chatId,
        messageId,
        e.code === 'TOOL_BAD_REQUEST'
          ? `❌ ${escape(e.message)}`
          : '❌ Could not apply that change. Please try again.',
      );
    }
    return;
  }

  const { resolved, currency } = pending.payload;
  await debugLog(chatId, 'TRYING WRITE ENTRIES', { userId: pending.user_id, resolved, currency });

  try {
    const affected = await writeEntries(pending.user_id, resolved);
    await debugLog(chatId, 'WRITE ENTRIES SUCCESS', { affected });

    const balances = await getBalances(pending.user_id, affected);
    await debugLog(chatId, 'BALANCES RETRIEVED', Array.from(balances.entries()));

    const lines = affected.map((pid) => {
      const entry = resolved.find((r) => {
        if (r.isNew) {
          return pid === affected.find((a) => a === pid) && r.matchedName;
        }
        return r.personId === pid;
      });
      const name = entry?.matchedName || 'They';
      return `• <b>${escape(name)}</b> now owes ${escape(formatAmount(balances.get(pid) ?? 0, currency))}`;
    });
    const finalMsg = `✅ Saved ${resolved.length} ${resolved.length === 1 ? 'entry' : 'entries'}.\n\n${lines.join('\n')}`;
    await debugLog(chatId, 'FINAL MSG READY', finalMsg);
    await reply(chatId, messageId, finalMsg);
  } catch (e) {
    console.error('[telegram] confirm failed:', e);
    await debugLog(chatId, 'CONFIRM CATCH ERROR', e.stack || e.message || String(e));
    await reply(chatId, messageId, '❌ Could not save those entries. Please try again.');
  }
}

// Tries to edit the original message; falls back to a new message if editing fails.
async function reply(chatId, messageId, text) {
  const result = await editMessageText(chatId, messageId, text);
  await debugLog(chatId, 'EDIT MESSAGE RESULT', result);
  if (result && !result.ok) {
    console.error('[telegram] editMessageText failed, falling back to sendMessage');
    const sendRes = await sendMessage(chatId, text);
    await debugLog(chatId, 'SEND MESSAGE FALLBACK RESULT', sendRes);
  }
}

// Human-readable summary of resolved entries for the confirm prompt.
function summaryText(resolved, currency) {
  const lines = resolved.map((e) => {
    const sign = e.amount >= 0 ? '+' : '−';
    const tag = e.isNew ? ' <i>(new)</i>' : '';
    const note = e.note ? ` — ${escape(e.note)}` : '';
    return `• <b>${escape(e.matchedName)}</b>${tag}  ${sign}${escape(formatAmount(Math.abs(e.amount), currency))}${note}`;
  });
  return `Here's what I understood:\n\n${lines.join('\n')}`;
}

function escape(s = '') {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export default router;
