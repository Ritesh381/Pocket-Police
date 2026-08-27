import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
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

export default function AnalyticsScreen() {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [currentMonth, setCurrentMonth] = useState(() => new Date().toISOString().slice(0, 7)); // "YYYY-MM"
  const [analytics, setAnalytics] = useState(null);
  const [currency, setCurrency] = useState('INR');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Budget Modal State
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [ana, me] = await Promise.all([
        api.getPersonalAnalytics(currentMonth),
        api.getMe(),
      ]);
      setAnalytics(ana);
      setCurrency(me.profile?.currency || 'INR');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentMonth]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const changeMonth = (delta) => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setCurrentMonth(d.toISOString().slice(0, 7));
  };

  const handleSaveBudget = async () => {
    const val = Number(budgetInput.trim());
    if (!val || val <= 0) return;
    try {
      setSavingBudget(true);
      await api.setBudget({ month_year: currentMonth, monthly_limit: val });
      setBudgetModalOpen(false);
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSavingBudget(false);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const limit = analytics?.monthly_limit || 0;
  const spent = analytics?.total_spent || 0;
  const remaining = analytics?.remaining_budget ?? 0;
  const percent = analytics?.budget_usage_percent || 0;
  const breakdown = analytics?.category_breakdown || [];

  // Month Display Name (e.g. "July 2026")
  const [yr, mo] = currentMonth.split('-').map(Number);
  const monthName = new Date(yr, mo - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {/* Month Navigation Header */}
      <View style={s.monthBar}>
        <TouchableOpacity style={s.monthBtn} onPress={() => changeMonth(-1)}>
          <MaterialIcons name="chevron-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.monthTitle}>{monthName}</Text>
        <TouchableOpacity style={s.monthBtn} onPress={() => changeMonth(1)}>
          <MaterialIcons name="chevron-right" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}

      {/* Overview Card */}
      <View style={s.card}>
        <Text style={s.cardSubtitle}>Total Monthly Spending</Text>
        <Text style={s.totalAmount}>{formatMoney(spent, currency)}</Text>
        
        <View style={s.metaRow}>
          <Text style={s.metaText}>{analytics?.transaction_count || 0} transactions</Text>
          <Text style={s.metaText}>·</Text>
          <Text style={s.metaText}>Avg {formatMoney(analytics?.daily_average || 0, currency)}/day</Text>
        </View>

        {/* Budget Progress Bar */}
        <View style={s.budgetSection}>
          <View style={s.budgetHeader}>
            <Text style={s.budgetLabel}>Monthly Budget Goal</Text>
            <TouchableOpacity onPress={() => { setBudgetInput(String(limit || '')); setBudgetModalOpen(true); }}>
              <Text style={s.budgetEdit}>{limit > 0 ? 'Edit' : '+ Set Goal'}</Text>
            </TouchableOpacity>
          </View>

          {limit > 0 ? (
            <View>
              <View style={s.progressBarBg}>
                <View
                  style={[
                    s.progressBarFill,
                    {
                      width: `${Math.min(percent, 100)}%`,
                      backgroundColor: percent > 90 ? colors.danger : percent > 75 ? '#f59e0b' : colors.primary,
                    },
                  ]}
                />
              </View>
              <View style={s.budgetMetaRow}>
                <Text style={s.budgetText}>
                  {percent}% used ({formatMoney(spent, currency)} of {formatMoney(limit, currency)})
                </Text>
                <Text style={[s.budgetText, { fontWeight: '700', color: remaining < 0 ? colors.danger : colors.success }]}>
                  {remaining < 0 ? `Over by ${formatMoney(Math.abs(remaining), currency)}` : `${formatMoney(remaining, currency)} left`}
                </Text>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={s.setBudgetBtn} onPress={() => { setBudgetInput(''); setBudgetModalOpen(true); }}>
              <MaterialIcons name="add-task" size={18} color={colors.primary} />
              <Text style={s.setBudgetBtnText}>Set a spending limit for {monthName}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category Breakdown Section */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Spending by Category</Text>
        <Text style={s.sectionMeta}>{breakdown.length} categories</Text>
      </View>

      {breakdown.length === 0 ? (
        <View style={s.emptyBox}>
          <MaterialIcons name="pie-chart-outline" size={48} color={colors.muted} />
          <Text style={s.emptyTitle}>No expenses logged for {monthName}</Text>
          <Text style={s.emptyBody}>Log expenses to see category breakdown and insights here.</Text>
        </View>
      ) : (
        breakdown.map((item) => (
          <View key={item.category_id} style={s.catRow}>
            <View style={[s.catIconBox, { backgroundColor: (item.color || colors.primary) + '22' }]}>
              <MaterialIcons name={item.icon || 'category'} size={22} color={item.color || colors.primary} />
            </View>
            <View style={s.catContent}>
              <View style={s.catTopRow}>
                <Text style={s.catName}>{item.name}</Text>
                <Text style={s.catAmount}>{formatMoney(item.amount, currency)}</Text>
              </View>
              <View style={s.catBarBg}>
                <View
                  style={[
                    s.catBarFill,
                    {
                      width: `${item.percentage}%`,
                      backgroundColor: item.color || colors.primary,
                    },
                  ]}
                />
              </View>
              <Text style={s.catPercent}>{item.percentage}% of monthly total</Text>
            </View>
          </View>
        ))
      )}

      {/* Set Budget Goal Modal */}
      <Modal visible={budgetModalOpen} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Set Budget Goal ({monthName})</Text>
            <Text style={s.modalSubtitle}>How much do you plan to spend in total this month?</Text>

            <View style={s.modalInputBox}>
              <Text style={s.modalCurrency}>{currency}</Text>
              <TextInput
                style={s.modalInput}
                keyboardType="numeric"
                placeholder="25000"
                placeholderTextColor={colors.placeholder}
                value={budgetInput}
                onChangeText={setBudgetInput}
                autoFocus
              />
            </View>

            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancelBtn} onPress={() => setBudgetModalOpen(false)}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalSaveBtn} onPress={handleSaveBudget} disabled={savingBudget}>
                {savingBudget ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.modalSaveText}>Save Goal</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
    monthBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      padding: 8,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    monthBtn: { padding: 6, borderRadius: radius.sm },
    monthTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: 20,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardSubtitle: { fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' },
    totalAmount: { fontSize: 34, fontWeight: '800', color: colors.text, marginVertical: 4 },
    metaRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 16 },
    metaText: { fontSize: 13, color: colors.muted },
    budgetSection: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 16,
    },
    budgetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    budgetLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
    budgetEdit: { fontSize: 13, fontWeight: '600', color: colors.primary },
    progressBarBg: { height: 8, backgroundColor: colors.bg, borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
    progressBarFill: { height: '100%', borderRadius: 4 },
    budgetMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    budgetText: { fontSize: 12, color: colors.muted },
    setBudgetBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: colors.primary + '15',
      borderRadius: radius.md,
      marginTop: 4,
    },
    setBudgetBtnText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    sectionMeta: { fontSize: 12, color: colors.muted },
    emptyBox: { alignItems: 'center', paddingVertical: 30, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 8 },
    emptyBody: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
    catRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      padding: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    catIconBox: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    catContent: { flex: 1 },
    catTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    catName: { fontSize: 14, fontWeight: '700', color: colors.text },
    catAmount: { fontSize: 14, fontWeight: '700', color: colors.text },
    catBarBg: { height: 6, backgroundColor: colors.bg, borderRadius: 3, overflow: 'hidden', marginVertical: 4 },
    catBarFill: { height: '100%', borderRadius: 3 },
    catPercent: { fontSize: 11, color: colors.muted },
    error: { color: colors.danger, marginBottom: 12 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    modalCard: { width: '100%', backgroundColor: colors.card, borderRadius: radius.lg, padding: 20, borderWidth: 1, borderColor: colors.border },
    modalTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
    modalSubtitle: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 16 },
    modalInputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 48, marginBottom: 20 },
    modalCurrency: { fontSize: 16, fontWeight: '700', color: colors.muted, marginRight: 8 },
    modalInput: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    modalCancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
    modalCancelText: { fontSize: 14, fontWeight: '600', color: colors.muted },
    modalSaveBtn: { backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 20, borderRadius: radius.md },
    modalSaveText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  });
}
