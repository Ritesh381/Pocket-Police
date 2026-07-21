import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';

// Supabase signs user JWTs with asymmetric keys (new API-key format).
// We verify them locally against the project's JWKS — no round-trip to Supabase.
const JWKS = createRemoteJWKSet(new URL(config.supabase.jwksUrl));

// requireAuth: validates the Bearer token and attaches req.user = { id, email }.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    // `sub` is the Supabase user id (== auth.uid()).
    req.user = { id: payload.sub, email: payload.email };
    if (!req.user.id) {
      return res.status(401).json({ error: 'Token missing subject' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// requireCronSecret: protects the scheduled reminder endpoint. The GitHub Actions
// workflow sends `Authorization: Bearer <CRON_SECRET>`.
export function requireCronSecret(req, res, next) {
  if (!config.cronSecret) {
    return res.status(503).json({ error: 'CRON_SECRET not configured on server' });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (token !== config.cronSecret) {
    return res.status(401).json({ error: 'Invalid cron secret' });
  }
  next();
}
