import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Textarea,
  toast,
} from '../components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../lib/useLanguage';
import { keys } from '../lib/queryKeys';

/**
 * Two hosts, one form.
 *
 * As a page it carries its own heading and card and returns to the list. In a
 * dialog it is the `<form>` alone and hands the new record's id back to the
 * picker that opened it — because the point of creating from inside another
 * form is not leaving it.
 */
export interface WarehouseFormProps {
  /** Present means "in a dialog": no page chrome, no navigation. */
  onCreated?: (id: string) => void;
  onCancel?: () => void;
}

export function WarehouseForm({ onCreated, onCancel }: WarehouseFormProps = {}) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: '',
    name: '',
    line1: '',
    city: '',
    district: '',
    contactPhone: '',
    notes: '',
  });
  const [makeDefault, setMakeDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setSubmitting(true);
    try {
      const response = await apiClient.post('/inventory/warehouses', {
        code: form.code,
        name: form.name,
        address: {
          line1: form.line1 || undefined,
          city: form.city || undefined,
          district: form.district || undefined,
        },
        contactPhone: form.contactPhone || undefined,
        notes: form.notes || undefined,
        makeDefault,
      });
      queryClient.invalidateQueries({ queryKey: keys.stock.all });
      toast.success(t('warehouses.saved', { name: form.name }));
      if (onCreated) onCreated(response.data.data._id);
      else navigate('/inventory/warehouses');
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('warehouses.saveFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const set = (name: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [name]: value }));

  const body = (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {failure && <ErrorState message={failure.message} reference={failure.reference} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('warehouses.code')} hint={t('warehouses.codeHint')} required>
          <Input
            required
            value={form.code}
            onChange={(event) => set('code', event.target.value.toUpperCase())}
          />
        </Field>
        <Field label={t('warehouses.name')} required hint={t('hints.warehouseName')}>
          <Input required value={form.name} onChange={(event) => set('name', event.target.value)} />
        </Field>
        <Field label={t('fields.address')} hint={t('hints.warehouseAddress')}>
          <Input value={form.line1} onChange={(event) => set('line1', event.target.value)} />
        </Field>
        <Field label={t('warehouses.city')} hint={t('hints.city')}>
          <Input value={form.city} onChange={(event) => set('city', event.target.value)} />
        </Field>
        <Field label={t('warehouses.district')} hint={t('hints.district')}>
          <Input value={form.district} onChange={(event) => set('district', event.target.value)} />
        </Field>
        <Field label={t('warehouses.contactPhone')} hint={t('hints.contactPhone')}>
          <Input
            type="tel"
            value={form.contactPhone}
            onChange={(event) => set('contactPhone', event.target.value)}
          />
        </Field>
      </div>

      <Field label={t('warehouses.makeDefault')} hint={t('warehouses.makeDefaultHint')}>
        <Select
          value={makeDefault ? 'yes' : 'no'}
          onChange={(event) => setMakeDefault(event.target.value === 'yes')}
        >
          <option value="no">{t('common.off')}</option>
          <option value="yes">{t('common.on')}</option>
        </Select>
      </Field>

      <Field label={t('fields.notes')} hint={t('hints.notesOptional')}>
        <Textarea
          rows={3}
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" variant="primary" busy={submitting}>
          {t('warehouses.save')}
        </Button>
      </div>
    </form>
  );

  if (onCreated) return body;

  return (
    <>
      <PageHeader
        routeId="warehouse-new"
        title={t('warehouses.addTitle')}
        description={t('warehouses.addSubtitle')}
        actions={<LinkButton to="/inventory/warehouses">{t('warehouses.title')}</LinkButton>}
      />
      <Card className="max-w-2xl">{body}</Card>
    </>
  );
}
