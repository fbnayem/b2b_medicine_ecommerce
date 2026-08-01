import { ReportGranularity as Granularity } from '@medsupply/shared-types';
import type { ReportRange } from '../pages/reportRange';

export function RangeControls({
  range,
  onExport,
  exporting,
}: {
  range: ReportRange;
  onExport?: () => void;
  exporting?: boolean;
}) {
  return (
    <form
      className="panel data-form finance-filters"
      onSubmit={(event) => {
        event.preventDefault();
        range.apply();
      }}
    >
      <div className="form-grid">
        <label>
          From
          <input
            required
            type="date"
            value={range.from}
            onChange={(event) => range.setFrom(event.target.value)}
          />
        </label>
        <label>
          To
          <input
            required
            type="date"
            min={range.from}
            value={range.to}
            onChange={(event) => range.setTo(event.target.value)}
          />
        </label>
        <label>
          Group by
          <select
            value={range.granularity}
            onChange={(event) => range.setGranularity(event.target.value as Granularity)}
          >
            <option value={Granularity.DAY}>Day</option>
            <option value={Granularity.WEEK}>Week</option>
            <option value={Granularity.MONTH}>Month</option>
          </select>
        </label>
      </div>
      <div className="actions">
        <button className="secondary-button">Run report</button>
        {onExport ? (
          <button type="button" className="link-button" disabled={exporting} onClick={onExport}>
            {exporting ? 'Preparing CSV...' : 'Export CSV'}
          </button>
        ) : null}
      </div>
    </form>
  );
}
