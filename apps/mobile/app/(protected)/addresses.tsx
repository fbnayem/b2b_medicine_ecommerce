import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorMessage } from '@medsupply/api-client';
import {
  addAddress,
  addressProblem,
  deleteAddress,
  draftFrom,
  editAddress,
  emptyDraft,
  getMyAddresses,
  makeDefaultAddress,
  oneLine,
  type AddressDraft,
  type AddressProblem,
  type DeliveryAddress,
} from '../../src/account/addresses';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Screen,
  SectionTitle,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Where a shop's deliveries go, maintained by the shop.
 *
 * This screen did not exist on either client. A pharmacy's addresses were set
 * by the seed script and by an administrator's shop form, so a shop that opened
 * a second branch, moved, or simply had a typo in the street had to telephone
 * the distributor — and **a shop with no address cannot order at all**, because
 * `POST /orders/submit` requires one.
 *
 * One address is always the default. The server holds that invariant rather
 * than this screen, which is why the list is redrawn from the response of every
 * write instead of being adjusted locally: a tick moving from one row to
 * another is the server's answer, not this screen's guess.
 */

/** The editor, used for both adding and changing. */
function AddressForm({
  draft,
  problem,
  onChange,
  onSubmit,
  onCancel,
  busy,
  submitLabel,
}: {
  draft: AddressDraft;
  problem: AddressProblem | null;
  onChange: (next: AddressDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  submitLabel: string;
}) {
  const { t } = useLanguage();
  // Shown only once somebody has tried to save. Marking a form red before it
  // has been filled in tells people they have done something wrong by opening
  // it.
  const [attempted, setAttempted] = useState(false);
  const shown = attempted ? problem : null;
  const errorFor = (field: AddressProblem['field']) =>
    shown?.field === field ? t(shown.key) : undefined;

  return (
    <Card>
      <Field label={t('addresses.label')} hint={t('addresses.labelHint')} error={errorFor('label')}>
        <Input
          label={t('addresses.label')}
          value={draft.label}
          onChangeText={(label) => onChange({ ...draft, label })}
          invalid={shown?.field === 'label'}
        />
      </Field>

      <Field label={t('addresses.line1')} hint={t('addresses.line1Hint')} error={errorFor('line1')}>
        <Input
          label={t('addresses.line1')}
          value={draft.line1}
          onChangeText={(line1) => onChange({ ...draft, line1 })}
          invalid={shown?.field === 'line1'}
        />
      </Field>

      <Field label={t('addresses.line2')}>
        <Input
          label={t('addresses.line2')}
          value={draft.line2}
          onChangeText={(line2) => onChange({ ...draft, line2 })}
        />
      </Field>

      <Field label={t('addresses.city')} error={errorFor('city')}>
        <Input
          label={t('addresses.city')}
          value={draft.city}
          onChangeText={(city) => onChange({ ...draft, city })}
          invalid={shown?.field === 'city'}
        />
      </Field>

      <Field label={t('addresses.district')} error={errorFor('district')}>
        <Input
          label={t('addresses.district')}
          value={draft.district}
          onChangeText={(district) => onChange({ ...draft, district })}
          invalid={shown?.field === 'district'}
        />
      </Field>

      <Field label={t('addresses.postalCode')}>
        <Input
          label={t('addresses.postalCode')}
          value={draft.postalCode}
          onChangeText={(postalCode) => onChange({ ...draft, postalCode })}
          keyboardType="number-pad"
        />
      </Field>

      <Button
        label={submitLabel}
        busy={busy}
        onPress={() => {
          setAttempted(true);
          if (!problem) onSubmit();
        }}
      />
      <Button variant="secondary" label={t('common.cancel')} onPress={onCancel} />
    </Card>
  );
}

export default function AddressesScreen() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [addresses, setAddresses] = useState<DeliveryAddress[]>();
  const [error, setError] = useState('');
  /** `'new'`, an address id, or nothing — which of the three states this is. */
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<AddressDraft>(emptyDraft);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setAddresses(await getMyAddresses());
    } catch (caught) {
      setError(errorMessage(caught, language, t('addresses.couldNotLoad')));
    }
  }, [language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setBusy('save');
    try {
      const next =
        editing === 'new'
          ? // The first address a shop has is its default whatever this says —
            // the server decides that, and answers with what it decided.
            await addAddress(draft, addresses?.length === 0)
          : await editAddress(editing!, draft);
      setAddresses(next);
      setEditing(undefined);
      setDraft(emptyDraft());
      toast.success(editing === 'new' ? t('addresses.added') : t('addresses.saved'));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('addresses.saveFailed')));
    } finally {
      setBusy('');
    }
  }, [addresses?.length, draft, editing, language, t]);

  const promote = useCallback(
    async (address: DeliveryAddress) => {
      setBusy(address._id);
      try {
        setAddresses(await makeDefaultAddress(address._id));
        toast.success(t('addresses.nowDefault', { label: address.label }));
      } catch (caught) {
        toast.error(errorMessage(caught, language, t('addresses.saveFailed')));
      } finally {
        setBusy('');
      }
    },
    [language, t],
  );

  const remove = useCallback(
    async (address: DeliveryAddress) => {
      /*
       * Always confirmed. Orders already placed carry their own copy of the
       * address, so this cannot misdirect a delivery in flight — but it is the
       * kind of row somebody deletes by mis-tapping beside it, and typing it
       * back in on a phone is a minute of work.
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
        setAddresses(await deleteAddress(address._id));
        toast.success(t('addresses.removed', { label: address.label }));
      } catch (caught) {
        toast.error(errorMessage(caught, language, t('addresses.removeFailed')));
      } finally {
        setBusy('');
      }
    },
    [ask, language, t],
  );

  if (error && !addresses) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  if (!addresses) {
    return (
      <Screen>
        <LoadingState label={t('addresses.loading')} />
      </Screen>
    );
  }

  const problem = addressProblem(draft);

  return (
    <Screen>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Text style={{ color: colour.textMuted }}>{t('addresses.whatFor')}</Text>

      {editing ? (
        <>
          <SectionTitle>
            {editing === 'new' ? t('addresses.addTitle') : t('addresses.editTitle')}
          </SectionTitle>
          <AddressForm
            draft={draft}
            problem={problem}
            onChange={setDraft}
            onSubmit={() => void save()}
            onCancel={() => {
              setEditing(undefined);
              setDraft(emptyDraft());
            }}
            busy={busy === 'save'}
            submitLabel={editing === 'new' ? t('addresses.add') : t('common.save')}
          />
        </>
      ) : null}

      {addresses.length === 0 && !editing ? (
        <EmptyState
          title={t('addresses.none')}
          description={t('addresses.noneBody')}
          action={{
            label: t('addresses.addButton'),
            onPress: () => {
              setDraft(emptyDraft());
              setEditing('new');
            },
          }}
        />
      ) : null}

      {addresses.map((address) => (
        <Card key={address._id}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: layout.space[2],
            }}
          >
            <Text style={{ color: colour.text, fontWeight: '600', flexShrink: 1 }}>
              {address.label}
            </Text>
            {address.isDefault ? <Badge tone="brand">{t('addresses.default')}</Badge> : null}
          </View>
          <Text style={{ color: colour.textMuted }}>{oneLine(address)}</Text>
          {address.postalCode ? (
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {address.postalCode}
            </Text>
          ) : null}

          {address.isDefault ? null : (
            <Button
              variant="secondary"
              label={t('addresses.makeDefault')}
              accessibilityLabel={t('addresses.makeDefaultOne', { label: address.label })}
              busy={busy === address._id}
              disabled={busy !== ''}
              onPress={() => void promote(address)}
            />
          )}
          <Button
            variant="secondary"
            label={t('common.edit')}
            accessibilityLabel={t('addresses.editOne', { label: address.label })}
            disabled={busy !== ''}
            onPress={() => {
              setDraft(draftFrom(address));
              setEditing(address._id);
            }}
          />
          <Button
            variant="danger"
            label={t('addresses.remove')}
            accessibilityLabel={t('addresses.removeOne', { label: address.label })}
            busy={busy === address._id}
            disabled={busy !== ''}
            onPress={() => void remove(address)}
          />
        </Card>
      ))}

      {!editing && addresses.length > 0 ? (
        <Button
          label={t('addresses.addButton')}
          onPress={() => {
            setDraft(emptyDraft());
            setEditing('new');
          }}
        />
      ) : null}
    </Screen>
  );
}
