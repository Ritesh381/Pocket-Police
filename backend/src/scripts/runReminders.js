// Manual runner for the monthly reminder job. Useful for local testing.
//   npm run reminders:manual            (real send)
//   npm run reminders:manual -- --dry   (preview only, no sends)
import { runMonthlyReminders } from '../services/reminders.js';

const dryRun = process.argv.includes('--dry');

runMonthlyReminders({ dryRun })
  .then((summary) => {
    console.log(`\nReminder run (${dryRun ? 'DRY RUN' : 'LIVE'}) complete:`);
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('Reminder run failed:', err);
    process.exit(1);
  });
