import { supabase } from '../supabase.js';
import { isEmailConfigured, isTwilioConfigured } from '../config.js';
import { sendReminderEmail } from './email.js';
import { sendReminderSms, sendReminderWhatsApp } from './twilio.js';

export function formatAmount(amount, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

// Start of the current idempotency period (UTC) for a given frequency.
// weekly -> most recent Monday 00:00; monthly -> 1st of the month 00:00.
function periodStartISO(frequency) {
  const d = new Date();
  if (frequency === 'weekly') {
    const day = d.getUTCDay(); // 0=Sun..6=Sat
    const sinceMonday = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - sinceMonday);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// Builds the list of send-able channels for a person given resolved context.
function buildChannels(person, ctx) {
  const { settings: s, balance, currency, lenderName, upiId, expenses, amountText } = ctx;
  const template = {
    subject: s.email_subject || null,
    message: s.email_message || null,
    closing: s.email_closing || null,
  };
  const channels = [];
  if (s.channel_email && person.email && isEmailConfigured())
    channels.push({ name: 'email', send: () => sendReminderEmail({ to: person.email, personName: person.name, lenderName, balance, currency, expenses, upiId, template }) });
  if (s.channel_sms && person.phone && isTwilioConfigured())
    channels.push({ name: 'sms', send: () => sendReminderSms({ to: person.phone, personName: person.name, lenderName, amountText, upiId }) });
  if (s.channel_whatsapp && person.whatsapp && isTwilioConfigured())
    channels.push({ name: 'whatsapp', send: () => sendReminderWhatsApp({ to: person.whatsapp, personName: person.name, lenderName, amountText, upiId }) });
  return channels;
}

const DEFAULT_SETTINGS = {
  reminders_on: true, reminder_frequency: 'monthly',
  channel_email: true, channel_sms: false, channel_whatsapp: false,
};

// Scheduled routine: for every debtor with a positive balance whose account is set
// to `frequency` and whose reminders are on (account + per-person), send on each
// enabled+available channel. Idempotent within the frequency's period.
export async function runReminders({ dryRun = false, frequency = 'monthly' } = {}) {
  const summary = { debtors: 0, sent: 0, skipped: 0, failed: 0, channels: {}, frequency, dryRun };

  const { data: balances, error: balErr } = await supabase
    .from('person_balances').select('person_id, user_id, balance').gt('balance', 0);
  if (balErr) throw new Error(`balances query failed: ${balErr.message}`);
  if (!balances?.length) return summary;

  const personIds = balances.map((b) => b.person_id);
  const userIds = [...new Set(balances.map((b) => b.user_id))];
  const balanceByPerson = new Map(balances.map((b) => [b.person_id, Number(b.balance)]));

  const { data: people, error: peopleErr } = await supabase
    .from('people').select('*').in('id', personIds).eq('reminders_on', true);
  if (peopleErr) throw new Error(`people query failed: ${peopleErr.message}`);
  if (!people?.length) return summary;

  const [{ data: settingsRows }, { data: profiles }, { data: periodLogs }, { data: allExpenses }] =
    await Promise.all([
      supabase.from('reminder_settings').select('*').in('user_id', userIds),
      supabase.from('profiles').select('id, currency, full_name, upi_id').in('id', userIds),
      supabase.from('reminder_logs').select('person_id, channel, status').gte('sent_at', periodStartISO(frequency)),
      supabase.from('expenses').select('person_id, amount, note, incurred_on').in('person_id', personIds)
        .order('incurred_on', { ascending: true }).order('created_at', { ascending: true }),
    ]);

  const settingsByUser = new Map((settingsRows || []).map((s) => [s.user_id, s]));
  const profileByUser = new Map((profiles || []).map((p) => [p.id, p]));
  const expensesByPerson = new Map();
  for (const e of allExpenses || []) {
    if (!expensesByPerson.has(e.person_id)) expensesByPerson.set(e.person_id, []);
    expensesByPerson.get(e.person_id).push(e);
  }
  const alreadySent = new Set(
    (periodLogs || []).filter((l) => l.status === 'sent').map((l) => `${l.person_id}:${l.channel}`),
  );

  const logsToInsert = [];

  for (const person of people) {
    const s = settingsByUser.get(person.user_id) || DEFAULT_SETTINGS;
    if (!s.reminders_on) continue;
    // This scheduled run only handles accounts set to THIS frequency.
    if ((s.reminder_frequency || 'monthly') !== frequency) continue;

    summary.debtors += 1;
    const balance = balanceByPerson.get(person.id) ?? 0;
    const profile = profileByUser.get(person.user_id) || {};
    const currency = profile.currency || 'INR';
    const ctx = {
      settings: s, balance, currency,
      lenderName: profile.full_name || 'a friend',
      upiId: profile.upi_id || null,
      expenses: expensesByPerson.get(person.id) || [],
      amountText: formatAmount(balance, currency),
    };

    for (const ch of buildChannels(person, ctx)) {
      summary.channels[ch.name] = (summary.channels[ch.name] || 0) + 1;
      if (alreadySent.has(`${person.id}:${ch.name}`)) { summary.skipped += 1; continue; }
      if (dryRun) { summary.sent += 1; continue; }
      try {
        const result = await ch.send();
        summary.sent += 1;
        logsToInsert.push({ user_id: person.user_id, person_id: person.id, channel: ch.name, amount_owed: balance, status: 'sent', provider_id: result?.id ?? null });
      } catch (err) {
        summary.failed += 1;
        logsToInsert.push({ user_id: person.user_id, person_id: person.id, channel: ch.name, amount_owed: balance, status: 'failed', error: String(err?.message || err).slice(0, 500) });
      }
    }
  }

  if (!dryRun && logsToInsert.length) {
    const { error: logErr } = await supabase.from('reminder_logs').insert(logsToInsert);
    if (logErr) console.error('[reminders] failed to write logs:', logErr.message);
  }

  return summary;
}

// Backward-compatible alias.
export const runMonthlyReminders = (opts = {}) => runReminders({ ...opts, frequency: 'monthly' });

// Manual "remind now" for a single person — sends immediately on all enabled+
// available channels, ignoring the per-person toggle and idempotency window.
export async function remindPerson(personId, userId) {
  const { data: person, error } = await supabase
    .from('people').select('*').eq('id', personId).eq('user_id', userId).single();
  if (error || !person) { const e = new Error('Person not found'); e.status = 404; throw e; }

  const [{ data: bal }, { data: settings }, { data: profile }, { data: expenses }] = await Promise.all([
    supabase.from('person_balances').select('balance').eq('person_id', personId).maybeSingle(),
    supabase.from('reminder_settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('profiles').select('currency, full_name, upi_id').eq('id', userId).maybeSingle(),
    supabase.from('expenses').select('amount, note, incurred_on').eq('person_id', personId)
      .order('incurred_on', { ascending: true }).order('created_at', { ascending: true }),
  ]);

  const s = settings || DEFAULT_SETTINGS;
  const balance = Number(bal?.balance ?? 0);
  const currency = profile?.currency || 'INR';
  const ctx = {
    settings: s, balance, currency,
    lenderName: profile?.full_name || 'a friend',
    upiId: profile?.upi_id || null,
    expenses: expenses || [],
    amountText: formatAmount(balance, currency),
  };

  const channels = buildChannels(person, ctx);
  if (!channels.length) {
    const e = new Error('No channel available. Enable a channel in Settings and make sure this person has that contact detail saved.');
    e.status = 400;
    throw e;
  }

  const summary = { sent: 0, failed: 0, channels: {} };
  const logs = [];
  for (const ch of channels) {
    try {
      const result = await ch.send();
      summary.sent += 1; summary.channels[ch.name] = 'sent';
      logs.push({ user_id: userId, person_id: personId, channel: ch.name, amount_owed: balance, status: 'sent', provider_id: result?.id ?? null });
    } catch (err) {
      summary.failed += 1; summary.channels[ch.name] = 'failed';
      logs.push({ user_id: userId, person_id: personId, channel: ch.name, amount_owed: balance, status: 'failed', error: String(err?.message || err).slice(0, 500) });
    }
  }
  if (logs.length) await supabase.from('reminder_logs').insert(logs);
  return summary;
}
