import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { Button, Field } from './ui';
import { useTheme, radius } from '../lib/theme';

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Shared add/edit form for an expense.
// initial: { amount (signed), note, incurred_on }. onSubmit gets { amount, note, incurred_on }.
// onDelete (optional) shows a Delete button (edit mode).
export default function ExpenseForm({ initial = {}, submitLabel, onSubmit, onDelete }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const initialAmount = initial.amount != null ? Number(initial.amount) : null;
  const [direction, setDirection] = useState(
    initialAmount == null || initialAmount >= 0 ? 'owe' : 'paid',
  );
  const [amount, setAmount] = useState(
    initialAmount != null ? String(Math.abs(initialAmount)) : '',
  );
  const [note, setNote] = useState(initial.note || '');
  const [date, setDate] = useState(initial.incurred_on || todayISO());
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      Alert.alert('Enter an amount', 'Please enter a positive number.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('Invalid date', 'Use the format YYYY-MM-DD.');
      return;
    }
    setSaving(true);
    try {
      const signed = direction === 'owe' ? value : -value;
      await onSubmit({ amount: signed, note: note.trim(), incurred_on: date });
    } catch (e) {
      Alert.alert('Error', e.message);
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert('Delete entry?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={s.toggle}>
        <TouchableOpacity style={[s.toggleBtn, direction === 'owe' && s.toggleActiveOwe]} onPress={() => setDirection('owe')}>
          <Text style={[s.toggleText, direction === 'owe' && s.toggleTextActive]}>They took money (+)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.toggleBtn, direction === 'paid' && s.toggleActivePaid]} onPress={() => setDirection('paid')}>
          <Text style={[s.toggleText, direction === 'paid' && s.toggleTextActive]}>They paid back (−)</Text>
        </TouchableOpacity>
      </View>

      <Field label="Amount" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" autoFocus={!onDelete} />
      <Field label="Note (what was it for?)" value={note} onChangeText={setNote} placeholder="e.g. dinner at Barbeque Nation" />
      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-07-20" keyboardType="numbers-and-punctuation" autoCapitalize="none" />

      <Button title={submitLabel} onPress={submit} loading={saving} style={{ marginTop: 8 }} />
      {onDelete && (
        <Button title="Delete entry" variant="ghost" style={{ marginTop: 12, borderColor: colors.danger }} onPress={confirmDelete} />
      )}
    </ScrollView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  toggle: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  toggleBtn: {
    flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  toggleActiveOwe: { backgroundColor: colors.tintGreen, borderColor: colors.primary },
  toggleActivePaid: { backgroundColor: colors.tintRed, borderColor: colors.danger },
  toggleText: { fontSize: 14, fontWeight: '600', color: colors.muted, textAlign: 'center' },
  toggleTextActive: { color: colors.text },
});
