import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationEvent,
  NotificationPriority,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import './inventory.css';

interface CatalogueEntry {
  event: NotificationEvent;
  category: NotificationCategory;
  priority: NotificationPriority;
  defaultChannels: NotificationChannel[];
}

interface Preference {
  defaultChannels: NotificationChannel[] | null;
  overrides: Array<{ event: NotificationEvent; channels: NotificationChannel[] }>;
  quietHours: { enabled: boolean; start: string; end: string };
  mutedEvents: NotificationEvent[];
}

export function NotificationPreferences() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [preference, setPreference] = useState<Preference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catalogueResponse, preferenceResponse] = await Promise.all([
        apiClient.get('/notifications/catalogue'),
        apiClient.get('/notifications/preferences'),
      ]);
      setChannels(catalogueResponse.data.data.channels);
      setCatalogue(catalogueResponse.data.data.events);
      const saved = preferenceResponse.data.data;
      setPreference({
        defaultChannels: saved.defaultChannels ?? null,
        overrides: saved.overrides ?? [],
        quietHours: saved.quietHours ?? { enabled: false, start: '22:00', end: '07:00' },
        mutedEvents: saved.mutedEvents ?? [],
      });
      setError('');
    } catch {
      setError('Unable to load notification preferences.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Falls back to the template defaults when no override exists for the event. */
  const channelsFor = (entry: CatalogueEntry) => {
    const override = preference?.overrides.find((item) => item.event === entry.event);
    if (override) return override.channels;
    if (preference?.defaultChannels) return preference.defaultChannels;
    return entry.defaultChannels;
  };

  const toggleChannel = (entry: CatalogueEntry, channel: NotificationChannel) => {
    if (!preference) return;
    const current = channelsFor(entry);
    const next = current.includes(channel)
      ? current.filter((value) => value !== channel)
      : [...current, channel];
    const others = preference.overrides.filter((item) => item.event !== entry.event);
    setPreference({
      ...preference,
      overrides: [...others, { event: entry.event, channels: next }],
    });
    setStatus('');
  };

  const toggleMute = (entry: CatalogueEntry) => {
    if (!preference) return;
    const muted = preference.mutedEvents.includes(entry.event)
      ? preference.mutedEvents.filter((value) => value !== entry.event)
      : [...preference.mutedEvents, entry.event];
    setPreference({ ...preference, mutedEvents: muted });
    setStatus('');
  };

  const save = async () => {
    if (!preference) return;
    setStatus('Saving...');
    try {
      await apiClient.put('/notifications/preferences', {
        ...(preference.defaultChannels ? { defaultChannels: preference.defaultChannels } : {}),
        overrides: preference.overrides,
        quietHours: preference.quietHours,
        mutedEvents: preference.mutedEvents,
      });
      setStatus('Preferences saved.');
      setError('');
    } catch {
      setStatus('');
      setError('Unable to save preferences. Please try again.');
    }
  };

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Notification preferences</h1>
          <p>
            In-app notifications are always delivered. These settings control the extra channels and
            when they are allowed to interrupt you.
          </p>
        </div>
        <Link className="secondary-button" to="/notifications">
          Back to notifications
        </Link>
      </header>

      {error ? (
        <section className="state error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}
      {status ? <p className="state success">{status}</p> : null}

      {loading ? (
        <section className="state">Loading preferences...</section>
      ) : !preference ? (
        <section className="state">Preferences are unavailable.</section>
      ) : (
        <>
          <section className="preference-block">
            <h2>Quiet hours (Asia/Dhaka)</h2>
            <p>
              Push, SMS and WhatsApp are held during these hours. Email still arrives, and critical
              alerts such as delivery verification codes always come through.
            </p>
            <div className="preference-row">
              <label>
                <input
                  type="checkbox"
                  checked={preference.quietHours.enabled}
                  onChange={(event) =>
                    setPreference({
                      ...preference,
                      quietHours: { ...preference.quietHours, enabled: event.target.checked },
                    })
                  }
                />
                Enable quiet hours
              </label>
              <label htmlFor="quiet-start">From</label>
              <input
                id="quiet-start"
                type="time"
                value={preference.quietHours.start}
                onChange={(event) =>
                  setPreference({
                    ...preference,
                    quietHours: { ...preference.quietHours, start: event.target.value },
                  })
                }
              />
              <label htmlFor="quiet-end">To</label>
              <input
                id="quiet-end"
                type="time"
                value={preference.quietHours.end}
                onChange={(event) =>
                  setPreference({
                    ...preference,
                    quietHours: { ...preference.quietHours, end: event.target.value },
                  })
                }
              />
            </div>
          </section>

          <section className="preference-block">
            <h2>Channels by event</h2>
            <table className="preference-table">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  {channels.map((channel) => (
                    <th scope="col" key={channel}>
                      {channel.replaceAll('_', ' ')}
                    </th>
                  ))}
                  <th scope="col">Mute</th>
                </tr>
              </thead>
              <tbody>
                {catalogue.map((entry) => {
                  const muted = preference.mutedEvents.includes(entry.event);
                  const active = channelsFor(entry);
                  return (
                    <tr key={entry.event} className={muted ? 'muted' : ''}>
                      <th scope="row">
                        <span>{entry.event.replaceAll('_', ' ')}</span>
                        <small>
                          {entry.category} · {entry.priority}
                        </small>
                      </th>
                      {channels.map((channel) => (
                        <td key={channel}>
                          <label>
                            <span className="visually-hidden">
                              {`${channel} for ${entry.event}`}
                            </span>
                            <input
                              type="checkbox"
                              disabled={muted}
                              checked={active.includes(channel)}
                              onChange={() => toggleChannel(entry, channel)}
                            />
                          </label>
                        </td>
                      ))}
                      <td>
                        <label>
                          <span className="visually-hidden">{`Mute ${entry.event}`}</span>
                          <input
                            type="checkbox"
                            checked={muted}
                            onChange={() => toggleMute(entry)}
                          />
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <div className="preference-actions">
            <button type="button" onClick={() => void save()}>
              Save preferences
            </button>
            <button type="button" className="secondary-button" onClick={() => void load()}>
              Discard changes
            </button>
          </div>
        </>
      )}
    </main>
  );
}
