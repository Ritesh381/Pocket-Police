import { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth, redirectTo } from '../lib/auth';
import { api } from '../lib/api';
import { Button } from '../components/ui';
import { useTheme } from '../lib/theme';

export default function SignIn() {
  const { signInWithGoogle } = useAuth();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [loading, setLoading] = useState(false);

  const onGoogle = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      Alert.alert('Sign-in failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.hero}>
        <MaterialIcons name="receipt-long" size={72} color={colors.primary} style={{ marginBottom: 16 }} />
        <Text style={s.title}>Pocket Police</Text>
        <Text style={s.subtitle}>Track who owes you — and let the app do the chasing.</Text>
      </View>
      <View style={s.footer}>
        <Button title="Continue with Google" onPress={onGoogle} loading={loading} />
        <Text style={s.fine}>You'll sign in securely with your Google account.</Text>
        {__DEV__ && (
          <View style={s.debug}>
            <Text style={s.debugText}>API: {api.base}</Text>
            <Text style={s.debugText}>Redirect: {redirectTo}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'space-between' },
    hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 34, fontWeight: '800', color: colors.text },
    subtitle: { fontSize: 16, color: colors.muted, textAlign: 'center', marginTop: 12, paddingHorizontal: 20 },
    footer: { paddingBottom: 12 },
    fine: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 12 },
    debug: { marginTop: 20, padding: 10, backgroundColor: colors.debugBg, borderRadius: 8 },
    debugText: { fontSize: 11, color: colors.debugText, fontFamily: 'monospace' },
  });
