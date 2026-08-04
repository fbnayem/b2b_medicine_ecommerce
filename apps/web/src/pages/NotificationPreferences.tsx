import { useEffect, useState } from 'react';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationEvent,
  NotificationPriority,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import {
  Button,
  Card,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Resource,
  Table,
  Td,
  Th,
  toast,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { humaniseEnum } from '@medsupply/utilities';

interface CatalogueEntry {
  event: NotificationEvent;
  category: NotificationCategory;
  priority: NotificationPriority;
  defaultChannels: NotificationChannel[];
}

interface CatalogueResponse {
  channels: NotificationChannel[];
  events: CatalogueEntry[];
}

interface Preference {
  defaultChannels: NotificationChannel[] | null;
  overrides: Array<{ event: NotificationEvent; channels: NotificationChannel[] }>;
  quietHours: { enabled: boolean; start: string; end: string };
  mutedEvents: NotificationEvent[];
}

/**
 * A grid of checkboxes, and the one screen in this sweep that keeps a raw
 * `<table>` on purpose.
 *
 * `DataTable` stacks a row into labelled blocks below the breakpoint, which is
 * right for a list of records and wrong here: this is a matrix, and its meaning
 * lives in the intersection of a row and a column. Stacked, "Email — checked"
 * repeated five times per event says almost nothing. So it uses the `Table`,
 * `Th` and `Td` primitives — which carry the sticky header, the scopes and the
 * focus styling — inside the scrolling wrapper they already provide.
 *
 * **The event names are not translated, and that is deliberate rather than
 * missed.** The catalogue is served by the API, and the words for an event
 * belong beside its notification template on the server, not in a client
 * catalogue that would silently drift from the message the user actually
 * receives. Recorded here so the gap is a decision with an owner.
 */
export function NotificationPreferences() {
  const { t } = useLanguage();
  const catalogue = useApiResource<CatalogueResponse>(
    ['notification-catalogue'],
    '/notifications/catalogue',
  );
  const saved = useApiResource<Partial<Preference>>(
    ['notification-preferences'],
    '/notifications/preferences',
  );

  const [preference, setPreference] = useState<Preference>();

  // The server's answer is the starting point, not the live state: every
  // checkbox edits a local copy until "Save" is pressed, and "Undo my changes"
  // is simply this effect running again after a refetch.
  useEffect(() => {
    if (!saved.data) return;
    setPreference({
      defaultChannels: saved.data.defaultChannels ?? null,
      overrides: saved.data.overrides ?? [],
      quietHours: saved.data.quietHours ?? { enabled: false, start: '22:00', end: '07:00' },
      mutedEvents: saved.data.mutedEvents ?? [],
    });
  }, [saved.data]);

  function channelsFor(entry: CatalogueEntry): NotificationChannel[] {
    const override = preference?.overrides.find((item) => item.event === entry.event);
    if (override) return override.channels;
    if (preference?.defaultChannels) return preference.defaultChannels;
    return entry.defaultChannels;
  }

  function toggleChannel(entry: CatalogueEntry, channel: NotificationChannel) {
    if (!preference) return;
    const current = channelsFor(entry);
    const next = current.includes(channel)
      ? current.filter((value) => value !== channel)
      : [...current, channel];
    setPreference({
      ...preference,
      overrides: [
        ...preference.overrides.filter((item) => item.event !== entry.event),
        { event: entry.event, channels: next },
      ],
    });
  }

  function toggleMute(entry: CatalogueEntry) {
    if (!preference) return;
    setPreference({
      ...preference,
      mutedEvents: preference.mutedEvents.includes(entry.event)
        ? preference.mutedEvents.filter((value) => value !== entry.event)
        : [...preference.mutedEvents, entry.event],
    });
  }

  async function save() {
    if (!preference) return;
    try {
      await apiClient.put('/notifications/preferences', {
        ...(preference.defaultChannels ? { defaultChannels: preference.defaultChannels } : {}),
        overrides: preference.overrides,
        quietHours: preference.quietHours,
        mutedEvents: preference.mutedEvents,
      });
      toast.success(t('notifications.saved'));
    } catch {
      toast.error(t('notifications.saveFailed'));
    }
  }

  return (
    <main>
      <PageHeader
        routeId="notification-preferences"
        title={t('notifications.preferencesTitle')}
        description={t('notifications.preferencesSubtitle')}
        actions={<LinkButton to="/notifications">{t('actions.back')}</LinkButton>}
      />

      <Resource
        query={catalogue}
        loadingLabel={t('notifications.loadingPreferences')}
        errorMessageFallback={t('notifications.couldNotLoadPreferences')}
      >
        {(data) => (
          <Resource
            query={saved}
            loadingLabel={t('notifications.loadingPreferences')}
            errorMessageFallback={t('notifications.couldNotLoadPreferences')}
          >
            {() =>
              preference ? (
                <div className="flex flex-col gap-4">
                  <Card>
                    <h2 className="mb-1 text-lg font-semibold text-text">
                      {t('notifications.quietHours')}
                    </h2>
                    <p className="mb-3 max-w-prose text-text-muted">
                      {t('notifications.quietHoursBody')}
                    </p>
                    <div className="flex flex-wrap items-end gap-4">
                      <label className="flex min-h-11 items-center gap-2 text-text">
                        <input
                          type="checkbox"
                          checked={preference.quietHours.enabled}
                          onChange={(event) =>
                            setPreference({
                              ...preference,
                              quietHours: {
                                ...preference.quietHours,
                                enabled: event.target.checked,
                              },
                            })
                          }
                        />
                        {t('notifications.quietHoursEnable')}
                      </label>
                      <Field label={t('notifications.quietFrom')}>
                        <Input
                          type="time"
                          value={preference.quietHours.start}
                          onChange={(event) =>
                            setPreference({
                              ...preference,
                              quietHours: { ...preference.quietHours, start: event.target.value },
                            })
                          }
                        />
                      </Field>
                      <Field label={t('notifications.quietTo')}>
                        <Input
                          type="time"
                          value={preference.quietHours.end}
                          onChange={(event) =>
                            setPreference({
                              ...preference,
                              quietHours: { ...preference.quietHours, end: event.target.value },
                            })
                          }
                        />
                      </Field>
                    </div>
                  </Card>

                  <Card>
                    <h2 className="mb-1 text-lg font-semibold text-text">
                      {t('notifications.channelsByEvent')}
                    </h2>
                    <p className="mb-3 max-w-prose text-text-muted">
                      {t('notifications.inAppAlways')}
                    </p>
                    <Table>
                      <caption className="sr-only">{t('notifications.channelsByEvent')}</caption>
                      <thead>
                        <tr>
                          <Th>{t('notifications.event')}</Th>
                          {data.channels.map((channel) => (
                            <Th key={channel}>{t(`notificationChannel.${channel}`)}</Th>
                          ))}
                          <Th>{t('notifications.mute')}</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.events.map((entry) => {
                          const muted = preference.mutedEvents.includes(entry.event);
                          const active = channelsFor(entry);
                          return (
                            <tr key={entry.event} className={muted ? 'opacity-60' : undefined}>
                              <Th scope="row" className="text-start font-normal">
                                <span className="text-text">{humaniseEnum(entry.event)}</span>
                                <span className="block text-sm text-text-muted">
                                  {t(`notificationCategory.${entry.category}`)}
                                </span>
                              </Th>
                              {data.channels.map((channel) => (
                                <Td key={channel}>
                                  <label className="flex min-h-11 items-center">
                                    <span className="sr-only">
                                      {t('notifications.channelForEvent', {
                                        channel: t(`notificationChannel.${channel}`),
                                        event: humaniseEnum(entry.event),
                                      })}
                                    </span>
                                    <input
                                      type="checkbox"
                                      disabled={muted}
                                      checked={active.includes(channel)}
                                      onChange={() => toggleChannel(entry, channel)}
                                    />
                                  </label>
                                </Td>
                              ))}
                              <Td>
                                <label className="flex min-h-11 items-center">
                                  <span className="sr-only">
                                    {t('notifications.muteEvent', {
                                      event: humaniseEnum(entry.event),
                                    })}
                                  </span>
                                  <input
                                    type="checkbox"
                                    checked={muted}
                                    onChange={() => toggleMute(entry)}
                                  />
                                </label>
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </Card>

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button onClick={() => void saved.refetch()}>
                      {t('notifications.discard')}
                    </Button>
                    <Button variant="primary" onClick={() => void save()}>
                      {t('notifications.save')}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-text-muted">{t('notifications.unavailable')}</p>
              )
            }
          </Resource>
        )}
      </Resource>
    </main>
  );
}
