import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { formatFinanceDateTime } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListRow,
  LoadingState,
  Screen,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

interface AuditRow {
  _id: string;
  action: string;
  entityType?: string;
  createdAt: string;
  actorRole?: string;
  actorId?: { firstName?: string; lastName?: string } | string;
  correlationId?: string;
}

const actorName = (row: AuditRow) =>
  typeof row.actorId === 'object' && row.actorId
    ? `${row.actorId.firstName ?? ''} ${row.actorId.lastName ?? ''}`.trim()
    : '';

/**
 * The audit log, read-only, on a phone.
 *
 * Append-only records of every sensitive operation — a credit limit changed, a
 * batch blocked, a delivery address moved. The reason to have it here rather
 * than only on a desktop is the question it answers: **who did this, and
 * when**, asked by somebody standing in front of the consequence.
 *
 * The **correlation identifier** is shown because it is what ties a line here
 * to a line in the server log, and an administrator on the telephone to
 * whoever runs the deployment needs to be able to read it out.
 */
export default function AuditScreen() {
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<AuditRow[]>();
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient.get('/admin/audit', {
        params: { limit: 50, ...(action.trim() ? { action: action.trim() } : {}) },
      });
      setRows(response.data.data as AuditRow[]);
    } catch (caught) {
      setError(errorMessage(caught, language, t('audit.couldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [action, language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen scroll={false}>
      <Field label={t('audit.action')} hint={t('audit.actionHint')}>
        <Input
          label={t('audit.action')}
          autoCapitalize="characters"
          value={action}
          onChangeText={setAction}
          onSubmitEditing={() => void load()}
        />
      </Field>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!rows && !error ? <LoadingState label={t('audit.loading')} /> : null}

      <FlatList
        data={rows ?? []}
        keyExtractor={(row) => row._id}
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
        ListEmptyComponent={rows ? <EmptyState title={t('audit.none')} /> : null}
        renderItem={({ item }) => (
          <Card>
            <Text style={{ color: colour.text, fontWeight: '600' }}>{item.action}</Text>
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {formatFinanceDateTime(item.createdAt)}
            </Text>
            {actorName(item) ? <ListRow label={t('audit.who')} value={actorName(item)} /> : null}
            {item.entityType ? <ListRow label={t('audit.what')} value={item.entityType} /> : null}
            {/*
              What ties this line to the server log. An administrator ringing
              whoever runs the deployment needs to be able to read it out.
            */}
            {item.correlationId ? (
              <ListRow label={t('audit.reference')} value={item.correlationId} />
            ) : null}
          </Card>
        )}
      />
    </Screen>
  );
}
