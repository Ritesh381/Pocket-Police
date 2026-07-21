import { Router } from 'express';
import { supabase } from '../supabase.js';
import { asyncHandler, supabaseError } from '../lib/helpers.js';

const router = Router();

// GET /api/dashboard — summary for the home screen.
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const [{ data: people, error: peopleErr }, { data: balances, error: balErr }] =
    await Promise.all([
      supabase.from('people').select('*').eq('user_id', userId),
      supabase.from('person_balances').select('person_id, balance').eq('user_id', userId),
    ]);
  if (peopleErr) throw supabaseError(peopleErr);
  if (balErr) throw supabaseError(balErr);

  const balanceById = new Map((balances || []).map((b) => [b.person_id, Number(b.balance)]));
  const enriched = (people || []).map((p) => ({ ...p, balance: balanceById.get(p.id) ?? 0 }));
  enriched.sort((a, b) => b.balance - a.balance);

  // Total outstanding = sum of positive balances only (money owed TO the user).
  const totalOutstanding = enriched.reduce((sum, p) => sum + (p.balance > 0 ? p.balance : 0), 0);
  const debtorCount = enriched.filter((p) => p.balance > 0).length;

  // This-month activity from expenses.
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const { data: monthExpenses, error: expErr } = await supabase
    .from('expenses')
    .select('amount')
    .eq('user_id', userId)
    .gte('incurred_on', startOfMonth.toISOString().slice(0, 10));
  if (expErr) throw supabaseError(expErr);

  let lentThisMonth = 0;
  let collectedThisMonth = 0;
  for (const e of monthExpenses || []) {
    const amt = Number(e.amount);
    if (amt > 0) lentThisMonth += amt;
    else collectedThisMonth += -amt;
  }

  res.json({
    total_outstanding: Number(totalOutstanding.toFixed(2)),
    debtor_count: debtorCount,
    people_count: enriched.length,
    lent_this_month: Number(lentThisMonth.toFixed(2)),
    collected_this_month: Number(collectedThisMonth.toFixed(2)),
    people: enriched,
  });
}));

export default router;
