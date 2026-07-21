import app from './app.js';
import { config } from './config.js';

// Local / long-lived server entry (used by `npm run dev` and `npm start`).
// On Vercel the app is imported by api/index.js as a serverless handler instead.
app.listen(config.port, () => {
  console.log(`\n🧾 Pocket Police backend listening on http://localhost:${config.port}`);
  console.log(`   Health:  GET /health`);
  console.log(`   Supabase: ${config.supabase.url}`);
});
