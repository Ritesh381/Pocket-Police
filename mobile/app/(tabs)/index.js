import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useTheme, radius } from '../../lib/theme';

export default function ExpensesHome() {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [currentMonth, setCurrentMonth] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [people, setPeople] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [currency, setCurrency] = useState('INR');

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null); // null = all
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Add Expense Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [catInput, setCatInput] = useState(null);
  const [payModeInput, setPayModeInput] = useState('upi');

  // Split with friend option state
  const [isSplit, setIsSplit] = useState(false);
  const [splitPersonId, setSplitPersonId] = useState(null);
  const [splitAmountInput, setSplitAmountInput] = useState('');

  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [exps, cats, ana, peop, me] = await Promise.all([
        api.getPersonalExpenses({ month: currentMonth, category_id: selectedCategory, q: query }),
        api.getCategories(),
        api.getPersonalAnalytics(currentMonth),
        api.listPeople(),
        api.getMe(),
      ]);
      setExpenses(exps.personal_expenses || []);
      setCategories(cats.categories || []);
      setAnalytics(ana);
      setPeople(peop.people || []);
      setCurrency(me.profile?.currency || 'INR');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentMonth, selectedCategory, query]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleAddExpense = async () => {
    const amt = Number(amountInput.trim());
    if (!amt || amt <= 0) return alert('Enter a valid amount');

    try {
      setSaving(true);
      let linkedFriendExpenseId = null;

      // Handle Split with friend option
      if (isSplit && splitPersonId) {
        const splitAmt = Number(splitAmountInput.trim());
        if (splitAmt > 0) {
          const friendExp = await api.addExpense(splitPersonId, {
            amount: splitAmt,
            note: noteInput ? `Split: ${noteInput}` : 'Split expense',
          });
          linkedFriendExpenseId = friendExp.expense?.id || null;
        }
      }

      await api.addPersonalExpense({
        amount: amt,
        category_id: catInput,
        note: noteInput || null,
        payment_mode: payModeInput,
        linked_friend_expense_id: linkedFriendExpenseId,
      });

      // Reset modal & reload
      setModalOpen(false);
      setAmountInput('');
      setNoteInput('');
      setCatInput(null);
      setIsSplit(false);
      setSplitPersonId(null);
      setSplitAmountInput('');
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExpense = async (id) => {
    try {
      await api.deletePersonalExpense(id);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const totalSpent = analytics?.total_spent || 0;
  const limit = analytics?.monthly_limit || 0;
  const remaining = analytics?.remaining_budget ?? 0;

  return (
    <View style={s.container}>
      <FlatList
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        data={expenses}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListHeaderComponent={
          <View>
            {error ? <Text style={s.error}>{error}</Text> : null}

            {/* Monthly Summary Hero Card */}
            <View style={s.heroCard}>
              <View style={s.heroTop}>
                <View>
                  <Text style={s.heroLabel}>Total Spent This Month</Text>
                  <Text style={s.heroAmount}>{formatMoney(totalSpent, currency)}</Text>
                </View>
                {limit > 0 ? (
                  <View style={s.heroBadge}>
                    <Text style={s.heroBadgeText}>
                      {remaining >= 0 ? `${formatMoney(remaining, currency)} left` : 'Over budget'}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={s.heroMetaRow}>
                <Text style={s.heroMetaText}>{analytics?.transaction_count || 0} transactions</Text>
                <Text style={s.heroMetaText}>·</Text>
                <Text style={s.heroMetaText}>Avg {formatMoney(analytics?.daily_average || 0, currency)}/day</Text>
              </View>
            </View>

            {/* Category Pills Filter Scroll */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catPillsScroll} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
              <TouchableOpacity
                style={[s.catPill, !selectedCategory && s.catPillActive]}
                onPress={() => setSelectedCategory(null)}
              >
                <Text style={[s.catPillText, !selectedCategory && s.catPillTextActive]}>All</Text>
              </TouchableOpacity>
              {categories.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[s.catPill, selectedCategory === c.id && s.catPillActive, selectedCategory === c.id && { backgroundColor: c.color }]}
                  onPress={() => setSelectedCategory(selectedCategory === c.id ? null : c.id)}
                >
                  <MaterialIcons name={c.icon || 'category'} size={14} color={selectedCategory === c.id ? '#fff' : c.color} />
                  <Text style={[s.catPillText, selectedCategory === c.id && s.catPillTextActive]}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Search Input */}
            <View style={s.searchBar}>
              <MaterialIcons name="search" size={20} color={colors.muted} style={{ marginRight: 8 }} />
              <TextInput
                style={s.searchInput}
                placeholder="Search note or category..."
                placeholderTextColor={colors.placeholder}
                value={query}
                onChangeText={setQuery}
              />
              {query ? (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <MaterialIcons name="close" size={18} color={colors.muted} />
                </TouchableOpacity>
              ) : null}
            </View>

            <Text style={s.sectionTitle}>Recent Transactions ({expenses.length})</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <MaterialIcons name="receipt-long" size={48} color={colors.muted} />
            <Text style={s.emptyTitle}>{query || selectedCategory ? 'No matching expenses' : 'No personal expenses logged yet'}</Text>
            <Text style={s.emptyBody}>
              {query || selectedCategory ? 'Try resetting your filter or search query' : 'Tap "+ Log Expense" below to track your personal spending'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const cat = item.category || { name: 'Others', icon: 'category', color: '#6b7280' };
          return (
            <View style={s.card}>
              <View style={[s.catIconBox, { backgroundColor: (cat.color || colors.primary) + '22' }]}>
                <MaterialIcons name={cat.icon || 'category'} size={20} color={cat.color || colors.primary} />
              </View>
              <View style={s.cardBody}>
                <Text style={s.expenseNote} numberOfLines={1}>{item.note || cat.name}</Text>
                <View style={s.cardMetaRow}>
                  <Text style={s.expenseCatName}>{cat.name}</Text>
                  <Text style={s.metaDot}>·</Text>
                  <Text style={s.payModeTag}>{item.payment_mode.toUpperCase()}</Text>
                  {item.linked_friend_expense_id ? (
                    <>
                      <Text style={s.metaDot}>·</Text>
                      <Text style={s.splitTag}>SPLIT</Text>
                    </>
                  ) : null}
                </View>
              </View>
              <View style={s.cardRight}>
                <Text style={s.expenseAmount}>{formatMoney(item.amount, currency)}</Text>
                <TouchableOpacity onPress={() => handleDeleteExpense(item.id)} style={{ padding: 4 }}>
                  <MaterialIcons name="delete-outline" size={18} color={colors.muted} />
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />

      {/* Floating Action Button */}
      <TouchableOpacity style={s.fab} activeOpacity={0.85} onPress={() => setModalOpen(true)}>
        <MaterialIcons name="add" size={24} color="#fff" />
        <Text style={s.fabText}>Log Expense</Text>
      </TouchableOpacity>

      {/* Log Expense Modal */}
      <Modal visible={modalOpen} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>Log Personal Expense</Text>

              {/* Amount Box */}
              <View style={s.amountInputBox}>
                <Text style={s.currencyPrefix}>{currency}</Text>
                <TextInput
                  style={s.amountInput}
                  keyboardType="numeric"
                  placeholder="0.00"
                  placeholderTextColor={colors.placeholder}
                  value={amountInput}
                  onChangeText={setAmountInput}
                  autoFocus
                />
              </View>

              {/* Note / Description */}
              <TextInput
                style={s.input}
                placeholder="What was this for? (e.g. Lunch, Grocery)"
                placeholderTextColor={colors.placeholder}
                value={noteInput}
                onChangeText={setNoteInput}
              />

              {/* Category Selector */}
              <Text style={s.inputLabel}>Select Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
                {categories.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[s.catPill, catInput === c.id && s.catPillActive, catInput === c.id && { backgroundColor: c.color }]}
                    onPress={() => setCatInput(c.id)}
                  >
                    <MaterialIcons name={c.icon || 'category'} size={14} color={catInput === c.id ? '#fff' : c.color} />
                    <Text style={[s.catPillText, catInput === c.id && s.catPillTextActive]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Payment Mode Selector */}
              <Text style={s.inputLabel}>Payment Mode</Text>
              <View style={s.payModeRow}>
                {['upi', 'cash', 'card', 'other'].map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={[s.modeBtn, payModeInput === mode && s.modeBtnActive]}
                    onPress={() => setPayModeInput(mode)}
                  >
                    <Text style={[s.modeBtnText, payModeInput === mode && s.modeBtnTextActive]}>
                      {mode.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Optional Split with Friend Toggle */}
              <View style={s.splitToggleRow}>
                <TouchableOpacity style={s.splitCheckBox} onPress={() => setIsSplit(!isSplit)}>
                  <MaterialIcons name={isSplit ? 'check-box' : 'check-box-outline-blank'} size={22} color={colors.primary} />
                  <Text style={s.splitLabel}>Split part of this with a friend</Text>
                </TouchableOpacity>
              </View>

              {isSplit ? (
                <View style={s.splitSection}>
                  <Text style={s.inputLabel}>Friend to share debt with</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 8 }}>
                    {people.map((p) => (
                      <TouchableOpacity
                        key={p.id}
                        style={[s.personChip, splitPersonId === p.id && s.personChipActive]}
                        onPress={() => setSplitPersonId(p.id)}
                      >
                        <Text style={[s.personChipText, splitPersonId === p.id && s.personChipTextActive]}>{p.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <TextInput
                    style={s.input}
                    keyboardType="numeric"
                    placeholder="Friend's share amount (₹)"
                    placeholderTextColor={colors.placeholder}
                    value={splitAmountInput}
                    onChangeText={setSplitAmountInput}
                  />
                </View>
              ) : null}

              {/* Actions */}
              <View style={s.modalActions}>
                <TouchableOpacity style={s.modalCancelBtn} onPress={() => setModalOpen(false)}>
                  <Text style={s.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.modalSaveBtn} onPress={handleAddExpense} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.modalSaveText}>Save Expense</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
    heroCard: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: 20,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    heroLabel: { fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' },
    heroAmount: { fontSize: 34, fontWeight: '800', color: colors.primary, marginTop: 4 },
    heroBadge: { backgroundColor: colors.primary + '18', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
    heroBadgeText: { fontSize: 12, fontWeight: '700', color: colors.primary },
    heroMetaRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 12 },
    heroMetaText: { fontSize: 12, color: colors.muted },
    catPillsScroll: { marginBottom: 12 },
    catPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.card,
      borderRadius: radius.full,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    catPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    catPillText: { fontSize: 12, fontWeight: '600', color: colors.text },
    catPillTextActive: { color: '#fff' },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      height: 42,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 16,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: 14 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 12 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      padding: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    catIconBox: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    cardBody: { flex: 1 },
    expenseNote: { fontSize: 15, fontWeight: '700', color: colors.text },
    cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    expenseCatName: { fontSize: 12, color: colors.muted },
    metaDot: { fontSize: 12, color: colors.muted },
    payModeTag: { fontSize: 10, fontWeight: '700', color: colors.muted },
    splitTag: { fontSize: 10, fontWeight: '800', color: colors.primary },
    cardRight: { alignItems: 'flex-end', gap: 4 },
    expenseAmount: { fontSize: 15, fontWeight: '700', color: colors.text },
    empty: { alignItems: 'center', paddingVertical: 40 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 12 },
    emptyBody: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
    fab: {
      position: 'absolute',
      bottom: 24,
      right: 20,
      backgroundColor: colors.primary,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderRadius: radius.full,
      elevation: 5,
    },
    fabText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    error: { color: colors.danger, marginBottom: 12 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', padding: 16 },
    modalCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 20, borderWidth: 1, borderColor: colors.border },
    modalTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 16 },
    amountInputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 50, marginBottom: 12 },
    currencyPrefix: { fontSize: 20, fontWeight: '800', color: colors.primary, marginRight: 8 },
    amountInput: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.text },
    input: { backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 44, color: colors.text, fontSize: 14, marginBottom: 12 },
    inputLabel: { fontSize: 12, fontWeight: '700', color: colors.muted, uppercase: true, marginBottom: 6 },
    payModeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    modeBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, backgroundColor: colors.bg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
    modeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    modeBtnText: { fontSize: 11, fontWeight: '700', color: colors.muted },
    modeBtnTextActive: { color: '#fff' },
    splitToggleRow: { marginBottom: 12 },
    splitCheckBox: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    splitLabel: { fontSize: 13, color: colors.text, fontWeight: '600' },
    splitSection: { backgroundColor: colors.bg, padding: 12, borderRadius: radius.md, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
    personChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    personChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    personChipText: { fontSize: 12, fontWeight: '600', color: colors.text },
    personChipTextActive: { color: '#fff' },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
    modalCancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
    modalCancelText: { fontSize: 14, fontWeight: '600', color: colors.muted },
    modalSaveBtn: { backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 20, borderRadius: radius.md },
    modalSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  });
}
