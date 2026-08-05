import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SettingSource, SettingsGroup } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import {
  Badge,
  Button,
  Card,
  Field,
  FilterTabs,
  Input,
  PageHeader,
  Resource,
  Select,
  requireReason,
  toast,
  useAsk,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';

type GroupValues = Record<string, unknown>;

interface SettingsPayload {
  settings: Record<string, GroupValues>;
  sources: Record<string, SettingSource>;
  versions: Record<string, number>;
  descriptions: Record<string, string>;
  fallbacks: Record<string, GroupValues>;
}

const GROUPS = [
  'business',
  'finance',
  'inventory',
  'delivery',
  'notifications',
  'localisation',
  'security',
];

const PROOF_OPTIONS = ['OTP', 'SIGNATURE', 'PHOTOGRAPH', 'GPS'];
const LOCALE_OPTIONS = ['en', 'bn'];
const DATE_FORMAT_OPTIONS = ['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];

/** `taxBasisPoints` → `settings.fieldTaxBasisPoints`. */
const fieldKey = (field: string) =>
  `settings.field${field.charAt(0).toUpperCase()}${field.slice(1)}`;
const groupKey = (group: string) =>
  `settings.group${group.charAt(0).toUpperCase()}${group.slice(1)}`;

export function SystemSettings() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const queryClient = useQueryClient();

  const query = useApiResource<SettingsPayload>(['settings'], '/settings');
  const payload = query.data;

  const [activeGroup, setActiveGroup] = useState<string>(SettingsGroup.BUSINESS);
  const [draft, setDraft] = useState<Record<string, GroupValues>>({});
  const [busy, setBusy] = useState(false);

  // The server's answer seeds a local copy; every field edits that until
  // "Save" is pressed, and "Undo my changes" is this effect running again.
  useEffect(() => {
    if (payload) setDraft(structuredClone(payload.settings));
  }, [payload]);

  const reload = () => queryClient.invalidateQueries({ queryKey: ['settings'] });

  function setField(group: string, field: string, value: unknown) {
    setDraft((current) => ({ ...current, [group]: { ...current[group], [field]: value } }));
  }

  async function save(group: string) {
    if (!payload) return;
    setBusy(true);
    try {
      await apiClient.put(`/settings/${group}`, {
        values: draft[group],
        version: payload.versions[group],
      });
      await reload();
      toast.success(t('settings.saved', { group: t(groupKey(group)) }));
    } catch (caught) {
      // A stale version means somebody else saved first. Reload before saying
      // so, or the message is read against values already out of date.
      await reload();
      toast.error(errorMessage(caught, language, t('settings.saveFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function reset(group: string) {
    if (!payload) return;
    const reason = await ask.prompt({
      title: t('settings.resetTitle', { group: t(groupKey(group)) }),
      description: t('settings.resetBody'),
      label: t('settings.resetLabel'),
      multiline: true,
      confirmLabel: t('settings.resetConfirm'),
      danger: true,
      validate: requireReason(t),
    });
    if (!reason) return;

    setBusy(true);
    try {
      await apiClient.post(`/settings/${group}/reset`, {
        version: payload.versions[group],
        reason,
      });
      await reload();
      toast.success(t('settings.resetDone', { group: t(groupKey(group)) }));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('settings.resetFailed')));
    } finally {
      setBusy(false);
    }
  }

  function renderField(group: string, field: string, value: unknown) {
    const label = t(fieldKey(field));

    if (typeof value === 'boolean') {
      return (
        <label key={field} className="flex min-h-11 items-center gap-2 text-text">
          <input
            type="checkbox"
            checked={value}
            onChange={(event) => setField(group, field, event.target.checked)}
          />
          {label}
        </label>
      );
    }

    if (field === 'requiredProofs' && Array.isArray(value)) {
      const chosen = value as string[];
      return (
        <fieldset key={field} className="m-0 border-0 p-0">
          <legend className="text-sm font-medium text-text">{label}</legend>
          <div className="flex flex-wrap gap-4">
            {PROOF_OPTIONS.map((proof) => (
              <label key={proof} className="flex min-h-11 items-center gap-2 text-text">
                <input
                  type="checkbox"
                  checked={chosen.includes(proof)}
                  onChange={(event) =>
                    setField(
                      group,
                      field,
                      event.target.checked
                        ? [...chosen, proof]
                        : chosen.filter((entry) => entry !== proof),
                    )
                  }
                />
                {proof}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    if (field === 'defaultQuietHours' && value && typeof value === 'object') {
      const quiet = value as { enabled: boolean; start: string; end: string };
      return (
        <fieldset key={field} className="m-0 border-0 p-0">
          <legend className="text-sm font-medium text-text">{t('settings.quietHours')}</legend>
          <label className="flex min-h-11 items-center gap-2 text-text">
            <input
              type="checkbox"
              checked={quiet.enabled}
              onChange={(event) =>
                setField(group, field, { ...quiet, enabled: event.target.checked })
              }
            />
            {t('settings.quietEnabled')}
          </label>
          <div className="mt-2 flex flex-wrap gap-3">
            <Field label={t('settings.from')} className="w-40">
              <Input
                type="time"
                value={quiet.start}
                onChange={(event) =>
                  setField(group, field, { ...quiet, start: event.target.value })
                }
              />
            </Field>
            <Field label={t('settings.to')} className="w-40">
              <Input
                type="time"
                value={quiet.end}
                onChange={(event) => setField(group, field, { ...quiet, end: event.target.value })}
              />
            </Field>
          </div>
        </fieldset>
      );
    }

    if (field === 'locale' || field === 'dateFormat') {
      const options = field === 'locale' ? LOCALE_OPTIONS : DATE_FORMAT_OPTIONS;
      return (
        <Field key={field} label={label}>
          <Select
            value={String(value ?? '')}
            onChange={(event) => setField(group, field, event.target.value)}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {/* A language is named in its own language; a date pattern is
                    a pattern and is shown as written. */}
                {field === 'locale' ? (option === 'bn' ? 'বাংলা' : 'English') : option}
              </option>
            ))}
          </Select>
        </Field>
      );
    }

    if (typeof value === 'number') {
      return (
        <Field key={field} label={label}>
          <Input
            type="number"
            value={value}
            onChange={(event) => setField(group, field, Number(event.target.value))}
          />
        </Field>
      );
    }

    return (
      <Field key={field} label={label}>
        <Input
          value={String(value ?? '')}
          onChange={(event) => setField(group, field, event.target.value)}
        />
      </Field>
    );
  }

  return (
    <>
      <PageHeader
        routeId="settings"
        title={t('settings.title')}
        description={t('settings.subtitle')}
        actions={<Button onClick={() => void query.refetch()}>{t('settings.reload')}</Button>}
      />

      <Resource
        query={query}
        loadingLabel={t('settings.loading')}
        errorMessageFallback={t('settings.couldNotLoad')}
      >
        {(data) => (
          <>
            <div className="mb-4">
              <FilterTabs
                label={t('settings.groupLabel')}
                options={GROUPS.map((group) => ({ value: group, label: t(groupKey(group)) }))}
                value={activeGroup}
                onChange={setActiveGroup}
              />
            </div>

            <Card>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-text">{t(groupKey(activeGroup))}</h2>
                  <p className="max-w-prose text-text-muted">{data.descriptions[activeGroup]}</p>
                </div>
                <Badge>
                  {t('settings.sourceLabel')}: {t(`settings.source${data.sources[activeGroup]}`)}
                </Badge>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {Object.entries(draft[activeGroup] ?? {}).map(([field, value]) =>
                  renderField(activeGroup, field, value),
                )}
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button onClick={() => void query.refetch()}>{t('settings.discard')}</Button>
                <Button
                  disabled={data.sources[activeGroup] !== SettingSource.PERSISTED || busy}
                  onClick={() => void reset(activeGroup)}
                >
                  {t('settings.resetToFallback')}
                </Button>
                <Button variant="primary" busy={busy} onClick={() => void save(activeGroup)}>
                  {t('settings.save')}
                </Button>
              </div>
            </Card>
          </>
        )}
      </Resource>
    </>
  );
}
