import { Router } from 'express';
import { supabase } from '../supabase.js';
import { asyncHandler, supabaseError, parseBody } from '../lib/helpers.js';
import { budgetUpdateSchema } from '../lib/schemas.js';

const router = Router();

// GET /api/budgets?month=2026-07 — get budget for a specific month (defaults to current month)
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const monthYear = req.query.month || new Date().toISOString().slice(0, 7);

  const { data, error } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', userId)
    .eq('month_year', monthYear)
    .maybeSingle();

  if (error) throw supabaseError(error);
  res.json({ budget: data || null, month_year: monthYear });
}));

// POST /api/budgets — set or update monthly budget goal
router.post('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const input = parseBody(budgetUpdateSchema, req.body);

  const { data, error } = await supabase
    .from('budgets')
    .upsert({
      user_id: userId,
      month_year: input.month_year,
      monthly_limit: input.monthly_limit,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,month_year' })
    .select()
    .single();

  if (error) throw supabaseError(error);
  res.json({ budget: data });
}));

export default router;
