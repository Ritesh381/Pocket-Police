import { useLocalSearchParams, useRouter } from 'expo-router';
import ExpenseForm from '../../../components/ExpenseForm';
import { api } from '../../../lib/api';

export default function AddExpense() {
  // `amount` (signed) and `note` may be passed to prefill (e.g. "Record a payment").
  const { id, amount, note } = useLocalSearchParams();
  const router = useRouter();
  return (
    <ExpenseForm
      initial={{ amount, note }}
      submitLabel="Save"
      onSubmit={async (payload) => {
        await api.addExpense(id, payload);
        router.back();
      }}
    />
  );
}
