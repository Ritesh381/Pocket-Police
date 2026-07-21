import { useState } from 'react';
import { ScrollView, Alert } from 'react-native';
import { Button, Field } from './ui';
import { useTheme } from '../lib/theme';

// Reusable add/edit person form. `initial` prefills; `onSubmit` receives the payload.
export default function PersonForm({ initial = {}, submitLabel, onSubmit }) {
  const { colors } = useTheme();
  const [name, setName] = useState(initial.name || '');
  const [description, setDescription] = useState(initial.description || '');
  const [email, setEmail] = useState(initial.email || '');
  const [phone, setPhone] = useState(initial.phone || '');
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp || '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter a name.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        email: email.trim(),
        phone: phone.trim(),
        whatsapp: whatsapp.trim(),
      });
    } catch (e) {
      Alert.alert('Error', e.message);
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Field label="Name *" value={name} onChangeText={setName} placeholder="e.g. Rahul" />
      <Field label="Description" value={description} onChangeText={setDescription} placeholder="e.g. college friend" />
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" />
      <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+91XXXXXXXXXX" keyboardType="phone-pad" />
      <Field label="WhatsApp" value={whatsapp} onChangeText={setWhatsapp} placeholder="+91XXXXXXXXXX" keyboardType="phone-pad" />
      <Button title={submitLabel} onPress={submit} loading={saving} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}
