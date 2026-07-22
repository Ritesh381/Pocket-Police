import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAuth, requireCronSecret } from '../middleware/auth.js';
import { asyncHandler, supabaseError } from '../lib/helpers.js';
import { runReminders } from '../services/reminders.js';

const router = Router();

// Cron handler factory. Protected by CRON_SECRET (not a user JWT).
// ?dryRun=1 previews without sending.
function cronHandler(frequency) {
  return asyncHandler(async (req, res) => {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const summary = await runReminders({ dryRun, frequency });
    console.log(`[reminders:${frequency}] run complete:`, JSON.stringify(summary));
    res.json({ ok: true, summary });
  });
}

// Called by the GitHub Actions scheduled workflows.
router.post('/cron/send-monthly-reminders', requireCronSecret, cronHandler('monthly'));
router.post('/cron/send-weekly-reminders', requireCronSecret, cronHandler('weekly'));

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
