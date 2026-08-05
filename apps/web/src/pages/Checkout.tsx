import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PaymentMethod } from '@medsupply/shared-types';
import type { Shop } from '@medsupply/shared-types';
import { SubmitOrderSchema } from '@medsupply/validation';
import { z } from 'zod';
import { apiClient, errorMessage, failureReference } from '../api/client';
import { useCart } from '../store/useCart';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Resource,
  Select,
  Textarea,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useZodForm } from '../lib/form';
import { useLanguage } from '../lib/useLanguage';

/**
 * The last screen before an order becomes somebody else's work.
 *
 * The fields are validated against **the server's own schema** rather than a
 * second copy of the rules: `SubmitOrderSchema` is what the API checks, and the
 * four fields this form holds are picked straight out of it. The items and the
 * idempotency key are supplied by the page rather than typed, which is why they
 * are picked off rather than the whole schema being used.
 */
const CheckoutFormSchema = SubmitOrderSchema.pick({
  deliveryAddressId: true,
  requestedPaymentMethod: true,
  purchaseOrderReference: true,
  shopNotes: true,
});

type CheckoutValues = z.input<typeof CheckoutFormSchema>;
type CheckoutOutput = z.output<typeof CheckoutFormSchema>;

interface Address {
  _id: string;
  label: string;
  line1: string;
  city: string;
  isDefault?: boolean;
}

function addressesOf(shop: Shop | undefined): Address[] {
  return (shop?.deliveryAddresses ?? []) as unknown as Address[];
}

export function Checkout() {
  const { t } = useLanguage();
  const { items } = useCart();
  const shops = useApiCollection<Shop>(['my-shops'], '/shops/my');

  if (items.length === 0) {
    return (
      <>
        <PageHeader routeId="checkout" title={t('checkout.title')} />
        <EmptyState
          title={t('checkout.empty')}
          description={t('checkout.emptyBody')}
          action={
            <LinkButton variant="primary" to="/medicines">
              {t('cart.browse')}
            </LinkButton>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        routeId="checkout"
        title={t('checkout.title')}
        description={t('checkout.subtitle')}
      />
      <Resource
        query={shops}
        loadingLabel={t('checkout.deliveryAddress')}
        errorMessageFallback={t('checkout.couldNotLoadAddresses')}
      >
        {/*
          The form is a child component so it mounts only once the addresses
          have arrived, which is what lets the default address be a real
          `defaultValue` rather than a `reset()` fired from an effect.
        */}
        {(page) => <CheckoutForm shop={page.items[0]} />}
      </Resource>
    </>
  );
}

function CheckoutForm({ shop }: { shop: Shop | undefined }) {
  const { t, language } = useLanguage();
  const { items, draftId, clear } = useCart();
  const navigate = useNavigate();
  const addresses = addressesOf(shop);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  const form = useZodForm<CheckoutValues, CheckoutOutput>(CheckoutFormSchema, {
    defaultValues: {
      deliveryAddressId:
        addresses.find((address) => address.isDefault)?._id ?? addresses[0]?._id ?? '',
      requestedPaymentMethod: PaymentMethod.CASH,
      purchaseOrderReference: '',
      shopNotes: '',
    },
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      const body = {
        ...values,
        purchaseOrderReference: values.purchaseOrderReference || undefined,
        shopNotes: values.shopNotes || undefined,
        items: items.map((item) => ({
          medicineId: item.medicine._id,
          requestedQuantity: item.quantity,
          shopNotes: item.notes,
        })),
        idempotencyKey: crypto.randomUUID(),
      };
      const url = draftId ? `/orders/drafts/${draftId}/submit` : '/orders/submit';
      const response = await apiClient.post(url, body);
      clear();
      navigate(`/orders/${response.data.data._id}?submitted=1`);
    } catch (caught) {
      // Kept beside the message rather than squeezed into it: a failed order is
      // exactly the call support receives, and the correlation id is what lets
      // them find the request rather than the hour.
      setFailure({
        message: errorMessage(caught, language, t('checkout.failed')),
        reference: failureReference(caught),
      });
    }
  });

  return (
    <Card className="max-w-2xl">
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        {failure && <ErrorState message={failure.message} reference={failure.reference} />}

        <Field
          label={t('checkout.deliveryAddress')}
          required
          error={form.formState.errors.deliveryAddressId?.message}
        >
          <Select {...form.register('deliveryAddressId')}>
            <option value="">{t('checkout.selectAddress')}</option>
            {addresses.map((address) => (
              <option key={address._id} value={address._id}>
                {address.label}: {address.line1}, {address.city}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t('checkout.paymentMethod')}
          required
          error={form.formState.errors.requestedPaymentMethod?.message}
        >
          {/*
            `value` on every option. Without it an option submits its own text,
            so choosing mobile money sent the literal "MOBILE FINANCIAL SERVICE"
            and only the four single-word methods round-tripped correctly.
          */}
          <Select {...form.register('requestedPaymentMethod')}>
            {Object.values(PaymentMethod).map((method) => (
              <option key={method} value={method}>
                {t(`paymentMethod.${method}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t('checkout.purchaseOrder')}
          hint={t('checkout.purchaseOrderHint')}
          error={form.formState.errors.purchaseOrderReference?.message}
        >
          <Input {...form.register('purchaseOrderReference')} />
        </Field>

        <Field label={t('checkout.deliveryNotes')} error={form.formState.errors.shopNotes?.message}>
          <Textarea {...form.register('shopNotes')} />
        </Field>

        <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('checkout.submitting') : t('checkout.submit')}
        </Button>
      </form>
    </Card>
  );
}
