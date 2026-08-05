import { useState, type ReactNode } from 'react';
import type { Medicine, Shop, Supplier } from '@medsupply/shared-types';
import { SearchPicker } from './ui';
import { useApiCollection } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { useAuthStore } from '../store/useAuth';
import { canCreateShop, canEditCatalogue } from '../lib/permissions';
import { MedicineForm } from '../pages/MedicineForm';
import { ShopForm } from '../pages/ShopForm';
import { SupplierForm } from '../pages/SupplierForm';

/**
 * The pickers every form shares, each knowing its own query and its own rule.
 *
 * Two defects meet here.
 *
 * **The lists ended without saying so.** Suppliers stopped at fifty, price
 * lists at twenty-five, medicines and shops at a hundred, each a plain
 * `<select>` over one unpaged page. Past those counts a record simply could not
 * be chosen from any form that picks one, and nothing on the screen suggested
 * anything was missing — the same defect class as a truncated table with no
 * pager. These search the server instead.
 *
 * **Making the missing record meant leaving.** No form in this application
 * persists a draft or warns before discarding one, so going away to create a
 * supplier cost every line already typed on the purchase order. Each picker
 * hosts its creation form in a dialog.
 *
 * The create affordance is **absent**, never disabled, for anybody the server
 * would refuse. `canCreateShop` is the one to watch: a MANAGER reaches both
 * screens that pick a customer and `POST /shops` refuses them, so their picker
 * searches and does not offer.
 *
 * `onChoose` hands back the whole record rather than an id. A line editor with
 * five rows would otherwise need five extra requests just to render five names
 * it already had in its hands a moment earlier.
 *
 * **There is no warehouse picker here, deliberately.** The stocktake and
 * goods-receipt forms take a `warehouseLocation`, and the server matches it as
 * a *string* against `MedicineBatch.warehouseLocation` — it is not a reference
 * to the `Warehouse` model at all. A picker would send an id the server then
 * matched against nothing, producing a stocktake that silently covers zero
 * batches. Linking the two is a data change, not a UI one.
 */

/** Below this a search is more noise than help, and every catalogue matches. */
const MINIMUM_TERM = 2;

export interface PickerProps<T> {
  label: ReactNode;
  /** A stable id, so a validation notice can carry the reader to the control. */
  id?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  /** What is chosen now, if anything — the caller keeps the label it was given. */
  chosenLabel?: string;
  onChoose: (record: T) => void;
}

export function MedicinePicker({
  label,
  id,
  required,
  hint,
  error,
  chosenLabel,
  onChoose,
}: PickerProps<Medicine>) {
  const { t } = useLanguage();
  const [term, setTerm] = useState('');
  const mayCreate = canEditCatalogue(useAuthStore((state) => state.user?.role));

  const results = useApiCollection<Medicine>(
    keys.medicines.search(term),
    `/inventory/medicines?limit=25&search=${encodeURIComponent(term)}`,
    { enabled: term.trim().length >= MINIMUM_TERM },
  );
  const items = results.data?.items ?? [];
  const choose = (value: string) => {
    const found = items.find((medicine) => medicine._id === value);
    if (found) onChoose(found);
  };

  return (
    <SearchPicker
      label={label}
      id={id}
      required={required}
      hint={hint}
      error={error}
      placeholder={t('pickers.medicinePlaceholder')}
      term={term}
      onTermChange={setTerm}
      emptyLabel={t('catalogue.none')}
      options={items.map((medicine) => ({
        value: medicine._id,
        label: `${medicine.brandName} ${medicine.strength ?? ''}`.trim(),
        note: medicine.sku,
      }))}
      onChoose={choose}
      chosen={chosenLabel && t('pickers.chosen', { name: chosenLabel })}
      create={
        mayCreate
          ? {
              label: t('catalogue.addMedicine'),
              title: t('catalogue.addMedicine'),
              description: t('pickers.medicineCreated'),
              invalidates: keys.medicines.all,
              render: (done, cancel) => (
                <MedicineForm
                  onCreated={(medicine) => {
                    onChoose(medicine);
                    done(medicine._id);
                  }}
                  onCancel={cancel}
                />
              ),
            }
          : undefined
      }
    />
  );
}

export function SupplierPicker({
  label,
  id,
  required,
  hint,
  error,
  chosenLabel,
  onChoose,
}: PickerProps<Supplier>) {
  const { t } = useLanguage();
  const [term, setTerm] = useState('');
  const mayCreate = canEditCatalogue(useAuthStore((state) => state.user?.role));

  const results = useApiCollection<Supplier>(
    keys.purchasing.suppliers({ search: term }),
    `/purchasing/suppliers?limit=25&search=${encodeURIComponent(term)}`,
    { enabled: term.trim().length >= MINIMUM_TERM },
  );
  const items = results.data?.items ?? [];

  return (
    <SearchPicker
      label={label}
      id={id}
      required={required}
      hint={hint}
      error={error}
      placeholder={t('pickers.supplierPlaceholder')}
      term={term}
      onTermChange={setTerm}
      emptyLabel={t('purchasing.suppliersNone')}
      options={items.map((supplier) => ({
        value: supplier._id,
        label: supplier.name,
        note: supplier.reference,
      }))}
      onChoose={(value) => {
        const found = items.find((supplier) => supplier._id === value);
        if (found) onChoose(found);
      }}
      chosen={chosenLabel && t('pickers.chosen', { name: chosenLabel })}
      create={
        mayCreate
          ? {
              label: t('purchasing.newSupplierTitle'),
              title: t('purchasing.newSupplierTitle'),
              invalidates: keys.purchasing.all,
              render: (done, cancel) => (
                <SupplierForm
                  onCreated={(supplier) => {
                    onChoose(supplier);
                    done(supplier._id);
                  }}
                  onCancel={cancel}
                />
              ),
            }
          : undefined
      }
    />
  );
}

export function CustomerPicker({
  label,
  id,
  required,
  hint,
  error,
  chosenLabel,
  onChoose,
  /** `?status=ACTIVE` for a payment; every shop for order entry. */
  activeOnly = false,
}: PickerProps<Shop> & { activeOnly?: boolean }) {
  const { t } = useLanguage();
  const [term, setTerm] = useState('');
  const mayCreate = canCreateShop(useAuthStore((state) => state.user?.role));

  const scope = activeOnly ? 'status=ACTIVE&' : '';
  const results = useApiCollection<Shop>(
    keys.shops.picker({ search: term, activeOnly }),
    `/shops?${scope}limit=25&search=${encodeURIComponent(term)}`,
    { enabled: term.trim().length >= MINIMUM_TERM },
  );
  const items = results.data?.items ?? [];

  return (
    <SearchPicker
      label={label}
      id={id}
      required={required}
      hint={hint}
      error={error}
      placeholder={t('pickers.customerPlaceholder')}
      term={term}
      onTermChange={setTerm}
      emptyLabel={t('shops.none')}
      options={items.map((shop) => ({
        value: shop._id,
        label: shop.name,
        note: shop.reference,
      }))}
      onChoose={(value) => {
        const found = items.find((shop) => shop._id === value);
        if (found) onChoose(found);
      }}
      chosen={chosenLabel && t('pickers.chosen', { name: chosenLabel })}
      create={
        mayCreate
          ? {
              label: t('shops.add'),
              title: t('shops.addTitle'),
              invalidates: keys.shops.all,
              render: (done, cancel) => (
                <ShopForm
                  onCreated={(shop) => {
                    onChoose(shop);
                    done(shop._id);
                  }}
                  onCancel={cancel}
                />
              ),
            }
          : undefined
      }
    />
  );
}
