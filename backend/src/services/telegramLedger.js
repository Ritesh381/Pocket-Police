// Deterministic (non-LLM) half of the Telegram bot's expense logging:
// resolve extracted entries against the user's people, and write them using the
// SAME user-scoped Supabase inserts the app uses. No SQL ever comes from the LLM.
import { supabase } from '../supabase.js';
import { formatAmount } from './reminders.js';

// Loads the currency + people roster for a linked user.
export async function getUserContext(userId) {
  const [{ data: profile }, { data: people }] = await Promise.all([
    supabase.from('profiles').select('currency, full_name').eq('id', userId).maybeSingle(),
    supabase.from('people').select('id, name').eq('user_id', userId),
  ]);
  return {
    currency: profile?.currency || 'INR',
    fullName: profile?.full_name || null,
    people: people || [],
  };
}

function norm(s = '') {
  return String(s).trim().toLowerCase();
}

// Attaches a resolution to each extracted entry:
//   { ...entry, personId, matchedName, isNew, ambiguous }
// Matching is exact (case-insensitive) → substring. Unknown names are flagged
// isNew (created on confirm). Substring hits that match >1 person are ambiguous.
export function resolveEntries(entries, people) {
  return entries.map((e) => {
    const want = norm(e.person);
    const exact = people.filter((p) => norm(p.name) === want);
    if (exact.length === 1) {
      return { ...e, personId: exact[0].id, matchedName: exact[0].name, isNew: false, ambiguous: false };
    }
    const partial = people.filter((p) => norm(p.name).includes(want) || want.includes(norm(p.name)));
    if (partial.length === 1) {
      return { ...e, personId: partial[0].id, matchedName: partial[0].name, isNew: false, ambiguous: false };
    }
    if (partial.length > 1) {
      return { ...e, personId: null, matchedName: e.person, isNew: false, ambiguous: true };
    }
    return { ...e, personId: null, matchedName: e.person, isNew: true, ambiguous: false };
  });
}

// Writes resolved entries: creates any new people, then inserts one expense per
// entry. Returns the set of affected person ids. Everything is scoped to userId.
export async function writeEntries(userId, resolved) {
  // Create new people (dedupe by normalized name so "Aman" twice → one person).
  const newNames = [...new Set(resolved.filter((e) => e.isNew).map((e) => e.matchedName))];
  const createdByName = new Map();
  for (const name of newNames) {
    const { data, error } = await supabase
      .from('people')
      .insert({ user_id: userId, name })
      .select('id, name')
      .single();
    if (error) throw new Error(`Could not create "${name}": ${error.message}`);
    createdByName.set(norm(name), data.id);
  }

  const rows = resolved.map((e) => ({
    user_id: userId,
    person_id: e.isNew ? createdByName.get(norm(e.matchedName)) : e.personId,
    amount: e.amount,
    note: e.note || null,
    ...(e.date ? { incurred_on: e.date } : {}),
  }));

  const { error } = await supabase.from('expenses').insert(rows);
  if (error) throw new Error(`Could not save entries: ${error.message}`);

  return [...new Set(rows.map((r) => r.person_id))];
}

// Current balances for a set of people, as a Map(personId → number).
export async function getBalances(userId, personIds) {
  const { data } = await supabase
    .from('person_balances')
    .select('person_id, balance')
    .eq('user_id', userId)
    .in('person_id', personIds);
  return new Map((data || []).map((b) => [b.person_id, Number(b.balance)]));
}

export { formatAmount };
