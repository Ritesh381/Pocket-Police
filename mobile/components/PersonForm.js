import { useState } from 'react';
import { ScrollView, Alert, Text } from 'react-native';
import { Button, Field } from './ui';
import PhoneField from './PhoneField';
import { useTheme } from '../lib/theme';
import { isValidE164 } from '../lib/countries';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reusable add/edit person form. `initial` prefills; `onSubmit` receives the payload.
export default function PersonForm({ initial = {}, submitLabel, onSubmit }) {
  const { colors } = useTheme();
  const [name, setName] = useState(initial.name || '');
  const [description, setDescription] = useState(initial.description || '');
  const [email, setEmail] = useState(initial.email || '');
  const [phone, setPhone] = useState(initial.phone || '');
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp || '');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const validate = () => {
    const e = {};
    if (!name.trim()) e.name = 'Name is required';
    if (email.trim() && !EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email';
    if (phone && !isValidE164(phone)) e.phone = 'Enter a valid phone number';
    if (whatsapp && !isValidE164(whatsapp)) e.whatsapp = 'Enter a valid WhatsApp number';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        email: email.trim(),
        phone, // already E.164 from PhoneField
        whatsapp,
      });
    } catch (err) {
      Alert.alert('Error', err.message);
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Field
        label="Name *"
        value={name}
        onChangeText={(t) => { setName(t); if (errors.name) setErrors((e) => ({ ...e, name: null })); }}
        placeholder="e.g. Rahul"
      />
      {errors.name ? <ErrText colors={colors}>{errors.name}</ErrText> : null}

      <Field label="Description" value={description} onChangeText={setDescription} placeholder="e.g. college friend" />

      <Field
        label="Email"
        value={email}
        onChangeText={(t) => { setEmail(t); if (errors.email) setErrors((e) => ({ ...e, email: null })); }}
        placeholder="name@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
      />
      {errors.email ? <ErrText colors={colors}>{errors.email}</ErrText> : null}

      <PhoneField
        label="Phone"
        value={phone}
        onChange={(v) => { setPhone(v); if (errors.phone) setErrors((e) => ({ ...e, phone: null })); }}
        error={errors.phone}
      />

      <PhoneField
        label="WhatsApp"
        value={whatsapp}
        onChange={(v) => { setWhatsapp(v); if (errors.whatsapp) setErrors((e) => ({ ...e, whatsapp: null })); }}
        error={errors.whatsapp}
      />

      <Button title={submitLabel} onPress={submit} loading={saving} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

function ErrText({ children, colors }) {
  return <Text style={{ color: colors.danger, fontSize: 12, marginTop: -8, marginBottom: 12 }}>{children}</Text>;
}
