import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect, Link } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useTheme, radius } from '../../lib/theme';

export default function Dashboard() {
  const router = useRouter();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState('balance'); // 'balance' | 'name'
  const [data, setData] = useState(null);
  const [currency, setCurrency] = useState('INR');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [dash, me] = await Promise.all([api.getDashboard(), api.getMe()]);
      setData(dash);
      setCurrency(me.profile?.currency || 'INR');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const allPeople = data?.people || [];
  const q = query.trim().toLowerCase();
  const visiblePeople = allPeople
    .filter((p) => !q || (p.name || '').toLowerCase().includes(q))
    .sort((a, b) => (sortMode === 'name' ? (a.name || '').localeCompare(b.name || '') : b.balance - a.balance));

  return (
    <View style={s.container}>
      <FlatList
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        data={visiblePeople}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
        ListHeaderComponent={
          <View>
            {error ? <Text style={s.error}>{error}</Text> : null}
            <View style={s.summary}>
              <Text style={s.summaryLabel}>Total outstanding</Text>
              <Text style={s.summaryAmount}>{formatMoney(data?.total_outstanding || 0, currency)}</Text>
              <View style={s.summaryRow}>
                <Text style={s.summaryMeta}>{data?.debtor_count || 0} owe you</Text>
                <Text style={s.summaryMeta}>·</Text>
                <Text style={s.summaryMeta}>{data?.people_count || 0} people</Text>
              </View>
              <View style={s.miniStats}>
                <View style={s.mini}>
                  <Text style={s.miniLabel}>Lent this month</Text>
                  <Text style={s.miniValue}>{formatMoney(data?.lent_this_month || 0, currency)}</Text>
                </View>
                <View style={s.mini}>
                  <Text style={s.miniLabel}>Collected this month</Text>
                  <Text style={[s.miniValue, { color: colors.credit }]}>
                    {formatMoney(data?.collected_this_month || 0, currency)}
                  </Text>
                </View>
              </View>
            </View>

            {allPeople.length > 0 && (
              <>
                <View style={s.searchBar}>
                  <MaterialIcons name="search" size={20} color={colors.muted} />
                  <TextInput
                    style={s.searchInput}
                    placeholder="Search people"
                    placeholderTextColor={colors.muted}
                    value={query}
                    onChangeText={setQuery}
                    autoCapitalize="none"
                  />
                  {query ? (
                    <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                      <MaterialIcons name="close" size={18} color={colors.muted} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={s.sortRow}>
                  <Text style={s.sectionTitle}>People</Text>
                  <View style={s.sortChips}>
                    {['balance', 'name'].map((m) => (
                      <TouchableOpacity
                        key={m}
                        onPress={() => setSortMode(m)}
                        style={[s.chip, sortMode === m && s.chipActive]}
                      >
                        <Text style={[s.chipText, sortMode === m && s.chipTextActive]}>
                          {m === 'balance' ? 'Amount' : 'Name'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.personRow}
            onPress={() => router.push(`/person/${item.id}`)}
            activeOpacity={0.7}
          >
            <View style={s.avatar}>
              <Text style={s.avatarText}>{(item.name || '?').charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.personName}>{item.name}</Text>
              {item.description ? <Text style={s.personDesc} numberOfLines={1}>{item.description}</Text> : null}
            </View>
            <Text
              style={[
                s.balance,
                { color: item.balance > 0 ? colors.owed : item.balance < 0 ? colors.credit : colors.settled },
              ]}
            >
              {formatMoney(item.balance, currency)}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          allPeople.length > 0 ? (
            <View style={s.empty}>
              <MaterialIcons name="search-off" size={48} color={colors.muted} />
              <Text style={s.emptyText}>No people match "{query}".</Text>
            </View>
          ) : (
            <View style={s.empty}>
              <MaterialIcons name="groups" size={56} color={colors.muted} />
              <Text style={s.emptyTitle}>No people yet</Text>
              <Text style={s.emptyText}>Add someone who owes you money to get started.</Text>
            </View>
          )
        }
      />
      <Link href="/person/new" asChild>
        <TouchableOpacity style={s.fab} activeOpacity={0.85}>
          <MaterialIcons name="add" size={30} color="#fff" />
        </TouchableOpacity>
      </Link>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  error: { color: colors.danger, marginBottom: 12 },
  summary: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: 20,
    marginBottom: 20,
  },
  summaryLabel: { color: '#D7F0E3', fontSize: 14, fontWeight: '600' },
  summaryAmount: { color: '#fff', fontSize: 40, fontWeight: '800', marginTop: 4 },
  summaryRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  summaryMeta: { color: '#D7F0E3', fontSize: 13 },
  miniStats: { flexDirection: 'row', gap: 12, marginTop: 16 },
  mini: { flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.md, padding: 12 },
  miniLabel: { color: '#D7F0E3', fontSize: 12 },
  miniValue: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 12, height: 44, marginBottom: 14,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sortChips: { flexDirection: 'row', gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.tintGreen, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  chipTextActive: { color: colors.primary },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.avatarBg,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.owed, fontWeight: '800', fontSize: 18 },
  personName: { fontSize: 16, fontWeight: '600', color: colors.text },
  personDesc: { fontSize: 13, color: colors.muted, marginTop: 2 },
  balance: { fontSize: 17, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 12 },
  emptyText: { fontSize: 14, color: colors.muted, marginTop: 6, textAlign: 'center', paddingHorizontal: 40 },
  fab: {
    position: 'absolute', right: 20, bottom: 28,
    width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabText: { color: '#fff', fontSize: 32, fontWeight: '300', marginTop: -2 },
});
