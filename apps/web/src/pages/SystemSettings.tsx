import { useCallback, useEffect, useState } from 'react';
import { SettingSource, SettingsGroup } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import './inventory.css';
import { requireReason, useAsk } from '../components/ui';

type GroupValues = Record<string, unknown>;

interface SettingsPayload {
  settings: Record<string, GroupValues>;
  sources: Record<string, SettingSource>;
  versions: Record<string, number>;
  descriptions: Record<string, string>;
  fallbacks: Record<string, GroupValues>;
}

const GROUP_LABELS: Record<string, string> = {
  business: 'Business identity',
  finance: 'Finance and credit',
  inventory: 'Inventory thresholds',
  delivery: 'Delivery proof',
  notifications: 'Notification defaults',
  localisation: 'Localisation',
  security: 'Security policy',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Display name',
  legalName: 'Legal name',
  logoUrl: 'Logo URL',
  address: 'Address',
  phone: 'Phone',
  email: 'Email',
  website: 'Website',
  tradeLicenceNumber: 'Trade licence number',
  drugLicenceNumber: 'Drug licence number',
  invoiceFooter: 'Invoice footer',
  taxBasisPoints: 'Tax (basis points, 750 = 7.50%)',
  defaultPaymentTermsDays: 'Default payment terms (days)',
  creditBlockOnLimitExceeded: 'Block ordering when the credit limit is exceeded',
  creditBlockOverdueThresholdMinor: 'Overdue block threshold (poisha)',
  creditOverdueGraceDays: 'Overdue grace period (days)',
  customerAdvanceEnabled: 'Allow customer advances',
  deliveryCollectionRequiresVerification: 'Delivery collections require verification',
  nearExpiryDays: 'Near-expiry window (days)',
  lowStockThreshold: 'Low-stock threshold (units)',
  requiredProofs: 'Required delivery proofs',
  otpExpiryMinutes: 'Receiver OTP lifetime (minutes)',
  overdueDigestEnabled: 'Send the daily overdue digest',
  nearExpiryDigestEnabled: 'Send the daily near-expiry digest',
  timezone: 'Time zone (IANA)',
  locale: 'Locale',
  dateFormat: 'Date format',
  currencyCode: 'Currency code',
  currencySymbol: 'Currency symbol',
  passwordMinLength: 'Minimum password length',
  maxLoginAttempts: 'Failed sign-ins before lockout',
  lockoutMinutes: 'Lockout duration (minutes)',
  forcePasswordChangeOnCreate: 'Force a password change on first sign-in',
};

