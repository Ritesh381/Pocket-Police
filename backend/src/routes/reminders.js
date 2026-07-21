import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAuth, requireCronSecret } from '../middleware/auth.js';
import { asyncHandler, supabaseError } from '../lib/helpers.js';
import { runMonthlyReminders } from '../services/reminders.js';

const router = Router();

// POST /api/cron/send-monthly-reminders
// Called by the GitHub Actions scheduled workflow. Protected by CRON_SECRET,
// NOT a user JWT. Pass ?dryRun=1 to preview without sending.
router.post('/cron/send-monthly-reminders', requireCronSecret, asyncHandler(async (req, res) => {
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
  const summary = await runMonthlyReminders({ dryRun });
  console.log('[reminders] run complete:', JSON.stringify(summary));
  res.json({ ok: true, summary });
}));

// GET /api/reminders/logs — reminder history for the signed-in user.
router.get('/reminders/logs', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('reminder_logs')
    .select('*, people(name)')
    .eq('user_id', req.user.id)
    .order('sent_at', { ascending: false })
    .limit(200);
  if (error) throw supabaseError(error);
  res.json({ logs: data });
}));

export default router;
