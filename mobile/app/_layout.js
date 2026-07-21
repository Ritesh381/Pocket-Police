import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../lib/auth';
import { ThemeProvider, useTheme } from '../lib/theme';

function RootNavigator() {
  const { session, loading } = useAuth();
  const { colors, scheme } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthFlow = segments[0] === 'sign-in' || segments[0] === 'auth-callback';
    if (!session && !inAuthFlow) {
      router.replace('/sign-in');
    } else if (session && segments[0] === 'sign-in') {
      router.replace('/');
    }
  }, [session, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="reminders" options={{ title: 'Reminder history' }} />
        <Stack.Screen name="person/new" options={{ title: 'Add Person', presentation: 'modal' }} />
        <Stack.Screen name="person/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="person/[id]/edit" options={{ title: 'Edit Person', presentation: 'modal' }} />
        <Stack.Screen name="person/[id]/add-expense" options={{ title: 'Add Expense', presentation: 'modal' }} />
        <Stack.Screen name="person/[id]/edit-expense/[expenseId]" options={{ title: 'Edit Expense', presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
