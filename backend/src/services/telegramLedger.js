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

function editDistance(a, b) {
  // Levenshtein, iterative single-row. Names are short, so this is cheap.
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

// Last-resort match for a name the model mistyped ("Shubram" for "Shubham").
// Without this a typo silently creates a duplicate contact and splits someone's
// balance across two rows. Only fires on an unambiguous single near-miss.
export function closestName(want, names) {
  const w = norm(want);
  if (w.length < 4) return null;
  const tolerance = w.length <= 6 ? 1 : 2;
  const hits = names.filter((n) => editDistance(w, norm(n)) <= tolerance);
  return hits.length === 1 ? hits[0] : null;
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
    const near = closestName(e.person, people.map((p) => p.name));
    if (near) {
      const p = people.find((x) => x.name === near);
      return { ...e, personId: p.id, matchedName: p.name, isNew: false, ambiguous: false };
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

// Saves a message to chat history for context.
export async function saveChatMessage(userId, telegramId, role, content) {
  if (!content) return;
  try {
    await supabase.from('telegram_chat_history').insert({
      user_id: userId,
      telegram_id: telegramId,
      role,
      content,
    });
  } catch (e) {
    console.error('[telegram] failed to save chat message:', e.message);
  }
}

// Fetches the last N messages for a user in chronological order.
export async function getRecentHistory(userId, limit = 5) {
  try {
    const { data } = await supabase
      .from('telegram_chat_history')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!data) return [];
    return data.reverse().map((m) => ({ role: m.role, content: m.content }));
  } catch (e) {
    console.error('[telegram] failed to fetch chat history:', e.message);
    return [];
  }
}

// Tool helper: Look up a person's balance by name (fuzzy/case-insensitive).
export async function getPersonBalanceByName(userId, name) {
  const { people, currency } = await getUserContext(userId);
  const want = norm(name);
  const matched = people.find((p) => norm(p.name) === want || norm(p.name).includes(want) || want.includes(norm(p.name)));
  if (!matched) {
    return { found: false, name, message: `Person "${name}" is not currently in your records.` };
  }

  const { data: bal } = await supabase
    .from('person_balances')
    .select('balance')
    .eq('person_id', matched.id)
    .maybeSingle();

  const balance = Number(bal?.balance ?? 0);
  return {
    found: true,
    person_id: matched.id,
    name: matched.name,
    balance,
    currency,
    formatted: formatAmount(balance, currency),
  };
}

// Tool helper: List all people and their balances for this user.
export async function listAllBalances(userId) {
  const [{ data: people }, { data: balances }, { currency }] = await Promise.all([
    supabase.from('people').select('id, name').eq('user_id', userId),
    supabase.from('person_balances').select('person_id, balance').eq('user_id', userId),
    getUserContext(userId),
  ]);

  const balanceById = new Map((balances || []).map((b) => [b.person_id, Number(b.balance)]));
  const list = (people || []).map((p) => {
    const bal = balanceById.get(p.id) ?? 0;
    return {
      name: p.name,
      balance: bal,
      formatted: formatAmount(bal, currency),
    };
  });
  list.sort((a, b) => b.balance - a.balance);

  return { currency, total_people: list.length, people: list };
}

// Tool helper: Get recent expense history for a person by name.
export async function getExpenseHistoryByName(userId, name, limit = 5) {
  const { people, currency } = await getUserContext(userId);
  const want = norm(name);
  const matched = people.find((p) => norm(p.name) === want || norm(p.name).includes(want) || want.includes(norm(p.name)));
  if (!matched) {
    return { found: false, name, message: `Person "${name}" is not currently in your records.` };
  }

  const { data: expenses } = await supabase
    .from('expenses')
    .select('amount, note, incurred_on, created_at')
    .eq('user_id', userId)
    .eq('person_id', matched.id)
    .order('incurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  return {
    found: true,
    name: matched.name,
    currency,
    expenses: (expenses || []).map((e) => ({
      amount: Number(e.amount),
      formatted: formatAmount(Number(e.amount), currency),
      note: e.note || 'No description',
      date: e.incurred_on,
    })),
  };
}

// Tool helper: Log a personal expense directly from Telegram bot
export async function logPersonalExpenseFromBot(userId, { amount, category, note, payment_mode, date }) {
  const { currency } = await getUserContext(userId);

  // Match category by name or fallback to 'Others'
  let categoryId = null;
  let categoryName = category || 'Others';

  if (category) {
    const wantCat = norm(category);
    const { data: cats } = await supabase
      .from('expense_categories')
      .select('id, name')
      .or(`is_system.eq.true,user_id.eq.${userId}`);

    const matchedCat = (cats || []).find((c) => norm(c.name).includes(wantCat) || wantCat.includes(norm(c.name)));
    if (matchedCat) {
      categoryId = matchedCat.id;
      categoryName = matchedCat.name;
    }
  }

  const { data, error } = await supabase
    .from('personal_expenses')
    .insert({
      user_id: userId,
      category_id: categoryId,
      amount: Math.abs(amount),
      note: note || categoryName,
      payment_mode: payment_mode || 'upi',
      ...(date ? { incurred_on: date } : {}),
    })
    .select('id, amount, note, incurred_on')
    .single();

  if (error) throw new Error(`Could not log personal expense: ${error.message}`);

  return {
    success: true,
    id: data.id,
    amount: Number(data.amount),
    formatted_amount: formatAmount(Number(data.amount), currency),
    category: categoryName,
    note: data.note,
  };
}

export { formatAmount };
