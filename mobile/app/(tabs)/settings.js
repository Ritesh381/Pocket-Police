import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Switch, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Card, Field } from '../../components/ui';
import CurrencyField from '../../components/CurrencyField';
import { useTheme } from '../../lib/theme';

export default function Settings() {
  const { signOut, session } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const s = makeStyles(colors);
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState('');
  const [upi, setUpi] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [savingProfile, setSavingProfile] = useState(false);
  const [emailDefaults, setEmailDefaults] = useState({});
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailClosing, setEmailClosing] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [{ settings, email_defaults }, { profile }] = await Promise.all([api.getSettings(), api.getMe()]);
      setSettings(settings);
      setProfile(profile);
      setName(profile?.full_name || '');
      setUpi(profile?.upi_id || '');
      setCurrency(profile?.currency || 'INR');
      setEmailDefaults(email_defaults || {});
      setEmailSubject(settings.email_subject || '');
      setEmailMessage(settings.email_message || '');
      setEmailClosing(settings.email_closing || '');
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveEmail = async () => {
    setSavingEmail(true);
    try {
      const { settings } = await api.updateSettings({
        email_subject: emailSubject.trim(),
        email_message: emailMessage.trim(),
        email_closing: emailClosing.trim(),
      });
      setSettings(settings);
      Alert.alert('Saved', 'Your reminder email is updated. Leave a field blank to use the default.');
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingEmail(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const { profile } = await api.updateMe({ full_name: name.trim(), upi_id: upi.trim(), currency });
      setProfile(profile);
      Alert.alert('Saved', 'Your details are updated.');
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const toggle = async (key) => {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next); // optimistic
    try {
      await api.updateSettings({ [key]: next[key] });
    } catch (e) {
      setSettings(settings); // revert
      Alert.alert('Error', e.message);
    }
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }}>
      <Card style={{ marginBottom: 16 }}>
        <Text style={s.email}>{session?.user?.email}</Text>
        <Text style={s.meta}>Signed in with Google</Text>
      </Card>

      <Text style={s.section}>Your details</Text>
      <Card style={{ marginBottom: 6 }}>
        <Field label="Your name (shown in reminders)" value={name} onChangeText={setName} placeholder="e.g. Ritesh" />
        <Field
          label="Your UPI ID (for pay links)"
          value={upi}
          onChangeText={setUpi}
          placeholder="e.g. ritesh@okhdfcbank"
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <CurrencyField label="Currency" value={currency} onChange={setCurrency} />
        <Button title="Save details" onPress={saveProfile} loading={savingProfile} />
      </Card>
      <Text style={s.hint}>Reminders say "…{name || 'you'} bhai ka karz…" and add a UPI pay button when a UPI ID is set.</Text>

      <Text style={[s.section, { marginTop: 24 }]}>Monthly reminders</Text>
      <Card>
        <Row label="Send reminders" value={settings.reminders_on} onToggle={() => toggle('reminders_on')} />
        <Divider />
        <Row label="Email" value={settings.channel_email} disabled={!settings.reminders_on} onToggle={() => toggle('channel_email')} />
        <Divider />
        <Row label="SMS" value={settings.channel_sms} disabled={!settings.reminders_on} onToggle={() => toggle('channel_sms')} />
        <Divider />
        <Row label="WhatsApp" value={settings.channel_whatsapp} disabled={!settings.reminders_on} onToggle={() => toggle('channel_whatsapp')} />
      </Card>
      <Text style={s.hint}>
        On the 1st of each month, everyone with a positive balance gets a reminder on the enabled channels
        (only if they have that contact detail saved).
      </Text>

      <Button title="View reminder history" variant="ghost" style={{ marginTop: 12 }} onPress={() => router.push('/reminders')} />

      <Text style={[s.section, { marginTop: 24 }]}>Reminder email</Text>
      <Card>
        <Field
          label="Subject"
          value={emailSubject}
          onChangeText={setEmailSubject}
          placeholder={emailDefaults.subject}
        />
        <Field
          label="Message"
          value={emailMessage}
          onChangeText={setEmailMessage}
          placeholder={emailDefaults.message}
          multiline
        />
        <Field
          label="Closing line"
          value={emailClosing}
          onChangeText={setEmailClosing}
          placeholder={emailDefaults.closing}
          multiline
        />
        <Button title="Save email" onPress={saveEmail} loading={savingEmail} />
      </Card>
      <Text style={s.hint}>
        Use {'{name}'} (the person), {'{lender}'} (you), and {'{total}'} (amount owed) as placeholders.
        The history table, total, and UPI QR are added automatically. Leave a field blank to use the default.
      </Text>

      <Text style={s.previewLabel}>Preview</Text>
      <View style={s.previewCard}>
        <Text style={s.previewSubject}>
          {preview(emailSubject, emailDefaults.subject, name)}
        </Text>
        <View style={s.previewDivider} />
        <Text style={s.previewText}>{preview(emailMessage, emailDefaults.message, name)}</Text>
        <View style={s.previewBox}>
          <Text style={s.previewBoxText}>📒 History table · Total · UPI QR</Text>
        </View>
        <Text style={s.previewText}>{preview(emailClosing, emailDefaults.closing, name)}</Text>
      </View>

      <Button title="Sign out" variant="ghost" style={{ marginTop: 24 }} onPress={signOut} />
    </ScrollView>
  );
}

// Substitutes placeholders with sample values for the live preview.
function preview(value, fallback, lenderName) {
  return (value && value.trim() ? value : fallback || '')
    .replaceAll('{name}', 'Rahul')
    .replaceAll('{lender}', lenderName?.trim() || 'you')
    .replaceAll('{total}', '₹500');
}

function Row({ label, value, onToggle, disabled }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, disabled && { color: colors.muted }]}>{label}</Text>
      <Switch
        value={!!value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor={colors.card}
      />
    </View>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  email: { fontSize: 16, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  rowLabel: { fontSize: 16, color: colors.text },
  divider: { height: 1, backgroundColor: colors.border },
  hint: { fontSize: 13, color: colors.muted, marginTop: 12, lineHeight: 18 },
  previewLabel: { fontSize: 13, fontWeight: '700', color: colors.muted, marginTop: 20, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  previewCard: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16 },
  previewSubject: { fontSize: 15, fontWeight: '800', color: colors.text },
  previewDivider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  previewText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  previewBox: { backgroundColor: colors.tintGreen, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginVertical: 12 },
  previewBoxText: { fontSize: 13, color: colors.muted },
});
