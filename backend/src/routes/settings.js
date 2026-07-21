import { Router } from 'express';
import { supabase } from '../supabase.js';
import { asyncHandler, supabaseError, parseBody } from '../lib/helpers.js';
import { settingsUpdateSchema } from '../lib/schemas.js';
import { EMAIL_DEFAULTS } from '../services/email.js';

const router = Router();

// GET /api/settings — account-level reminder settings (auto-creates defaults).
// Also returns the default email text so the app can show it as placeholders.
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  let { data, error } = await supabase
    .from('reminder_settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw supabaseError(error);

  if (!data) {
    const { data: created, error: insErr } = await supabase
      .from('reminder_settings').insert({ user_id: userId }).select().single();
    if (insErr) throw supabaseError(insErr);
    data = created;
  }
  res.json({ settings: data, email_defaults: EMAIL_DEFAULTS });
}));

// PATCH /api/settings — toggle reminders and channels.
router.patch('/', asyncHandler(async (req, res) => {
  const input = parseBody(settingsUpdateSchema, req.body);
  const { data, error } = await supabase
    .from('reminder_settings')
    .upsert(
      { user_id: req.user.id, ...input, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    .select()
    .single();
  if (error) throw supabaseError(error);
  res.json({ settings: data });
}));

export default router;
