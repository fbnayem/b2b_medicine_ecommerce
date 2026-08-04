import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseMoney } from '@medsupply/utilities';
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
} from '../components/ui';
import { useLanguage } from '../lib/useLanguage';

const EMPTY = {
  name: '',
  primaryPhone: '',
  alternativePhone: '',
  email: '',
  territory: '',
  drugLicenceNumber: '',
  drugLicenceExpiryDate: '',
  creditLimit: '',
  paymentTermsDays: '30',
  notes: '',
};

type FieldName = keyof typeof EMPTY;

const TEXT_FIELDS: Array<[FieldName, string, string, boolean]> = [
  ['name', 'shopName', 'text', true],
  ['primaryPhone', 'primaryPhone', 'tel', true],
  ['alternativePhone', 'alternativePhone', 'tel', false],
  ['email', 'email', 'email', false],
  ['territory', 'territory', 'text', false],
  ['drugLicenceNumber', 'drugLicenceNumber', 'text', false],
  ['drugLicenceExpiryDate', 'drugLicenceExpiry', 'date', false],
  ['creditLimit', 'creditLimit', 'text', false],
  ['paymentTermsDays', 'paymentTerms', 'number', false],
];

export function ShopForm() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);

    /*
     * `parseMoney`, not `Math.round(Number(input) * 100)`. The old line was
     * float arithmetic on a credit limit — the figure that decides whether a
     * customer's order is refused — which `AGENTS.md` forbids outright.
     */
    const credit = form.creditLimit ? parseMoney(form.creditLimit) : { ok: true, minor: 0 };
    if (!credit.ok) {
      setFailure({ message: t('shops.badAmount') });
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiClient.post('/shops', {
        ...form,
        creditLimit: credit.minor,
        paymentTermsDays: Number(form.paymentTermsDays),
        drugLicenceExpiryDate: form.drugLicenceExpiryDate || undefined,
      });
      navigate(`/shops/${response.data.data._id}`);
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('shops.createFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <PageHeader
        routeId="shop-new"
        title={t('shops.addTitle')}
        description={t('shops.addSubtitle')}
        actions={<LinkButton to="/shops">{t('shops.back')}</LinkButton>}
      />

      <Card className="max-w-2xl">
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          {failure && <ErrorState message={failure.message} reference={failure.reference} />}

          <div className="grid gap-4 sm:grid-cols-2">
            {TEXT_FIELDS.map(([name, key, type, required]) => (
              <Field
                key={name}
                label={t(`shops.${key}`)}
                required={required}
                hint={
                  name === 'primaryPhone'
                    ? t('shops.primaryPhoneHint')
                    : name === 'creditLimit'
                      ? t('shops.creditLimitHint')
                      : undefined
                }
              >
                <Input
                  type={type}
                  required={required}
                  inputMode={name === 'creditLimit' ? 'decimal' : undefined}
                  value={form[name]}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, [name]: event.target.value }))
                  }
                />
              </Field>
            ))}
          </div>

          <Field label={t('shops.internalNotes')}>
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
              {submitting ? t('shops.creating') : t('shops.create')}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
