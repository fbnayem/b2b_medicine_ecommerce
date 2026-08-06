import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { parseMoney } from '@medsupply/utilities';
import type { PriceListRecord } from '@medsupply/shared-types';
import type { Shop } from '@medsupply/shared-types';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  ErrorState,
  Field,
  FormNotice,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useQueryClient } from '@tanstack/react-query';
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

/**
 * Two hosts, one form.
 *
 * As a page it carries its own heading and card and opens the new customer. In
 * a dialog it is the `<form>` alone and hands the id back to the picker that
 * opened it — because the point of creating from inside another form is not
 * leaving it.
 *
 * **Only an administrator may create a shop**, and a MANAGER reaches both
 * screens that pick one. The picker hides its own button; this form does not
 * need to know, because the guard is the server's.
 */
export interface ShopFormProps {
  /**
   * Present means "in a dialog": no page chrome, no navigation.
   *
   * The whole record goes back, not only its id. A picker that has just cleared
   * its search term has nothing left to look the name up in, and fetching it
   * again to render a word the form already had is a request for nothing.
   */
  onCreated?: (record: Shop) => void;
  onCancel?: () => void;
}

export function ShopForm({ onCreated, onCancel }: ShopFormProps = {}) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [priceListId, setPriceListId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();
  /** Which submit attempt this is; see `FormNotice`. */
  const [attempt, setAttempt] = useState(0);

  /*
   * Only lists that are in force. Assigning an inactive one is a price that
   * silently does not apply — the resolver skips it and charges this customer
   * from the default instead, which is a decision nobody made.
   */
  const priceLists = useApiCollection<PriceListRecord>(
    keys.priceLists.list('active'),
    // The default page was twenty-five, unstated. See the note below the field.
    '/pricing/price-lists?activeOnly=true&limit=100',
  );

  /*
   * The picker cannot see every list, and says so when that is true.
   *
   * A `<select>` over one page is the same defect as a table with no pager:
   * it is not wrong about what it shows, it is silent about what it does not.
   */
  const truncated = (priceLists.data?.total ?? 0) > (priceLists.data?.items.length ?? 0);

  /*
   * `parseMoney`, not `Math.round(Number(input) * 100)`. The old line was
   * float arithmetic on a credit limit — the figure that decides whether a
   * customer's order is refused — which `AGENTS.md` forbids outright.
   */
  const credit = form.creditLimit ? parseMoney(form.creditLimit) : { ok: true, minor: 0 };
  /*
   * A number typed the wrong way round is not a malfunction, and this form used
   * to answer it with the red "Something went wrong" card. It is now said twice
   * where it belongs: beside the field, and in the summary at the top.
   */
  const creditProblem = credit.ok ? undefined : t('shops.badAmount');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setAttempt((count) => count + 1);
    // On `credit.ok` rather than on `creditProblem`, so the narrowing survives
    // into `credit.minor` below.
    if (!credit.ok) return;

    setSubmitting(true);
    try {
      const response = await apiClient.post('/shops', {
        ...form,
        creditLimit: credit.minor,
        priceListId,
        paymentTermsDays: Number(form.paymentTermsDays),
        drugLicenceExpiryDate: form.drugLicenceExpiryDate || undefined,
      });
      queryClient.invalidateQueries({ queryKey: keys.shops.all });
      if (onCreated) onCreated(response.data.data as Shop);
      else navigate(`/shops/${response.data.data._id}`);
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('shops.createFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const body = (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {failure && <ErrorState message={failure.message} reference={failure.reference} />}
      {attempt > 0 && creditProblem && (
        <FormNotice
          problems={[{ message: creditProblem, focus: 'shop-creditLimit' }]}
          focusKey={attempt}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {TEXT_FIELDS.map(([name, key, type, required]) => (
          <Field
            key={name}
            id={`shop-${name}`}
            label={t(`shops.${key}`)}
            required={required}
            error={name === 'creditLimit' && attempt > 0 ? creditProblem : undefined}
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

      {/*
        A link, not a dialog.

        A price list is a repeating line editor — a name, dates, and one row per
        medicine — which is more than a dialog should hold, and this field is
        optional, so leaving costs less here than it does on a round with stops
        already chosen. The one thing that had to change is the silence: the
        list was capped at twenty-five with nothing on screen saying so.
      */}
      <Field label={t('shops.priceList')} hint={t('shops.priceListHint')}>
        <Select value={priceListId} onChange={(event) => setPriceListId(event.target.value)}>
          <option value="">{t('shops.priceListDefault')}</option>
          {(priceLists.data?.items ?? []).map((list) => (
            <option key={list._id} value={list._id}>
              {list.name}
            </option>
          ))}
        </Select>
      </Field>
      {truncated && (
        <p className="text-sm text-warning">
          {t('shops.priceListTruncated', {
            shown: priceLists.data?.items.length ?? 0,
            total: priceLists.data?.total ?? 0,
          })}
        </p>
      )}
      <p className="text-sm text-text-muted">
        <Link className="text-brand underline" to="/pricing/price-lists/new">
          {t('priceLists.add')}
        </Link>
      </p>

      <Field label={t('shops.internalNotes')} hint={t('hints.notesInternal')}>
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
          {submitting ? t('shops.creating') : t('shops.create')}
        </Button>
      </div>
    </form>
  );

  if (onCreated) return body;

  return (
    <>
      <PageHeader
        routeId="shop-new"
        title={t('shops.addTitle')}
        description={t('shops.addSubtitle')}
        actions={<LinkButton to="/shops">{t('shops.back')}</LinkButton>}
      />
      <Card className="max-w-2xl">{body}</Card>
    </>
  );
}
