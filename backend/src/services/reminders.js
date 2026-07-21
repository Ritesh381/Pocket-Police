import { supabase } from '../supabase.js';
import { isEmailConfigured, isTwilioConfigured } from '../config.js';
import { sendReminderEmail } from './email.js';
import { sendReminderSms, sendReminderWhatsApp } from './twilio.js';

function formatAmount(amount, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

// First day of the current month as YYYY-MM-DD (UTC), used for idempotency.
function monthStartISO() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// Core routine: find every debtor with a positive balance whose reminders are on
// (account-level AND per-person), then send on each enabled+available channel and
// log every attempt. Idempotent within a calendar month.
export async function runMonthlyReminders({ dryRun = false } = {}) {
  const summary = { debtors: 0, sent: 0, skipped: 0, failed: 0, channels: {}, dryRun };

  // 1. Positive balances across all users.
  const { data: balances, error: balErr } = await supabase
    .from('person_balances').select('person_id, user_id, balance').gt('balance', 0);
  if (balErr) throw new Error(`balances query failed: ${balErr.message}`);
  if (!balances?.length) return summary;

  const personIds = balances.map((b) => b.person_id);
  const userIds = [...new Set(balances.map((b) => b.user_id))];
  const balanceByPerson = new Map(balances.map((b) => [b.person_id, Number(b.balance)]));

  // 2. Relevant people (reminders on).
  const { data: people, error: peopleErr } = await supabase
    .from('people').select('*').in('id', personIds).eq('reminders_on', true);
  if (peopleErr) throw new Error(`people query failed: ${peopleErr.message}`);
  if (!people?.length) return summary;

  // 3. Account settings + profiles (currency, name, UPI) + expense history, keyed.
  const [{ data: settingsRows }, { data: profiles }, { data: monthLogs }, { data: allExpenses }] =
    await Promise.all([
      supabase.from('reminder_settings').select('*').in('user_id', userIds),
      supabase.from('profiles').select('id, currency, full_name, upi_id').in('id', userIds),
      supabase.from('reminder_logs').select('person_id, channel, status').gte('sent_at', monthStartISO()),
      supabase.from('expenses').select('person_id, amount, note, incurred_on').in('person_id', personIds)
        .order('incurred_on', { ascending: true }).order('created_at', { ascending: true }),
    ]);

  const settingsByUser = new Map((settingsRows || []).map((s) => [s.user_id, s]));
  const profileByUser = new Map((profiles || []).map((p) => [p.id, p]));
  const currencyByUser = new Map((profiles || []).map((p) => [p.id, p.currency || 'INR']));
  // person_id -> list of expenses (for the history table)
  const expensesByPerson = new Map();
  for (const e of allExpenses || []) {
    if (!expensesByPerson.has(e.person_id)) expensesByPerson.set(e.person_id, []);
    expensesByPerson.get(e.person_id).push(e);
  }
  // Set of `${person_id}:${channel}` already successfully sent this month.
  const alreadySent = new Set(
    (monthLogs || []).filter((l) => l.status === 'sent').map((l) => `${l.person_id}:${l.channel}`),
  );

  const logsToInsert = [];

  for (const person of people) {
    const settings = settingsByUser.get(person.user_id);
    // Default to reminders on + email if no settings row exists yet.
    const s = settings || { reminders_on: true, channel_email: true, channel_sms: false, channel_whatsapp: false };
    if (!s.reminders_on) continue;

    summary.debtors += 1;
    const balance = balanceByPerson.get(person.id) ?? 0;
    const currency = currencyByUser.get(person.user_id) || 'INR';
    const profile = profileByUser.get(person.user_id) || {};
    const lenderName = profile.full_name || 'ek dost';
    const upiId = profile.upi_id || null;
    const expenses = expensesByPerson.get(person.id) || [];
    const amountText = formatAmount(balance, currency);

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

    for (const ch of channels) {
      summary.channels[ch.name] = (summary.channels[ch.name] || 0) + 1;

      // Idempotency: don't re-send the same channel to the same person this month.
      if (alreadySent.has(`${person.id}:${ch.name}`)) {
        summary.skipped += 1;
        continue;
      }

      if (dryRun) {
        summary.sent += 1; // count what WOULD be sent
        continue;
      }

      try {
        const result = await ch.send();
        summary.sent += 1;
        logsToInsert.push({
          user_id: person.user_id, person_id: person.id, channel: ch.name,
          amount_owed: balance, status: 'sent', provider_id: result?.id ?? null,
        });
      } catch (err) {
        summary.failed += 1;
        logsToInsert.push({
          user_id: person.user_id, person_id: person.id, channel: ch.name,
          amount_owed: balance, status: 'failed', error: String(err?.message || err).slice(0, 500),
        });
      }
    }
  }

  if (!dryRun && logsToInsert.length) {
    const { error: logErr } = await supabase.from('reminder_logs').insert(logsToInsert);
    if (logErr) console.error('[reminders] failed to write logs:', logErr.message);
  }

  return summary;
}
