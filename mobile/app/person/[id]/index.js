import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect, useNavigation, Link } from 'expo-router';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { api } from '../../../lib/api';
import { formatMoney, formatSigned, formatDate } from '../../../lib/format';
import { useTheme, radius } from '../../../lib/theme';

export default function PersonDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [person, setPerson] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [balance, setBalance] = useState(0);
  const [currency, setCurrency] = useState('INR');
  const [loading, setLoading] = useState(true);
  const [reminding, setReminding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ person }, ledger, me] = await Promise.all([
        api.getPerson(id),
        api.listExpenses(id),
        api.getMe(),
      ]);
      setPerson(person);
      setExpenses([...ledger.expenses].reverse()); // newest first for display
      setBalance(ledger.balance);
      setCurrency(me.profile?.currency || 'INR');
      navigation.setOptions({ title: person.name });
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirmDeletePerson = useCallback(() => {
    Alert.alert('Delete person?', 'This also deletes all their expenses. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deletePerson(id);
            router.back();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  }, [id, router]);

  // Edit (pencil) + delete (trash) icons in the header top-right.
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={s.headerBtns}>
          <TouchableOpacity onPress={() => router.push(`/person/${id}/edit`)} style={s.headerBtn} hitSlop={8}>
            <MaterialIcons name="edit" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmDeletePerson} style={s.headerBtn} hitSlop={8}>
            <MaterialIcons name="delete-outline" size={23} color={colors.danger} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, id, router, confirmDeletePerson]);

  const togglePersonReminders = async () => {
    const next = !person.reminders_on;
    setPerson((p) => ({ ...p, reminders_on: next })); // optimistic
    try {
      await api.updatePerson(id, { reminders_on: next });
    } catch (e) {
      setPerson((p) => ({ ...p, reminders_on: !next }));
      Alert.alert('Error', e.message);
    }
  };

  const remindNow = async () => {
    setReminding(true);
    try {
      const { summary } = await api.remindPerson(id);
      const parts = Object.entries(summary.channels || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
      Alert.alert(
        summary.sent > 0 ? `Reminder sent (${summary.sent})` : 'Reminder failed',
        parts || 'No channel was available.',
      );
      load();
    } catch (e) {
      Alert.alert('Could not remind', e.message);
    } finally {
      setReminding(false);
    }
  };

  const recordPayment = () => {
    router.push({
      pathname: `/person/${id}/add-expense`,
      params: { amount: String(-balance), note: 'Payment' },
    });
  };

  const deleteExpense = (expenseId) => {
    Alert.alert('Delete entry?', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteExpense(expenseId);
            load();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  if (loading || !person) {
    return <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  const contactActions = [
    person.phone && { label: 'Call', icon: 'call', lib: 'mi', url: `tel:${person.phone}` },
    person.whatsapp && { label: 'WhatsApp', icon: 'whatsapp', lib: 'mci', url: `https://wa.me/${person.whatsapp.replace(/[^\d]/g, '')}` },
    person.email && { label: 'Email', icon: 'email', lib: 'mi', url: `mailto:${person.email}` },
  ].filter(Boolean);

  return (
    <View style={s.container}>
      <FlatList
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        data={expenses}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            <View style={s.balanceCard}>
              <Text style={s.balanceLabel}>
                {balance > 0 ? 'Owes you' : balance < 0 ? 'You owe / overpaid' : 'All settled'}
              </Text>
              <Text style={[s.balanceAmount, { color: balance >= 0 ? '#fff' : '#FFD7D7' }]}>
                {formatMoney(Math.abs(balance), currency)}
              </Text>
            </View>

            {balance > 0 && (
              <TouchableOpacity style={s.remindBtn} onPress={remindNow} disabled={reminding} activeOpacity={0.85}>
                {reminding ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <MaterialIcons name="notifications-active" size={19} color="#fff" />
                    <Text style={s.remindBtnText}>Remind now</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {contactActions.length > 0 && (
              <View style={s.actions}>
                {contactActions.map((a) => (
                  <TouchableOpacity key={a.label} style={s.action} onPress={() => Linking.openURL(a.url)}>
                    {a.lib === 'mci' ? (
                      <MaterialCommunityIcons name={a.icon} size={20} color={colors.primary} />
                    ) : (
                      <MaterialIcons name={a.icon} size={20} color={colors.primary} />
                    )}
                    <Text style={s.actionText}>{a.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {person.description ? <Text style={s.desc}>{person.description}</Text> : null}

            {balance > 0 && (
              <TouchableOpacity style={s.payBtn} onPress={recordPayment} activeOpacity={0.85}>
                <MaterialIcons name="check-circle" size={20} color={colors.primary} />
                <Text style={s.payBtnText}>Record a payment</Text>
              </TouchableOpacity>
            )}

            <View style={s.remRow}>
              <View>
                <Text style={s.remLabel}>Monthly reminders</Text>
                <Text style={s.remSub}>Include this person in reminders</Text>
              </View>
              <Switch
                value={!!person.reminders_on}
                onValueChange={togglePersonReminders}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor={colors.card}
              />
            </View>

            <Text style={s.sectionTitle}>Ledger</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.expenseRow}
            onPress={() =>
              router.push({
                pathname: `/person/${id}/edit-expense/${item.id}`,
                params: { amount: String(item.amount), note: item.note ?? '', incurred_on: item.incurred_on },
              })
            }
            onLongPress={() => deleteExpense(item.id)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.expenseNote}>{item.note || (item.amount > 0 ? 'Lent' : 'Repaid')}</Text>
              <Text style={s.expenseDate}>{formatDate(item.incurred_on)}</Text>
            </View>
            <Text style={[s.expenseAmt, { color: item.amount > 0 ? colors.owed : colors.credit }]}>
              {formatSigned(item.amount, currency)}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={s.empty}>No entries yet. Add the first one below.</Text>}
        ListFooterComponent={expenses.length ? <Text style={s.hint}>Tap an entry to edit it · long-press to delete.</Text> : null}
      />
      <Link href={`/person/${id}/add-expense`} asChild>
        <TouchableOpacity style={s.fab} activeOpacity={0.85}>
          <MaterialIcons name="add" size={22} color="#fff" />
          <Text style={s.fabText}>Add expense</Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  balanceCard: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: 24, alignItems: 'center' },
  balanceLabel: { color: colors.subOnPrimary, fontSize: 14, fontWeight: '600' },
  balanceAmount: { fontSize: 40, fontWeight: '800', marginTop: 4 },
  remindBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    marginTop: 12, height: 50, borderRadius: radius.md, backgroundColor: colors.primaryDark,
  },
  remindBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  action: { flex: 1, flexDirection: 'row', gap: 6, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 14, fontWeight: '600', color: colors.text },
  desc: { fontSize: 14, color: colors.muted, marginTop: 16 },
  payBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    marginTop: 16, paddingVertical: 12, borderRadius: radius.md,
    backgroundColor: colors.tintGreen, borderWidth: 1, borderColor: colors.primary,
  },
  payBtnText: { fontSize: 15, fontWeight: '700', color: colors.primary },
  remRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, padding: 14, backgroundColor: colors.card,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  remLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  remSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  headerBtns: { flexDirection: 'row', gap: 4, marginRight: 4 },
  headerBtn: { padding: 6 },
  headerIcon: { fontSize: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 24, marginBottom: 10 },
  expenseRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: radius.md, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border,
  },
  expenseNote: { fontSize: 15, fontWeight: '600', color: colors.text },
  expenseDate: { fontSize: 12, color: colors.muted, marginTop: 2 },
  expenseAmt: { fontSize: 16, fontWeight: '800' },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 24 },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 4 },
  fab: {
    position: 'absolute', right: 20, left: 20, bottom: 24,
    height: 54, borderRadius: radius.md, backgroundColor: colors.primary,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
