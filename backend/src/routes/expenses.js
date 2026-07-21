import { Router } from 'express';
import { supabase } from '../supabase.js';
import { asyncHandler, supabaseError, parseBody } from '../lib/helpers.js';
import { expenseUpdateSchema } from '../lib/schemas.js';

const router = Router();

// PATCH /api/expenses/:id — edit an expense.
router.patch('/:id', asyncHandler(async (req, res) => {
  const input = parseBody(expenseUpdateSchema, req.body);
  const { data, error } = await supabase
    .from('expenses')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('user_id', req.user.id)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw supabaseError(error, 'Expense not found');
  res.json({ expense: data });
}));

// DELETE /api/expenses/:id — delete an expense.
router.delete('/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('expenses')
    .delete()
    .eq('user_id', req.user.id)
    .eq('id', req.params.id)
    .select('id')
    .single();
  if (error) throw supabaseError(error, 'Expense not found');
  res.json({ deleted: data.id });
}));

export default router;
