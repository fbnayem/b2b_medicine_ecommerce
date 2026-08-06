import { useState, type FormEvent } from 'react';
import type { Address, Shop } from '@medsupply/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient, errorMessage } from '../api/client';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormNotice,
  Input,
  PageHeader,
  Resource,
  toast,
  useAsk,
  type FormProblem,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';

/**
 * Where a pharmacy's deliveries go, maintained by the pharmacy.
 *
 * `deliveryAddresses` had exactly one writer — `PATCH /shops/{id}`, which is
 * administrators only — so a shop that opened a second branch, moved, or simply
 * had a typo in the street had to telephone the distributor and wait. That is
 * not a missing convenience: `POST /orders/submit` requires a
 * `deliveryAddressId`, so **a shop with no address cannot buy anything**, and a
 * shop that registers itself starts with the one it typed on the form.
 *
 * One address is always the default, and the **server** holds that invariant.
 * Every write here answers with the whole list, which is then rendered as-is
 * rather than adjusted locally: a tick moving from one row to another is the
 * server's answer and not this page's guess.
 */

type EditableAddress = Address & { _id: string };

interface Draft {
  label: string;
  line1: string;
  line2: string;
  city: string;
  district: string;
  postalCode: string;
}

const empty = (): Draft => ({
  label: '',
  line1: '',
  line2: '',
  city: '',
  district: '',
  postalCode: '',
});

const draftFrom = (address: EditableAddress): Draft => ({
  label: address.label,
  line1: address.line1,
  line2: address.line2 ?? '',
  city: address.city,
  district: address.district,
  postalCode: address.postalCode ?? '',
});

/** Stable id, so the validation notice can carry the reader back to the form. */
const FORM_PANEL = 'address-form';

