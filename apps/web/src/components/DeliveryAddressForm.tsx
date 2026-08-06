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
 * The write is `PATCH /shops/:id` with the whole array, because that is the
 * shape the endpoint takes. That means reading the current list first and
 * sending it back with one more on the end: a difference would be interpreted
 * as a replacement, and the shop would lose every address it had.
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
      const existing = (shop.deliveryAddresses ?? []) as unknown as Array<Record<string, unknown>>;
      const response = await apiClient.patch(`/shops/${shop._id}`, {
        // The whole list, existing entries included. Sending only the new one
        // would replace the array and lose every address the shop had.
        deliveryAddresses: [
          // `_id` and all, so the ones that already exist keep their identity
          // and a picker holding one does not end up pointing at nothing.
          ...existing,
          {
            label: form.label,
            line1: form.line1,
            line2: form.line2 || undefined,
            city: form.city,
            district: form.district,
            postalCode: form.postalCode || undefined,
          },
        ],
      });
      await queryClient.invalidateQueries({ queryKey: keys.shops.all });
      /*
       * The id is minted by the server, so it is read back off the saved
       * record rather than guessed. The new address is the last one, which is
       * the order it was appended in.
       */
      const saved = response.data.data as Shop;
      const addresses = (saved.deliveryAddresses ?? []) as unknown as Array<{ _id: string }>;
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
