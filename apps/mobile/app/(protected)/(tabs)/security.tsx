import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { errorMessage } from '@medsupply/api-client';
import {
  deviceLabel,
  endedLabel,
  fetchSessions,
  isRevocable,
  orderSessions,
  revokeEverySession,
  revokeSession,
  type SessionSummary,
} from '../../../src/security/api';
import { formatFinanceDate } from '../../../src/finance/date';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  SectionTitle,
  toast,
  useAsk,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

/**
 * Where this account is signed in, and how to end a session.
 *
 * A phone is the device most likely to be lost or handed to somebody else, so
 * this is the screen that most needs to exist on mobile: until this phase the
 * only way to end a session was to ask an administrator.
 */
export default function SecurityScreen() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSessions(orderSessions(await fetchSessions()));
      setError('');
    } catch (caught) {
      const status = (caught as { response?: { status?: number } }).response?.status;
      setError(
        status === 401
          ? t('auth.sessionEnded')
          : errorMessage(caught, language, t('security.couldNotLoad')),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Ending a session is destructive and cannot be undone from here, so it is
   * always confirmed — through the in-app dialog rather than `Alert.alert`,
   * which renders outside React and so could be neither translated by the
   * provider around this tree nor reached by a test.
   */
  const endOne = async (session: SessionSummary) => {
    const confirmed = await ask.confirm({
      title: session.current ? t('security.signOutThisTitle') : t('security.signOutOtherTitle'),
      description: session.current ? t('security.signOutThisBody') : t('security.signOutOtherBody'),
      confirmLabel: t('security.signOut'),
      danger: true,
    });
    if (!confirmed) return;
    setBusyId(session._id);
    try {
      await revokeSession(session._id);
      toast.success(session.current ? t('security.signedOutThis') : t('security.signedOutOther'));
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('security.signOutFailed')));
    } finally {
      setBusyId('');
    }
  };

  const endAll = async () => {
    const confirmed = await ask.confirm({
      title: t('security.signOutAllTitle'),
      description: t('security.signOutAllBody'),
      confirmLabel: t('security.signOutEverywhere'),
      danger: true,
    });
    if (!confirmed) return;
    setBusyId('all');
    try {
      const revoked = await revokeEverySession();
      toast.success(t('security.signedOutAll', { count: revoked }));
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('security.signOutFailed')));
    } finally {
      setBusyId('');
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.canvas }}>
        <LoadingState label={t('security.loading')} />
      </View>
    );
  }

  const live = sessions.filter((session) => isRevocable(session));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colour.canvas }}
      contentContainerStyle={{
        padding: layout.space[4],
        gap: layout.space[3],
        paddingBottom: layout.space[10],
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    >
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <SectionTitle>{t('security.whereSignedIn')}</SectionTitle>
      <Text style={{ color: colour.textMuted }}>{t('security.immediate')}</Text>

      {sessions.length === 0 ? (
        <EmptyState title={t('security.none')} description={t('security.noneBody')} />
      ) : (
        sessions.map((session) => (
          <Card key={session._id}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: layout.space[2],
              }}
            >
              <Text
                style={{
                  flexShrink: 1,
                  fontSize: layout.fontSize.base,
                  fontWeight: '600',
                  color: colour.text,
                }}
              >
                {deviceLabel(t, session.userAgent)}
              </Text>
              {session.current ? <Badge tone="brand">{t('security.thisDevice')}</Badge> : null}
            </View>
            <ListRow label={t('security.signedIn')} value={formatFinanceDate(session.createdAt)} />
            <ListRow
              label={t('security.lastUsed')}
              value={session.lastUsedAt ? formatFinanceDate(session.lastUsedAt) : '—'}
            />
            <ListRow label={t('security.ipAddress')} value={session.ipAddress ?? '—'} />
            {isRevocable(session) ? (
              <Button
                variant="danger"
                label={t('security.signOut')}
                busy={busyId === session._id}
                disabled={busyId !== ''}
                onPress={() => void endOne(session)}
              />
            ) : (
              <Badge tone="danger">{endedLabel(t, session.revokedReason)}</Badge>
            )}
          </Card>
        ))
      )}

      {live.length > 1 ? (
        <Button
          variant="danger"
          label={t('security.signOutEverywhere')}
          busy={busyId === 'all'}
          disabled={busyId !== ''}
          onPress={() => void endAll()}
        />
      ) : null}
    </ScrollView>
  );
}
