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
  Textarea,
  toast,
} from '../components/ui';
import { useLanguage } from '../lib/useLanguage';

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

/** `[field, catalogue key, input type, required]`. */
const FIELDS: Array<[FieldName, string, string, boolean]> = [
  ['name', 'supplierName', 'text', true],
  ['contactName', 'contactName', 'text', false],
  ['primaryPhone', 'phone', 'tel', true],
  ['email', 'email', 'email', false],
  ['drugLicenceNumber', 'licence', 'text', false],
  ['drugLicenceExpiryDate', 'licenceExpiry', 'date', false],
  ['paymentTermsDays', 'paymentTerms', 'number', false],
];

export function SupplierForm() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setSubmitting(true);
    try {
      await apiClient.post('/purchasing/suppliers', {
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
      toast.success(t('purchasing.supplierSaved', { name: form.name }));
      navigate('/purchasing/suppliers');
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('purchasing.supplierFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

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

      <Card className="max-w-2xl">
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          {failure && <ErrorState message={failure.message} reference={failure.reference} />}

          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map(([name, key, type, required]) => (
              <Field
                key={name}
                label={
                  key === 'phone' || key === 'email' ? t(`fields.${key}`) : t(`purchasing.${key}`)
                }
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

          <Field label={t('fields.address')}>
            <Textarea
              rows={2}
              value={form.address}
              onChange={(event) =>
                setForm((current) => ({ ...current, address: event.target.value }))
              }
            />
          </Field>

          <Field label={t('fields.notes')}>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </Field>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" busy={submitting}>
              {t('purchasing.saveSupplier')}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
