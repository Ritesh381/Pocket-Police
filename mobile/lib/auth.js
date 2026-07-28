import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

const AuthContext = createContext({});
export const useAuth = () => useContext(AuthContext);

// The deep link Supabase redirects back to after Google auth.
// Expo Go -> exp://<ip>:8081/--/auth-callback ; dev/standalone -> vasulibhai://auth-callback
export const redirectTo = makeRedirectUri({ path: 'auth-callback' });

async function createSessionFromUrl(url) {
  if (!url) return null;
  const { params, errorCode } = QueryParams(url);
  if (errorCode) {
    console.warn('[auth] Deep link error code:', errorCode, params.error_description);
    throw new Error(params.error_description || errorCode);
  }

  // PKCE flow returns a `code` to exchange; implicit returns tokens directly.
  if (params.code) {
    // Check if session is already active (to prevent duplicate exchange error)
    const { data: current } = await supabase.auth.getSession();
    if (current?.session) return current.session;

    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) {
      // If code was already exchanged by another handler, ignore if session exists
      const { data: check } = await supabase.auth.getSession();
      if (check?.session) return check.session;
      throw error;
    }
    return data.session;
  }
  if (params.access_token) {
    const { data, error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (error) throw error;
    return data.session;
  }
  return null;
}

// Minimal query/fragment parser (avoids extra deps).
function QueryParams(url) {
  const out = { params: {}, errorCode: null };
  try {
    const u = new URL(url);
    const search = new URLSearchParams(u.search);
    const hash = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash);
    for (const [k, v] of search) out.params[k] = v;
    for (const [k, v] of hash) out.params[k] = v;
    out.errorCode = out.params.error_code || out.params.error || null;
  } catch {
    /* ignore */
  }
  return out;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Handle the deep link when the browser redirects back into the app.
  const url = Linking.useURL();
  useEffect(() => {
    if (url && url.includes('auth-callback')) {
      if (__DEV__) console.log('[auth] Received deep link:', url);
      createSessionFromUrl(url)
        .then(() => WebBrowser.dismissBrowser())
        .catch((e) => console.warn('[auth] callback error:', e.message));
    }
  }, [url]);

  const signInWithGoogle = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;

      if (__DEV__) console.log('[auth] Opening auth session for URL:', data.url, 'with redirect:', redirectTo);
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success' && result.url) {
        await createSessionFromUrl(result.url);
      }
    } finally {
      WebBrowser.dismissBrowser();
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
