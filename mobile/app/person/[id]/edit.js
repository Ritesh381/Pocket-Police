import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import PersonForm from '../../../components/PersonForm';
import { api } from '../../../lib/api';
import { useTheme } from '../../../lib/theme';

export default function EditPerson() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const [person, setPerson] = useState(null);

  useEffect(() => {
    api.getPerson(id).then(({ person }) => setPerson(person)).catch(() => {});
  }, [id]);

  if (!person) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <PersonForm
      initial={person}
      submitLabel="Save Changes"
      onSubmit={async (payload) => {
        await api.updatePerson(id, payload);
        router.back();
      }}
    />
  );
}
