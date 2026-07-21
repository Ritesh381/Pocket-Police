import { useLocalSearchParams, useRouter } from 'expo-router';
import ExpenseForm from '../../../../components/ExpenseForm';
import { api } from '../../../../lib/api';

// Expense fields are passed as route params from the ledger row (avoids an extra fetch).
export default function EditExpense() {
  const { expenseId, amount, note, incurred_on } = useLocalSearchParams();
  const router = useRouter();

  return (
    <ExpenseForm
      initial={{ amount, note, incurred_on }}
      submitLabel="Save Changes"
      onSubmit={async (payload) => {
        await api.updateExpense(expenseId, payload);
        router.back();
      }}
      onDelete={async () => {
        try {
          await api.deleteExpense(expenseId);
          router.back();
        } catch (e) {
          // surfaced by ExpenseForm's caller alerts; keep simple here
        }
      }}
    />
  );
}
