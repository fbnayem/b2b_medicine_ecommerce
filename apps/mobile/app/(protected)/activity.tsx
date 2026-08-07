import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { formatFinanceDateTime } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
import { Card, EmptyState, ErrorState, ListRow, LoadingState, Screen } from '../../src/components';
import { colour, layout } from '../../src/theme';

interface Entry {
  _id: string;
  summary: string;
  detail?: string;
  occurredAt: string;
  actorName?: string;
  actorRole?: string;
}

/**
 * What has been happening, filtered by what this account may see.
 *
 * `GET /activity` — the organisation feed — had no caller here, though
 * `/activity/timeline` (one record's history) did. The difference matters: the
 * timeline answers "what happened to this order", and this answers "what has
 * been happening", which is the question somebody asks after a day off.
 *
 * The server does the filtering. A storekeeper's feed and an administrator's
 * are different because the permission is applied there, not because this
 * screen hides rows.
 */
export default function ActivityScreen() {
  const { t, language } = useLanguage();
  const [entries, setEntries] = useState<Entry[]>();
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient.get('/activity', { params: { limit: 50 } });
      setEntries(response.data.data as Entry[]);
    } catch (caught) {
      setError(errorMessage(caught, language, t('activity.couldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!entries && !error) {
    return (
      <Screen>
        <LoadingState label={t('activity.loading')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <FlatList
        data={entries ?? []}
        keyExtractor={(entry) => entry._id}
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
        ListEmptyComponent={
          <EmptyState title={t('activity.none')} description={t('activity.noneBody')} />
        }
        renderItem={({ item }) => (
          <Card>
            <Text style={{ color: colour.text, fontWeight: '600' }}>{item.summary}</Text>
            {item.detail ? <Text style={{ color: colour.text }}>{item.detail}</Text> : null}
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {formatFinanceDateTime(item.occurredAt)}
            </Text>
            {/*
              Who, by name. An audit line without a person on it is a line
              nobody can follow up.
            */}
            {item.actorName ? <ListRow label={t('activity.who')} value={item.actorName} /> : null}
          </Card>
        )}
      />
    </Screen>
  );
}
