import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Supplier } from '@medsupply/shared-types';
import type { Translate } from '@medsupply/i18n';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Textarea,
  toast,
} from '../components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../lib/useLanguage';
import { keys } from '../lib/queryKeys';

const EMPTY = {
  name: '',
  contactName: '',
  primaryPhone: '',
  email: '',
  address: '',
  drugLicenceNumber: '',
  drugLicenceExpiryDate: '',
  paymentTermsDays: '30',
  notes: '',
};

type FieldName = keyof typeof EMPTY;

/**
 * The seven fields rendered from the loop below. `address` and `notes` are not
 * among them — they are laid out separately because they need more room — so
 * naming the subset keeps `hintFor` total rather than partial.
 */
type LoopField = Exclude<FieldName, 'address' | 'notes'>;

/** `[field, catalogue key, input type, required]`. */
const FIELDS: Array<[LoopField, string, string, boolean]> = [
  ['name', 'supplierName', 'text', true],
  ['contactName', 'contactName', 'text', false],
  ['primaryPhone', 'phone', 'tel', true],
  ['email', 'email', 'email', false],
  ['drugLicenceNumber', 'licence', 'text', false],
  ['drugLicenceExpiryDate', 'licenceExpiry', 'date', false],
  ['paymentTermsDays', 'paymentTerms', 'number', false],
];

/**
 * The description under each box.
 *
 * Written out one call at a time rather than as `` t(`hints.${key}`) ``,
 * because `catalogueKeys.test.ts` only sees literal call sites — the label
 * above is already invisible to it for exactly that reason, and repeating the
 * mistake would put seven more strings outside the only gate that proves they
 * resolve.
 */
function hintFor(name: LoopField, t: Translate): string {
  const hints: Record<LoopField, string> = {
    name: t('hints.supplierName'),
    contactName: t('hints.supplierContact'),
    primaryPhone: t('hints.supplierPhone'),
    email: t('hints.supplierEmail'),
    drugLicenceNumber: t('hints.supplierLicence'),
    drugLicenceExpiryDate: t('hints.supplierLicenceExpiry'),
    paymentTermsDays: t('hints.supplierPaymentTerms'),
  };
  return hints[name];
}

/**
 * Two hosts, one form.
 *
 * As a page it carries its own heading and card and returns to the list. In a
 * dialog it is the `<form>` alone and hands the new record's id back to the
 * picker that opened it — because the point of creating from inside another
 * form is not leaving it.
 */
export interface SupplierFormProps {
  /**
   * Present means "in a dialog": no page chrome, no navigation.
   *
   * The whole record goes back, not only its id. A picker that has just cleared
   * its search term has nothing left to look the name up in, and fetching it
   * again to render a word the form already had is a request for nothing.
   */
  onCreated?: (record: Supplier) => void;
  onCancel?: () => void;
}

export function SupplierForm({ onCreated, onCancel }: SupplierFormProps = {}) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setSubmitting(true);
    try {
      const response = await apiClient.post('/purchasing/suppliers', {
        name: form.name,
        contactName: form.contactName || undefined,
        primaryPhone: form.primaryPhone,
        email: form.email || undefined,
        address: form.address || undefined,
        drugLicenceNumber: form.drugLicenceNumber || undefined,
        drugLicenceExpiryDate: form.drugLicenceExpiryDate || undefined,
        paymentTermsDays: Number(form.paymentTermsDays) || 0,
        notes: form.notes || undefined,
      });
      queryClient.invalidateQueries({ queryKey: keys.purchasing.all });
      toast.success(t('purchasing.supplierSaved', { name: form.name }));
      if (onCreated) onCreated(response.data.data as Supplier);
      else navigate('/purchasing/suppliers');
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('purchasing.supplierFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const body = (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {failure && <ErrorState message={failure.message} reference={failure.reference} />}

      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(([name, key, type, required]) => (
          <Field
            key={name}
            label={key === 'phone' || key === 'email' ? t(`fields.${key}`) : t(`purchasing.${key}`)}
            hint={hintFor(name, t)}
            required={required}
          >
            <Input
              type={type}
              required={required}
              value={form[name]}
              onChange={(event) =>
                setForm((current) => ({ ...current, [name]: event.target.value }))
              }
            />
          </Field>
        ))}
      </div>

      <Field label={t('fields.address')} hint={t('hints.supplierAddress')}>
        <Textarea
          rows={2}
          value={form.address}
          onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
        />
      </Field>

      <Field label={t('fields.notes')} hint={t('hints.notesInternal')}>
        <Textarea
          rows={3}
          value={form.notes}
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
        />
      </Field>

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" variant="primary" busy={submitting}>
          {t('purchasing.saveSupplier')}
        </Button>
      </div>
    </form>
  );

  if (onCreated) return body;

  return (
    <>
      <PageHeader
        routeId="supplier-new"
        title={t('purchasing.newSupplierTitle')}
        description={t('purchasing.newSupplierSubtitle')}
        actions={
          <LinkButton to="/purchasing/suppliers">{t('purchasing.suppliersTitle')}</LinkButton>
        }
      />
      <Card className="max-w-2xl">{body}</Card>
    </>
  );
}
