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

export function StocktakeForm() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [warehouseLocation, setWarehouseLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setSubmitting(true);
    try {
      const response = await apiClient.post('/stocktakes', {
        warehouseLocation: warehouseLocation.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      const created = response.data.data as { _id: string; reference: string };
      toast.success(t('stocktake.opened', { reference: created.reference }));
      navigate(`/inventory/stocktakes/${created._id}`);
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('stocktake.openFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <PageHeader
        routeId="stocktake-new"
        title={t('stocktake.openTitle')}
        description={t('stocktake.openSubtitle')}
        actions={<LinkButton to="/inventory/stocktakes">{t('stocktake.back')}</LinkButton>}
      />

      <Card className="max-w-xl">
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          {failure && <ErrorState message={failure.message} reference={failure.reference} />}

          <Field label={t('stocktake.location')} hint={t('stocktake.locationHint')}>
            <Input
              value={warehouseLocation}
              onChange={(event) => setWarehouseLocation(event.target.value)}
            />
          </Field>

          <Field label={t('stocktake.notes')}>
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" busy={submitting}>
              {t('stocktake.open')}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
