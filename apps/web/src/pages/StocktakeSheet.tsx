import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { StocktakeStatus } from '@medsupply/shared-types';
import type { Stocktake, StocktakeLine } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Input,
  LinkButton,
  PageHeader,
  Resource,
  requireReason,
  toast,
  useAsk,
  type Column,
} from '../components/ui';
import { useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { createActionKey, formatFinanceDate } from '../lib/finance';

/**
 * One count sheet, in whichever of its two shapes applies.
 *
 * **While counting**, the expected quantity is not on the page because it is
 * not in the payload — the server strips it. That is what makes this a blind
 * count rather than a screen that politely looks away: anybody can read a
 * network response, so hiding it in the layout would prove nothing.
 *
 * **At review**, the figures appear together with the difference, and every
 * line that differs needs an explanation before it can be posted.
 */

interface Draft {
  countedQuantity: string;
  varianceReason: string;
}

/** Whole units. A cleared field means "not counted", never zero. */
const units = (value: string) => {
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
};

export function StocktakeSheet() {
  const { id } = useParams();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const queryClient = useQueryClient();

  const query = useApiResource<Stocktake>(keys.stocktakes.one(id!), `/stocktakes/${id}`);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState('');

  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.stocktakes.all }),
      queryClient.invalidateQueries({ queryKey: keys.stock.all }),
      queryClient.invalidateQueries({ queryKey: keys.medicines.all }),
    ]);

  const draftFor = (line: StocktakeLine): Draft =>
    drafts[line._id] ?? {
      countedQuantity: line.countedQuantity === null ? '' : String(line.countedQuantity),
      varianceReason: line.varianceReason ?? '',
    };

  const patch = (line: StocktakeLine, next: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [line._id]: { ...draftFor(line), ...next } }));

  async function saveCounts(sheet: Stocktake) {
    const counts = sheet.lines
      .map((line) => ({ line, draft: draftFor(line) }))
      .filter(({ draft }) => units(draft.countedQuantity) !== null)
      .map(({ line, draft }) => ({
        lineId: line._id,
        countedQuantity: units(draft.countedQuantity) as number,
        varianceReason: draft.varianceReason || undefined,
      }));

    if (counts.length === 0) {
      toast.error(t('stocktake.nothingEntered'));
      return;
    }

    setBusy('counts');
    try {
      await apiClient.post(`/stocktakes/${sheet._id}/counts`, { version: sheet.version, counts });
      toast.success(t('stocktake.saved'));
      setDrafts({});
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('stocktake.saveFailed')));
    } finally {
      setBusy('');
    }
  }

  async function submitSheet(sheet: Stocktake) {
    setBusy('submit');
    try {
      await apiClient.post(`/stocktakes/${sheet._id}/submit`, { version: sheet.version });
      toast.success(t('stocktake.submitted'));
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('stocktake.submitFailed')));
    } finally {
      setBusy('');
    }
  }

  async function postSheet(sheet: Stocktake) {
    const unexplained = sheet.lines.filter(
      (line) =>
        line.countedQuantity !== null &&
        line.countedQuantity !== line.systemQuantity &&
        !line.varianceReason?.trim(),
    );
    if (unexplained.length > 0) {
      toast.error(t('stocktake.needReasons'));
      return;
    }

    const confirmed = await ask.confirm({
      title: t('stocktake.postTitle'),
      description: t('stocktake.postBody'),
      confirmLabel: t('stocktake.postConfirm'),
      danger: true,
    });
    if (!confirmed) return;

    setBusy('post');
    try {
      await apiClient.post(`/stocktakes/${sheet._id}/post`, {
        version: sheet.version,
        idempotencyKey: createActionKey('stocktake-post'),
      });
      toast.success(t('stocktake.posted'));
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('stocktake.postFailed')));
    } finally {
      setBusy('');
    }
  }

  async function abandonSheet(sheet: Stocktake) {
    const reason = await ask.prompt({
      title: t('stocktake.abandonTitle'),
      description: t('stocktake.abandonBody'),
      label: t('stocktake.abandonLabel'),
      multiline: true,
      confirmLabel: t('stocktake.abandonConfirm'),
      danger: true,
      validate: requireReason(t),
    });
    if (!reason) return;

    setBusy('abandon');
    try {
      await apiClient.post(`/stocktakes/${sheet._id}/abandon`, {
        version: sheet.version,
        reason,
      });
      toast.success(t('stocktake.abandoned'));
      await reload();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('stocktake.abandonFailed')));
    } finally {
      setBusy('');
    }
  }

  /** While counting: what is on the shelf, and nothing to compare it against. */
  function countingColumns(sheet: Stocktake): ReadonlyArray<Column<StocktakeLine>> {
    return [
      {
        key: 'medicine',
        header: t('fields.medicine'),
        cell: (line) => (
          <div>
            <p className="font-medium text-text">{line.snapshot.brandName}</p>
            <p className="text-sm text-text-muted">
              {line.snapshot.genericName} {line.snapshot.strength}
            </p>
          </div>
        ),
      },
      {
        key: 'batch',
        header: t('fields.batch'),
        // The number printed on the carton, which is what a counter matches on.
        cell: (line) => line.snapshot.batchNumber ?? '—',
      },
      {
        key: 'expiry',
        header: t('fields.expiry'),
        cell: (line) =>
          line.snapshot.expiryDate ? formatFinanceDate(line.snapshot.expiryDate) : '—',
      },
      {
        key: 'counted',
        header: t('stocktake.countedQuantity'),
        numeric: true,
        cell: (line) => (
          <Input
            aria-label={t('stocktake.countedFor', { brand: line.snapshot.brandName ?? '' })}
            inputMode="numeric"
            className="w-24 text-end tabular-nums"
            disabled={sheet.status !== StocktakeStatus.COUNTING}
            value={draftFor(line).countedQuantity}
            onChange={(event) => patch(line, { countedQuantity: event.target.value })}
          />
        ),
      },
      {
        key: 'reason',
        header: t('stocktake.reason'),
        cell: (line) => (
          <Input
            aria-label={t('stocktake.reasonFor', { brand: line.snapshot.brandName ?? '' })}
            disabled={sheet.status !== StocktakeStatus.COUNTING}
            value={draftFor(line).varianceReason}
            onChange={(event) => patch(line, { varianceReason: event.target.value })}
          />
        ),
      },
    ];
  }

  /** At review: both figures, the difference, and the explanation given. */
  const reviewColumns: ReadonlyArray<Column<StocktakeLine>> = [
    {
      key: 'medicine',
      header: t('fields.medicine'),
      cell: (line) => (
        <div>
          <p className="font-medium text-text">{line.snapshot.brandName}</p>
          <p className="text-sm text-text-muted">{line.snapshot.batchNumber}</p>
        </div>
      ),
    },
    {
      key: 'expected',
      header: t('stocktake.expected'),
      numeric: true,
      cell: (line) => line.systemQuantity ?? '—',
    },
    {
      key: 'counted',
      header: t('stocktake.counted'),
      numeric: true,
      cell: (line) =>
        line.countedQuantity === null ? (
          <span className="text-text-muted">{t('stocktake.notCounted')}</span>
        ) : (
          line.countedQuantity
        ),
    },
    {
      key: 'difference',
      header: t('stocktake.difference'),
      numeric: true,
      cell: (line) => {
        if (line.countedQuantity === null || line.systemQuantity === undefined) return '—';
        const difference = line.countedQuantity - line.systemQuantity;
        if (difference === 0) return 0;
        return (
          <span className={difference < 0 ? 'font-medium text-danger' : 'font-medium text-warning'}>
            {difference > 0 ? '+' : ''}
            {difference}
          </span>
        );
      },
    },
    { key: 'reason', header: t('stocktake.reason'), cell: (line) => line.varianceReason || '—' },
  ];

  return (
    <>
      <PageHeader
        routeId="stocktake-detail"
        title={t('stocktake.title')}
        actions={<LinkButton to="/inventory/stocktakes">{t('stocktake.back')}</LinkButton>}
      />

      <Resource
        query={query}
        loadingLabel={t('stocktake.sheetLoading')}
        errorMessageFallback={t('stocktake.sheetCouldNotLoad')}
      >
        {(sheet) => {
          const counting = sheet.status === StocktakeStatus.COUNTING;
          const reviewing = sheet.status === StocktakeStatus.REVIEW;
          const closed =
            sheet.status === StocktakeStatus.POSTED || sheet.status === StocktakeStatus.ABANDONED;

          return (
            <>
              <Card className="mb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xl font-semibold text-text">{sheet.reference}</p>
                    <p className="text-text-muted">
                      {sheet.scope?.warehouseLocation || '—'} · {t('stocktake.openedOn')}{' '}
                      {formatFinanceDate(sheet.openedAt)}
                    </p>
                  </div>
                  <Badge tone={counting ? 'info' : reviewing ? 'warning' : 'success'}>
                    {t(`stocktakeStatus.${sheet.status}`)}
                  </Badge>
                </div>

                {sheet.abandonedReason && (
                  <p className="mt-2 text-text">
                    {t('stocktake.abandonedBecause', { reason: sheet.abandonedReason })}
                  </p>
                )}

                {sheet.summary && (
                  <dl className="mt-4 grid gap-3 sm:grid-cols-4">
                    <Metric
                      label={t('stocktake.progress')}
                      value={t('stocktake.ofLines', {
                        counted: sheet.summary.linesCounted,
                        total: sheet.summary.linesTotal,
                      })}
                    />
                    <Metric
                      label={t('stocktake.uncounted')}
                      value={sheet.summary.linesUncounted}
                      tone={sheet.summary.linesUncounted > 0 ? 'warning' : 'normal'}
                    />
                    <Metric
                      label={t('stocktake.short')}
                      value={sheet.summary.unitsShort}
                      tone={sheet.summary.unitsShort > 0 ? 'warning' : 'normal'}
                    />
                    <Metric label={t('stocktake.over')} value={sheet.summary.unitsOver} />
                  </dl>
                )}
              </Card>

              {counting && (
                <Card className="mb-4">
                  {/*
                   * Said plainly rather than left for somebody to work out. A
                   * counter who thinks the figure is missing by accident will
                   * go and look it up, which defeats the whole exercise.
                   */}
                  <p className="text-text">{t('stocktake.blindNotice')}</p>
                </Card>
              )}

              <Card className="mb-4">
                <DataTable
                  caption={t('stocktake.title')}
                  columns={counting ? countingColumns(sheet) : reviewColumns}
                  rows={sheet.lines}
                  rowKey={(line) => line._id}
                  rowTest={(line) => line.snapshot.batchNumber ?? line._id}
                />
                {reviewing && <p className="mt-2 text-text-muted">{t('stocktake.reviewBody')}</p>}
              </Card>

              {!closed && (
                <div className="flex flex-wrap justify-end gap-2">
                  {counting && (
                    <>
                      <Button busy={busy === 'counts'} onClick={() => void saveCounts(sheet)}>
                        {t('stocktake.saveCounts')}
                      </Button>
                      <Button
                        variant="primary"
                        busy={busy === 'submit'}
                        onClick={() => void submitSheet(sheet)}
                      >
                        {t('stocktake.finishCounting')}
                      </Button>
                    </>
                  )}
                  {reviewing && (
                    <Button
                      variant="primary"
                      busy={busy === 'post'}
                      onClick={() => void postSheet(sheet)}
                    >
                      {t('stocktake.postCount')}
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    busy={busy === 'abandon'}
                    onClick={() => void abandonSheet(sheet)}
                  >
                    {t('stocktake.abandon')}
                  </Button>
                </div>
              )}
            </>
          );
        }}
      </Resource>
    </>
  );
}

function Metric({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string | number;
  tone?: 'normal' | 'warning';
}) {
  return (
    <div>
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd
        className={`text-2xl font-semibold tabular-nums ${
          tone === 'warning' ? 'text-warning' : 'text-text'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
