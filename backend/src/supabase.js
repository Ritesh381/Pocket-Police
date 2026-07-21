import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// Server-side Supabase client using the SECRET (service-role) key.
// This bypasses Row-Level Security, so EVERY query in this backend MUST
// scope by the authenticated user's id (req.user.id). RLS remains enabled
// in the database as defense-in-depth for any direct client access.
export const supabase = createClient(config.supabase.url, config.supabase.secretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
