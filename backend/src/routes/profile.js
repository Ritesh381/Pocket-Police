import { Router } from 'express';
import { supabase } from '../supabase.js';
import { asyncHandler, supabaseError, parseBody } from '../lib/helpers.js';
import { profileUpdateSchema } from '../lib/schemas.js';

const router = Router();

// GET /api/me — the signed-in user's profile. Auto-provisions if the DB trigger
// hasn't created it yet (defensive; the trigger normally handles this).
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  let { data, error } = await supabase
    .from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw supabaseError(error);

  if (!data) {
    const { data: created, error: insErr } = await supabase
      .from('profiles')
      .insert({ id: userId, email: req.user.email })
      .select()
      .single();
    if (insErr) throw supabaseError(insErr);
    await supabase.from('reminder_settings').insert({ user_id: userId }).select();
    data = created;
  }

  res.json({ profile: data });
}));

// PATCH /api/me — update display name / currency.
router.patch('/', asyncHandler(async (req, res) => {
  const input = parseBody(profileUpdateSchema, req.body);
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', req.user.id)
    .select()
    .single();
  if (error) throw supabaseError(error);
  res.json({ profile: data });
}));

export default router;
