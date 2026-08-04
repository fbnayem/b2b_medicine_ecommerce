import { useCallback, useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import type { NotificationChannel } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { formatSettings, humaniseEnum } from '@medsupply/utilities';
import {
  effectiveChannels,
  fetchCatalogue,
  fetchPreferences,
  savePreferences,
  toggleChannel,
  toggleMuted,
  type CatalogueEntry,
  type PreferencePayload,
} from '../../src/notifications/api';
import { registerForPush } from '../../src/notifications/push';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  toast,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

export default function NotificationPreferencesScreen() {
  const { t, language } = useLanguage();
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [preference, setPreference] = useState<PreferencePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pushState, setPushState] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catalogueData, preferenceData] = await Promise.all([
        fetchCatalogue(),
        fetchPreferences(),
      ]);
      setChannels(catalogueData.channels);
      setCatalogue(catalogueData.events);
      setPreference(preferenceData);
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('notifications.couldNotLoadPreferences')));
    } finally {
      setLoading(false);
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!preference) return;
    setSaving(true);
    try {
      await savePreferences(preference);
      toast.success(t('notifications.saved'));
      setError('');
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('notifications.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const enablePush = async () => {
    setPushState(t('common.loading'));
    const outcome = await registerForPush();
    if (outcome.status === 'REGISTERED') setPushState(t('notifications.pushRegistered'));
    else if (outcome.status === 'DENIED') setPushState(t('notifications.pushDenied'));
    else setPushState(outcome.reason);
  };

  if (loading) {
    return (
      <Screen>
        <LoadingState label={t('notifications.loadingPreferences')} />
      </Screen>
    );
  }

  if (!preference) {
    return (
      <Screen>
        <ErrorState message={error || t('notifications.unavailable')} onRetry={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Card>
        <SectionTitle>{t('notifications.pushOnThisDevice')}</SectionTitle>
        <Text style={{ color: colour.textMuted }}>{t('notifications.pushOnThisDeviceBody')}</Text>
        <Button label={t('notifications.enablePush')} onPress={() => void enablePush()} />
        {pushState ? (
          <Text accessibilityLiveRegion="polite" style={{ color: colour.textMuted }}>
            {pushState}
          </Text>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>{t('notifications.quietHours')}</SectionTitle>
        <Text style={{ color: colour.textMuted }}>{t('notifications.quietHoursBody')}</Text>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            minHeight: layout.minTapTarget,
            gap: layout.space[3],
          }}
        >
          <Text style={{ flexShrink: 1, color: colour.text }}>
            {t('notifications.quietHoursEnable')}
          </Text>
          <Switch
            accessibilityLabel={t('notifications.quietHoursEnable')}
            trackColor={{ true: colour.brand, false: colour.disabled }}
            value={preference.quietHours.enabled}
            onValueChange={(value) =>
              setPreference({
                ...preference,
                quietHours: { ...preference.quietHours, enabled: value },
              })
            }
          />
        </View>
        {/*
         * The heading read "Quiet hours (Asia/Dhaka)" with the zone typed in.
         * Phase 12 made the zone a setting, so a deployment that changes it had
         * this screen still telling people their evenings were Dhaka's.
         */}
        <ListRow label={t('notifications.quietFrom')} value={preference.quietHours.start} />
        <ListRow label={t('notifications.quietTo')} value={preference.quietHours.end} />
        <ListRow label={t('settings.fieldTimezone')} value={formatSettings().timeZone} />
      </Card>

      <SectionTitle>{t('notifications.channelsByEvent')}</SectionTitle>
      <Text style={{ color: colour.textMuted }}>{t('notifications.inAppAlways')}</Text>

      {catalogue.map((entry) => {
        const muted = preference.mutedEvents.includes(entry.event);
        const active = effectiveChannels(entry, preference);
        /*
         * The event names are not translated, and that is a decision rather
         * than an omission — the same one recorded on the web screen. The
         * catalogue is served by the API, so the words for an event belong
         * beside its notification template on the server; putting them in a
         * client catalogue would let them drift from the message that actually
         * arrives. `humaniseEnum` at least stops it reading
         * `DELIVERY_OTP_REQUESTED`.
         */
        return (
          <Card key={entry.event} style={muted ? { opacity: 0.6 } : undefined}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                minHeight: layout.minTapTarget,
                gap: layout.space[3],
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
                {humaniseEnum(entry.event)}
              </Text>
              <Switch
                value={!muted}
                accessibilityLabel={t('notifications.muteEvent', {
                  event: humaniseEnum(entry.event),
                })}
                trackColor={{ true: colour.brand, false: colour.disabled }}
                onValueChange={() => setPreference(toggleMuted(entry, preference))}
              />
            </View>

            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {t(`notificationCategory.${entry.category}`)}
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.space[2] }}>
              {channels.map((channel) => {
                const on = active.includes(channel);
                return (
                  <Pressable
                    key={channel}
                    disabled={muted}
                    accessibilityRole="button"
                    accessibilityLabel={t('notifications.channelForEvent', {
                      channel: t(`notificationChannel.${channel}`),
                      event: humaniseEnum(entry.event),
                    })}
                    accessibilityState={{ selected: on, disabled: muted }}
                    onPress={() => setPreference(toggleChannel(entry, preference, channel))}
                    style={{
                      minHeight: layout.minTapTarget,
                      justifyContent: 'center',
                      paddingHorizontal: layout.space[3],
                      borderRadius: layout.radius.full,
                      borderWidth: 1,
                      borderColor: on ? colour.brand : colour.border,
                      backgroundColor: on ? colour.brand : colour.surface,
                      opacity: muted ? 0.5 : 1,
                    }}
                  >
                    <Text
                      style={{
                        color: on ? colour.onBrand : colour.text,
                        fontWeight: '600',
                        fontSize: layout.fontSize.sm,
                      }}
                    >
                      {t(`notificationChannel.${channel}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        );
      })}

      <Button label={t('notifications.save')} busy={saving} onPress={() => void save()} />
      <Button
        variant="secondary"
        label={t('notifications.discard')}
        disabled={saving}
        onPress={() => void load()}
      />
    </Screen>
  );
}
