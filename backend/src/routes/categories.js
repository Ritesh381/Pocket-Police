import { Router } from 'express';
import { supabase } from '../supabase.js';
import { asyncHandler, supabaseError, parseBody } from '../lib/helpers.js';
import { categoryCreateSchema } from '../lib/schemas.js';

const router = Router();

// GET /api/categories — list system preset categories + user's custom categories
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .or(`is_system.eq.true,user_id.eq.${userId}`)
    .order('is_system', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw supabaseError(error);
  res.json({ categories: data || [] });
}));

// POST /api/categories — add a custom category for the signed-in user
router.post('/', asyncHandler(async (req, res) => {
  const input = parseBody(categoryCreateSchema, req.body);
  const { data, error } = await supabase
    .from('expense_categories')
    .insert({
      ...input,
      user_id: req.user.id,
      is_system: false,
    })
    .select()
    .single();

  if (error) throw supabaseError(error);
  res.status(201).json({ category: data });
}));

export default router;
