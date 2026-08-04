import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { errorMessage } from '@medsupply/api-client';
import {
  fetchEffectiveSettings,
  groupLabel,
  SETTING_GROUPS,
  sourceLabel,
  toRows,
  type EffectiveSettings,
} from '../../../src/settings/api';
import { useLanguage } from '../../../src/i18n/useLanguage';
import {
  Button,
  Card,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
} from '../../../src/components';
import { colour, layout } from '../../../src/theme';

/**
 * Read-only view of what is actually in force. Editing lives on the web
 * application, which Super Admins and Admins have full access to; showing the
 * values here means an administrator in the field can confirm configuration
 * without guessing.
 */
export default function SystemSettingsScreen() {
  const { t, language } = useLanguage();
  const [data, setData] = useState<EffectiveSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchEffectiveSettings());
      setError('');
    } catch (caught) {
      const status = (caught as { response?: { status?: number } }).response?.status;
      setError(
        status === 403
          ? t('errorPages.forbiddenBody')
          : errorMessage(caught, language, t('settings.couldNotLoad')),
      );
    } finally {
      setLoading(false);
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('settings.loading')} />
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <ErrorState message={error || t('settings.couldNotLoad')} onRetry={() => void load()} />
      </Screen>
    );
  }

  const groups = data.settings as unknown as Record<string, Record<string, unknown>>;

  return (
    <Screen>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Text style={{ color: colour.textMuted }}>{t('settings.subtitle')}</Text>

      {SETTING_GROUPS.map((group) => {
        const values = groups[group];
        if (!values) return null;
        return (
          <Card key={group}>
            <SectionTitle>{groupLabel(t, group)}</SectionTitle>
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {t('settings.sourceLabel')}: {sourceLabel(t, data.sources[group])}
            </Text>
            {toRows(t, values).map((row) => (
              <ListRow key={row.label} label={row.label} value={row.value} />
            ))}
          </Card>
        );
      })}

      <Button variant="secondary" label={t('settings.reload')} onPress={() => void load()} />
    </Screen>
  );
}
