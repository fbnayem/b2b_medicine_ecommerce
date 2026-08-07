import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { User } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListRow,
  LoadingState,
  Screen,
  StatusPill,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Who works here.
 *
 * Read on a phone, added on a phone, and **not** suspended on one: changing
 * somebody's status is a decision with a person on the other end of it, and it
 * belongs where the conversation is happening rather than on a bus.
 *
 * The role is shown as a word from the catalogue rather than as the enum. A
 * list that reads `DELIVERY_PERSON` is a list somebody has to translate in
 * their head every time.
 */
export default function UsersScreen() {
  const { t, language } = useLanguage();
  const [users, setUsers] = useState<User[]>();
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient.get('/admin/users', {
        params: { limit: 50, ...(search.trim() ? { search: search.trim() } : {}) },
      });
      setUsers(response.data.data as User[]);
    } catch (caught) {
      setError(errorMessage(caught, language, t('users.couldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [language, search, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen scroll={false}>
      <Field label={t('users.search')} hint={t('users.searchHint')}>
        <Input
          label={t('users.search')}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => void load()}
        />
      </Field>

      <Button label={t('users.add')} onPress={() => router.push('/(protected)/user-form')} />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!users && !error ? <LoadingState label={t('users.loading')} /> : null}

      <FlatList
        data={users ?? []}
        keyExtractor={(user) => user._id}
        contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        ListEmptyComponent={users ? <EmptyState title={t('users.none')} /> : null}
        renderItem={({ item }) => (
          <Card>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: layout.space[2],
              }}
            >
              <Text style={{ color: colour.text, fontWeight: '600', flexShrink: 1 }}>
                {item.firstName} {item.lastName}
              </Text>
              <StatusPill kind="user" status={item.status} />
            </View>
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {item.email}
            </Text>
            {/* The word, not the enum. */}
            <ListRow label={t('users.role')} value={t(`roles.${item.role}`)} />
          </Card>
        )}
      />
    </Screen>
  );
}
