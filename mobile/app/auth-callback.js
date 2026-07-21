import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

// Handles the deep link Supabase redirects to after Google auth:
//   vasulibhai://auth-callback?code=...
// Exchanges the code for a session (if not already done by the in-app browser
// handler), then sends the user home. Idempotent — a second exchange just no-ops.
export default function AuthCallback() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useTheme();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session && params.code) {
          await supabase.auth.exchangeCodeForSession(String(params.code));
        }
      } catch (e) {
        // Code already used / expired — session likely already set. Fall through.
      } finally {
        router.replace('/');
      }
    })();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