const PROOF_OPTIONS = ['OTP', 'SIGNATURE', 'PHOTOGRAPH', 'GPS'];
const LOCALE_OPTIONS = ['en', 'bn'];
const DATE_FORMAT_OPTIONS = ['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];

const SOURCE_LABELS: Record<string, string> = {
  PERSISTED: 'Saved here',
  ENVIRONMENT: 'From the environment',
  DEFAULT: 'Built-in default',
};

export function SystemSettings() {
  const ask = useAsk();
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, GroupValues>>({});
  const [activeGroup, setActiveGroup] = useState<string>(SettingsGroup.BUSINESS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/settings');
      setPayload(response.data.data);
      setDraft(structuredClone(response.data.data.settings));
      setError('');
    } catch (caught) {
      const failure = caught as { response?: { status?: number } };
      setError(
        failure.response?.status === 403
          ? 'Your role cannot view system settings.'
          : 'Unable to load system settings.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setField = (group: string, field: string, value: unknown) => {
    setDraft((current) => ({ ...current, [group]: { ...current[group], [field]: value } }));
    setStatus('');
  };

  const save = async (group: string) => {
    if (!payload) return;
    setStatus('Saving...');
    try {
      await apiClient.put(`/settings/${group}`, {
        values: draft[group],
        version: payload.versions[group],
      });
      setStatus(`${GROUP_LABELS[group]} saved.`);
      setError('');
      await load();
    } catch (caught) {
      setStatus('');
      const failure = caught as {
        response?: { data?: { error?: { code?: string; message?: string } } };
      };
      const stale = failure.response?.data?.error?.code === 'STALE_SETTINGS';
      // Reload first: `load` clears the error on success, so setting the
      // message afterwards is what keeps the explanation on screen.
      if (stale) await load();
      setError(
        stale
          ? 'Someone else changed these settings. The latest values have been reloaded.'
          : (failure.response?.data?.error?.message ?? 'Unable to save these settings.'),
      );
    }
  };

  const reset = async (group: string) => {
    if (!payload) return;
    const reason = await ask.prompt({
      title: `Reset ${GROUP_LABELS[group]}?`,
      description:
        'The saved values are discarded and the built-in or environment values take over. The ' +
        'discarded values stay in the audit log.',
      label: 'Why is this being reset?',
      multiline: true,
      confirmLabel: 'Reset these settings',
      danger: true,
      validate: requireReason(),
    });
    if (!reason) return;
    setStatus('Resetting...');
    try {
      await apiClient.post(`/settings/${group}/reset`, {
        version: payload.versions[group],
        reason,
      });
      setStatus(`${GROUP_LABELS[group]} reset to its fallback values.`);
      setError('');
      await load();
    } catch (caught) {
      setStatus('');
      const failure = caught as { response?: { data?: { error?: { message?: string } } } };
      setError(failure.response?.data?.error?.message ?? 'Unable to reset these settings.');
    }
  };

  const renderField = (group: string, field: string, value: unknown) => {
    const label = FIELD_LABELS[field] ?? field;
    const id = `${group}-${field}`;

    if (typeof value === 'boolean') {
      return (
        <label key={field} className="settings-field checkbox">
          <input
            id={id}
            type="checkbox"
            checked={value}
            onChange={(event) => setField(group, field, event.target.checked)}
          />
          <span>{label}</span>
        </label>
      );
    }

    if (field === 'requiredProofs' && Array.isArray(value)) {
      return (
        <fieldset key={field} className="settings-field">
          <legend>{label}</legend>
          {PROOF_OPTIONS.map((proof) => (
            <label key={proof} className="checkbox">
              <input
                type="checkbox"
                checked={(value as string[]).includes(proof)}
                onChange={(event) =>
                  setField(
                    group,
                    field,
                    event.target.checked
                      ? [...(value as string[]), proof]
                      : (value as string[]).filter((entry) => entry !== proof),
                  )
                }
              />
              <span>{proof}</span>
            </label>
          ))}
        </fieldset>
      );
    }

    if (field === 'defaultQuietHours' && value && typeof value === 'object') {
      const quiet = value as { enabled: boolean; start: string; end: string };
      return (
        <fieldset key={field} className="settings-field">
          <legend>Default quiet hours</legend>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={quiet.enabled}
              onChange={(event) =>
                setField(group, field, { ...quiet, enabled: event.target.checked })
              }
            />
            <span>Enabled for users who have saved none</span>
          </label>
          <label htmlFor={`${id}-start`}>From</label>
          <input
            id={`${id}-start`}
            type="time"
            value={quiet.start}
            onChange={(event) => setField(group, field, { ...quiet, start: event.target.value })}
          />
          <label htmlFor={`${id}-end`}>To</label>
          <input
            id={`${id}-end`}
            type="time"
            value={quiet.end}
            onChange={(event) => setField(group, field, { ...quiet, end: event.target.value })}
          />
        </fieldset>
      );
    }

    if (field === 'locale' || field === 'dateFormat') {
      const options = field === 'locale' ? LOCALE_OPTIONS : DATE_FORMAT_OPTIONS;
      return (
        <div key={field} className="settings-field">
          <label htmlFor={id}>{label}</label>
          <select
            id={id}
            value={String(value ?? '')}
            onChange={(event) => setField(group, field, event.target.value)}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (typeof value === 'number') {
      return (
        <div key={field} className="settings-field">
          <label htmlFor={id}>{label}</label>
          <input
            id={id}
            type="number"
            value={value}
            onChange={(event) => setField(group, field, Number(event.target.value))}
          />
        </div>
      );
    }

    return (
      <div key={field} className="settings-field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type="text"
          value={String(value ?? '')}
          onChange={(event) => setField(group, field, event.target.value)}
        />
      </div>
    );
  };

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>System settings</h1>
          <p>
            Saved values take effect immediately. Documents already issued keep the snapshot taken
            when they were created.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()}>
          Reload
        </button>
      </header>

      {error ? (
        <section className="state error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}
      {status ? <p className="state success">{status}</p> : null}

      {loading ? (
        <section className="state">Loading system settings...</section>
      ) : !payload ? (
        <section className="state">System settings are unavailable.</section>
      ) : (
        <>
          <nav className="filter-tabs" aria-label="Settings group">
            {Object.keys(GROUP_LABELS).map((group) => (
              <button
                key={group}
                className={activeGroup === group ? 'selected' : ''}
                onClick={() => setActiveGroup(group)}
              >
                {GROUP_LABELS[group]}
              </button>
            ))}
          </nav>

          <section className="preference-block">
            <header className="settings-group-heading">
              <div>
                <h2>{GROUP_LABELS[activeGroup]}</h2>
                <p>{payload.descriptions[activeGroup]}</p>
              </div>
              <span className="status" title="Where the effective values come from">
                {SOURCE_LABELS[payload.sources[activeGroup]] ?? payload.sources[activeGroup]}
              </span>
            </header>

            <div className="settings-grid">
              {Object.entries(draft[activeGroup] ?? {}).map(([field, value]) =>
                renderField(activeGroup, field, value),
              )}
            </div>

            <div className="preference-actions">
              <button type="button" onClick={() => void save(activeGroup)}>
                Save {GROUP_LABELS[activeGroup]}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={payload.sources[activeGroup] !== SettingSource.PERSISTED}
                onClick={() => void reset(activeGroup)}
              >
                Reset to fallback
              </button>
              <button type="button" className="secondary-button" onClick={() => void load()}>
                Discard changes
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
