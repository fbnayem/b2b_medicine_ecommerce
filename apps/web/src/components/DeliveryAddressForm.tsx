import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Shop } from '@medsupply/shared-types';
import { apiClient, errorMessage, failureReference } from '../api/client';
import { Button, ErrorState, Field, Input, toast } from './ui';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';

/**
 * Where a delivery goes, which nothing in this product could add.
 *
 * A shop's `deliveryAddresses` are set by the seed and by nothing else: there
 * is no screen anywhere that appends one. **A customer with no address cannot
 * order at all** — order entry and checkout both require one — so a shop
 * registered through the product was, until now, unable to buy anything.
 *
 * The write **was** `PATCH /shops/:id` with the whole array read back and sent
 * again with one more on the end — and that endpoint admits administrators
 * only. A manager or a sales representative, which is to say every role that
 * actually takes orders, was shown this form and got a 403 on submitting it.
 * The browser test covering the button signs in as an administrator, so nothing
 * caught it for four phases.
 *
 * It is now `POST /shops/:id/addresses`, which adds one address and touches
 * nothing else. That matters beyond the permission: sending the whole array
 * back meant a concurrent change by anybody else was silently overwritten, and
 * a request that lost a single element removed an address from a shop while
 * looking like it added one.
 */

export interface DeliveryAddressFormProps {
  shop: Shop;
  /** The id of the address that was added, so a picker can select it. */
  onCreated: (id: string) => void;
  onCancel: () => void;
}

/** Exactly `AddressSchema`, so nothing is typed that the server then drops. */
const EMPTY = { label: '', line1: '', line2: '', city: '', district: '', postalCode: '' };

export function DeliveryAddressForm({ shop, onCreated, onCancel }: DeliveryAddressFormProps) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  const set = (key: keyof typeof EMPTY) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setSaving(true);
    try {
      const response = await apiClient.post(`/shops/${shop._id}/addresses`, {
        label: form.label,
        line1: form.line1,
        line2: form.line2 || undefined,
        city: form.city,
        district: form.district,
        postalCode: form.postalCode || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: keys.shops.all });
      /*
       * The id is minted by the server, so it is read back off the answer
       * rather than guessed. The endpoint replies with the whole list — which
       * is what the picker needs to redraw — and the new address is last,
       * because that is the order it was appended in.
       */
      const addresses = (response.data.data ?? []) as Array<{ _id: string }>;
      toast.success(t('addresses.added', { label: form.label }));
      onCreated(addresses[addresses.length - 1]?._id ?? '');
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('addresses.addFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {failure && <ErrorState message={failure.message} reference={failure.reference} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('addresses.label')} hint={t('addresses.labelHint')} required>
          <Input required value={form.label} onChange={set('label')} />
        </Field>
        <Field label={t('addresses.line1')} hint={t('addresses.line1Hint')} required>
          <Input required value={form.line1} onChange={set('line1')} />
        </Field>
        <Field label={t('addresses.line2')} hint={t('hints.addressLine2')}>
          <Input value={form.line2} onChange={set('line2')} />
        </Field>
        <Field label={t('addresses.city')} hint={t('hints.city')} required>
          <Input required value={form.city} onChange={set('city')} />
        </Field>
        <Field label={t('addresses.district')} hint={t('hints.district')} required>
          <Input required value={form.district} onChange={set('district')} />
        </Field>
        <Field label={t('addresses.postalCode')} hint={t('hints.postalCode')}>
          <Input value={form.postalCode} onChange={set('postalCode')} />
        </Field>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" busy={saving}>
          {t('addresses.add')}
        </Button>
      </div>
    </form>
  );
}
