import { useRouter } from 'expo-router';
import PersonForm from '../../components/PersonForm';
import { api } from '../../lib/api';

export default function NewPerson() {
  const router = useRouter();
  return (
    <PersonForm
      submitLabel="Add Person"
      onSubmit={async (payload) => {
        await api.createPerson(payload);
        router.back();
      }}
    />
  );
}
