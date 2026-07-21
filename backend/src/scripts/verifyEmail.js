// Verifies SMTP credentials without sending an email.
//   npm run email:verify
import { verifyEmail } from '../services/email.js';
import { config } from '../config.js';

console.log(`Verifying SMTP: ${config.email.smtpUser}@${config.email.smtpHost}:${config.email.smtpPort} (secure=${config.email.smtpSecure})`);
verifyEmail()
  .then(() => { console.log('✅ SMTP connection OK — credentials accepted.'); process.exit(0); })
  .catch((err) => { console.error('❌ SMTP verify failed:', err.message); process.exit(1); });
