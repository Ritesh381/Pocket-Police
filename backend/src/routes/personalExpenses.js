import { Router } from 'express';
import { supabase } from '../supabase.js';
import { asyncHandler, supabaseError, parseBody } from '../lib/helpers.js';
import { personalExpenseCreateSchema, personalExpenseUpdateSchema } from '../lib/schemas.js';

const router = Router();

// GET /api/personal-expenses/analytics — monthly summary, category breakdown, budget progress
router.get('/analytics', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const monthYear = req.query.month || new Date().toISOString().slice(0, 7); // e.g. "2026-07"
  const startDate = `${monthYear}-01`;
  
  // Calculate end date (last day of month)
  const [year, month] = monthYear.split('-').map(Number);
  const lastDayNum = new Date(year, month, 0).getDate();
  const endDate = `${monthYear}-${String(lastDayNum).padStart(2, '0')}`;

  const [
    { data: expenses, error: expErr },
    { data: categories, error: catErr },
    { data: budgetData, error: budErr },
  ] = await Promise.all([
    supabase
      .from('personal_expenses')
      .select('id, amount, category_id, incurred_on')
      .eq('user_id', userId)
      .gte('incurred_on', startDate)
      .lte('incurred_on', endDate),
    supabase
      .from('expense_categories')
      .select('id, name, icon, color, is_system'),
    supabase
      .from('budgets')
      .select('monthly_limit')
      .eq('user_id', userId)
      .eq('month_year', monthYear)
      .maybeSingle(),
  ]);

  if (expErr) throw supabaseError(expErr);
  if (catErr) throw supabaseError(catErr);
  if (budErr) throw supabaseError(budErr);

  const categoryMap = new Map((categories || []).map((c) => [c.id, c]));

  let totalSpent = 0;
  const catSums = new Map(); // category_id -> sum

  (expenses || []).forEach((e) => {
    const amt = Number(e.amount);
    totalSpent += amt;
    const catId = e.category_id || 'uncategorized';
    catSums.set(catId, (catSums.get(catId) || 0) + amt);
  });

  const categoryBreakdown = Array.from(catSums.entries()).map(([catId, amount]) => {
    const cat = categoryMap.get(catId) || { name: 'Others', icon: 'category', color: '#6b7280' };
    return {
      category_id: catId,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      amount,
      percentage: totalSpent > 0 ? Number(((amount / totalSpent) * 100).toFixed(1)) : 0,
    };
  });
  categoryBreakdown.sort((a, b) => b.amount - a.amount);

  const monthlyLimit = Number(budgetData?.monthly_limit || 0);
  const daysInMonth = lastDayNum;
  const todayDate = new Date();
  const currentDay = todayDate.toISOString().slice(0, 7) === monthYear ? todayDate.getDate() : daysInMonth;
  const dailyAverage = currentDay > 0 ? Number((totalSpent / currentDay).toFixed(2)) : 0;

  res.json({
    month_year: monthYear,
    total_spent: Number(totalSpent.toFixed(2)),
    monthly_limit: monthlyLimit,
    remaining_budget: monthlyLimit > 0 ? Number((monthlyLimit - totalSpent).toFixed(2)) : null,
    budget_usage_percent: monthlyLimit > 0 ? Number(((totalSpent / monthlyLimit) * 100).toFixed(1)) : null,
    daily_average: dailyAverage,
    transaction_count: (expenses || []).length,
    category_breakdown: categoryBreakdown,
  });
}));

// GET /api/personal-expenses — list personal expenses with filtering and category details
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const monthYear = req.query.month; // optional "YYYY-MM"
  const categoryId = req.query.category_id; // optional
  const q = (req.query.q || '').trim().toLowerCase();

  let query = supabase
    .from('personal_expenses')
    .select(`
      *,
      category:expense_categories(id, name, icon, color)
    `)
    .eq('user_id', userId)
    .order('incurred_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (monthYear) {
    const startDate = `${monthYear}-01`;
    const [year, month] = monthYear.split('-').map(Number);
    const lastDayNum = new Date(year, month, 0).getDate();
    const endDate = `${monthYear}-${String(lastDayNum).padStart(2, '0')}`;
    query = query.gte('incurred_on', startDate).lte('incurred_on', endDate);
  }

  if (categoryId) {
    query = query.eq('category_id', categoryId);
  }

  const { data, error } = await query;
  if (error) throw supabaseError(error);

  let filtered = data || [];
  if (q) {
    filtered = filtered.filter((e) =>
      (e.note || '').toLowerCase().includes(q) ||
      (e.category?.name || '').toLowerCase().includes(q)
    );
  }

  res.json({ personal_expenses: filtered });
}));

// POST /api/personal-expenses — add a personal expense
router.post('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const input = parseBody(personalExpenseCreateSchema, req.body);

  const { data, error } = await supabase
    .from('personal_expenses')
    .insert({
      ...input,
      user_id: userId,
    })
    .select(`
      *,
      category:expense_categories(id, name, icon, color)
    `)
    .single();

  if (error) throw supabaseError(error);
  res.status(201).json({ personal_expense: data });
}));

// PATCH /api/personal-expenses/:id — update a personal expense
router.patch('/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const input = parseBody(personalExpenseUpdateSchema, req.body);

  const { data, error } = await supabase
    .from('personal_expenses')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', req.params.id)
    .select(`
      *,
      category:expense_categories(id, name, icon, color)
    `)
    .single();

  if (error) throw supabaseError(error, 'Personal expense not found');
  res.json({ personal_expense: data });
}));

// DELETE /api/personal-expenses/:id — delete a personal expense
router.delete('/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { data, error } = await supabase
    .from('personal_expenses')
    .delete()
    .eq('user_id', userId)
    .eq('id', req.params.id)
    .select('id')
    .single();

  if (error) throw supabaseError(error, 'Personal expense not found');
  res.json({ deleted: data.id });
}));

export default router;
