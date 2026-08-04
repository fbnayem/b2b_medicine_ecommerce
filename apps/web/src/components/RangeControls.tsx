import { ReportGranularity as Granularity } from '@medsupply/shared-types';
import { Button, Field, Input, Select } from './ui';
import { useLanguage } from '../lib/useLanguage';
import type { ReportRange } from '../pages/reportRange';

/**
 * The date range every report shares.
 *
 * One component rather than five copies, which is why the granularity words
 * and the export button read the same on every report screen.
 */
export function RangeControls({
  range,
  onExport,
  exporting,
}: {
  range: ReportRange;
  onExport?: () => void;
  exporting?: boolean;
}) {
  const { t } = useLanguage();

  return (
    <form
      className="mb-4 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        range.apply();
      }}
    >
      <Field label={t('finance.from')} className="min-w-44">
        <Input
          required
          type="date"
          value={range.from}
          onChange={(event) => range.setFrom(event.target.value)}
        />
      </Field>
      <Field label={t('finance.to')} className="min-w-44">
        <Input
          required
          type="date"
          min={range.from}
          value={range.to}
          onChange={(event) => range.setTo(event.target.value)}
        />
      </Field>
      <Field label={t('reports.groupBy')} className="min-w-40">
        <Select
          value={range.granularity}
          onChange={(event) => range.setGranularity(event.target.value as Granularity)}
        >
          <option value={Granularity.DAY}>{t('reports.day')}</option>
          <option value={Granularity.WEEK}>{t('reports.week')}</option>
          <option value={Granularity.MONTH}>{t('reports.month')}</option>
        </Select>
      </Field>
      <Button type="submit">{t('actions.apply')}</Button>
      {onExport && (
        <Button busy={exporting} onClick={onExport}>
          {exporting ? t('reports.preparingCsv') : t('finance.exportCsv')}
        </Button>
      )}
    </form>
  );
}