export function DeliveryAddresses() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const queryClient = useQueryClient();

  const mine = useApiCollection<Shop>(keys.shops.mine(), '/shops/my');
  /** `'new'`, an address id, or nothing — which of the three states this is. */
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState('');
  /** Which submit attempt this is; see `FormNotice`. */
  const [attempt, setAttempt] = useState(0);

  /*
   * The same minimums `AddressSchema` enforces, and no more. A page stricter
   * than the server invents a rule nobody wrote down and the person typing has
   * no way to discover what it was.
   */
  const problems: FormProblem[] = [];
  if (!draft.label.trim())
    problems.push({ message: t('addresses.labelRequired'), focus: FORM_PANEL });
  if (draft.line1.trim().length < 5) {
    problems.push({ message: t('addresses.line1TooShort'), focus: FORM_PANEL });
  }
  if (draft.city.trim().length < 2) {
    problems.push({ message: t('addresses.cityTooShort'), focus: FORM_PANEL });
  }
  if (draft.district.trim().length < 2) {
    problems.push({ message: t('addresses.districtTooShort'), focus: FORM_PANEL });
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: keys.shops.all });
  }

  function body() {
    return {
      label: draft.label.trim(),
      line1: draft.line1.trim(),
      city: draft.city.trim(),
      district: draft.district.trim(),
      // `''` is not "no second line" to a schema expecting an optional string;
      // it is an empty one, and it is then drawn as a blank row under the
      // street on every screen that renders the address, including the rider's.
      ...(draft.line2.trim() ? { line2: draft.line2.trim() } : {}),
      ...(draft.postalCode.trim() ? { postalCode: draft.postalCode.trim() } : {}),
    };
  }

  async function save(event: FormEvent, addresses: EditableAddress[]) {
    event.preventDefault();
    setAttempt((count) => count + 1);
    if (problems.length > 0) return;

    setBusy('save');
    setFailure('');
    try {
      if (editing === 'new') {
        // The first address a shop ever has is its default whatever this says —
        // the server decides that, and answers with what it decided.
        await apiClient.post('/shops/my/addresses', {
          ...body(),
          isDefault: addresses.length === 0,
        });
      } else {
        await apiClient.patch(`/shops/my/addresses/${editing}`, body());
      }
      await refresh();
      setEditing(undefined);
      setDraft(empty());
      toast.success(editing === 'new' ? t('addresses.added') : t('addresses.saved'));
    } catch (caught) {
      setFailure(errorMessage(caught, language, t('addresses.saveFailed')));
    } finally {
      setBusy('');
    }
  }

  async function promote(address: EditableAddress) {
    setBusy(address._id);
    try {
      await apiClient.patch(`/shops/my/addresses/${address._id}`, { isDefault: true });
      await refresh();
      toast.success(t('addresses.nowDefault', { label: address.label }));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('addresses.saveFailed')));
    } finally {
      setBusy('');
    }
  }

  async function remove(address: EditableAddress) {
    /*
     * Always confirmed. Orders already placed carry their own copy of the
     * address, so this cannot misdirect a delivery in flight — but retyping one
     * is a minute of work and a mis-click is not a decision.
     */
    const confirmed = await ask.confirm({
      title: t('addresses.removeTitle'),
      description: t('addresses.removeBody', { label: address.label }),
      confirmLabel: t('addresses.remove'),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(address._id);
    try {
      await apiClient.delete(`/shops/my/addresses/${address._id}`);
      await refresh();
      toast.success(t('addresses.removed', { label: address.label }));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('addresses.removeFailed')));
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader
        routeId="addresses"
        title={t('addresses.title')}
        description={t('addresses.subtitle')}
      />

      <Resource
        query={mine}
        loadingLabel={t('addresses.loading')}
        errorMessageFallback={t('addresses.couldNotLoad')}
        isEmpty={() => false}
        empty={
          <EmptyState
            title={t('account.noShopLinked')}
            description={t('account.noShopLinkedBody')}
          />
        }
      >
        {(page) => {
          const addresses = ((page.items[0]?.deliveryAddresses ?? []) as EditableAddress[]).filter(
            (address) => address._id,
          );

          return (
            <div className="flex flex-col gap-4">
              <p className="text-text-muted">{t('addresses.whatFor')}</p>

              {addresses.length === 0 && !editing && (
                <EmptyState title={t('addresses.none')} description={t('addresses.noneBody')} />
              )}

              {addresses.map((address) => (
                <Card key={address._id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 font-medium text-text">
                        {address.label}
                        {address.isDefault && (
                          <span className="text-sm font-medium text-brand">
                            ({t('addresses.default')})
                          </span>
                        )}
                      </p>
                      <p className="text-text-muted">
                        {[address.line1, address.line2, address.city, address.district]
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                      {address.postalCode && (
                        <p className="text-sm text-text-muted">{address.postalCode}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!address.isDefault && (
                        <Button
                          busy={busy === address._id}
                          disabled={busy !== ''}
                          onClick={() => void promote(address)}
                        >
                          {t('addresses.makeDefault')}
                        </Button>
                      )}
                      <Button
                        disabled={busy !== ''}
                        onClick={() => {
                          setDraft(draftFrom(address));
                          setEditing(address._id);
                          setAttempt(0);
                        }}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        variant="danger"
                        busy={busy === address._id}
                        disabled={busy !== ''}
                        onClick={() => void remove(address)}
                      >
                        {t('addresses.remove')}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}

              {editing ? (
                <Card>
                  <form
                    id={FORM_PANEL}
                    tabIndex={-1}
                    className="flex flex-col gap-4"
                    onSubmit={(event) => void save(event, addresses)}
                  >
                    <h2 className="text-lg font-medium text-text">
                      {editing === 'new' ? t('addresses.addTitle') : t('addresses.editTitle')}
                    </h2>
                    {failure && <ErrorState message={failure} />}
                    {attempt > 0 && <FormNotice problems={problems} focusKey={attempt} />}

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label={t('addresses.label')} required hint={t('addresses.labelHint')}>
                        <Input
                          value={draft.label}
                          onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                        />
                      </Field>
                      <Field label={t('addresses.line1')} required hint={t('addresses.line1Hint')}>
                        <Input
                          value={draft.line1}
                          onChange={(event) => setDraft({ ...draft, line1: event.target.value })}
                        />
                      </Field>
                      <Field label={t('addresses.line2')} hint={t('hints.addressLine2')}>
                        <Input
                          value={draft.line2}
                          onChange={(event) => setDraft({ ...draft, line2: event.target.value })}
                        />
                      </Field>
                      <Field label={t('addresses.city')} required hint={t('hints.city')}>
                        <Input
                          value={draft.city}
                          onChange={(event) => setDraft({ ...draft, city: event.target.value })}
                        />
                      </Field>
                      <Field label={t('addresses.district')} required hint={t('hints.district')}>
                        <Input
                          value={draft.district}
                          onChange={(event) => setDraft({ ...draft, district: event.target.value })}
                        />
                      </Field>
                      <Field label={t('addresses.postalCode')} hint={t('hints.postalCode')}>
                        <Input
                          value={draft.postalCode}
                          onChange={(event) =>
                            setDraft({ ...draft, postalCode: event.target.value })
                          }
                        />
                      </Field>
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button
                        onClick={() => {
                          setEditing(undefined);
                          setDraft(empty());
                        }}
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button type="submit" variant="primary" busy={busy === 'save'}>
                        {editing === 'new' ? t('addresses.add') : t('common.save')}
                      </Button>
                    </div>
                  </form>
                </Card>
              ) : (
                <div>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setDraft(empty());
                      setEditing('new');
                      setAttempt(0);
                    }}
                  >
                    {t('addresses.addButton')}
                  </Button>
                </div>
              )}
            </div>
          );
        }}
      </Resource>
    </>
  );
}
