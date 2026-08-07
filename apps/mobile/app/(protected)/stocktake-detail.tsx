import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { Stocktake, StocktakeLine } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { formatFinanceDate } from '../../src/finance/date';
import {
  abandonStocktake,
  countProblem,
  getStocktake,
  postStocktake,
  progress,
  showsExpected,
  submitStocktake,
} from '../../src/warehouse/stocktakes';
import {
  dropCountsFor,
  pendingFor,
  queueCount,
  syncCountQueue,
} from '../../src/warehouse/countQueue';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  StatusPill,
  requireReason,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * One count sheet, counted from the aisle.
 *
 * ## Blind while it is open
 *
 * The server strips `systemQuantity` from every line until the sheet leaves
 * `COUNTING`, because a blind count that ships the answer in the response is
 * not blind whatever the screen chooses to draw. This screen agrees with that
 * rather than enforcing it — and, more usefully, **never keeps an expected
 * figure it saw earlier in state**, which is the way a screen quietly
 * un-blinds a count that the server correctly protected.
 *
 * ## Every count goes to the queue
 *
 * Not to the network. A warehouse aisle between steel racking has worse
 * reception than the lane a rider is in, and the cost of losing the work is an
 * hour rather than one tap repeated. Each line is its own queued action with
 * its own idempotency key, so a refusal loses one count and not the rack.
 *
 * ## Zero is a real answer
 *
 * "There are none there" is exactly the finding a physical count exists to
 * make. An empty field and a nought are different things and only the first is
 * a problem — which is why `countedQuantity` is `null` until counted.
 */
export default function StocktakeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const [sheet, setSheet] = useState<Stocktake>();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      // The queue first: a count sent now is a count the sheet comes back
      // holding, and the other order shows a line as uncounted a second before
      // it corrects itself.
      await syncCountQueue();
      setSheet(await getStocktake(id));
      setWaiting(await pendingFor(id));
    } catch (caught) {
      setError(errorMessage(caught, language, t('stocktake.sheetCouldNotLoad')));
    } finally {
      setRefreshing(false);
    }
  }, [id, language, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function count(line: StocktakeLine) {
    if (!sheet) return;
    const entered = typed[line._id] ?? '';
    const problem = countProblem(entered);
    if (problem) {
      toast.error(t(problem));
      return;
    }

    try {
      await queueCount(sheet._id, sheet.version, {
        lineId: line._id,
        countedQuantity: Number(entered.trim()),
      });
      /*
       * Cleared and marked immediately. A storekeeper counting a rack moves to
       * the next shelf before the network has answered, and a field that keeps
       * its digits until a response arrives gets the next count typed after
       * them.
       */
      setTyped((current) => ({ ...current, [line._id]: '' }));
      setWaiting((current) => current + 1);
      await syncCountQueue();
      setWaiting(await pendingFor(sheet._id));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('stocktake.countFailed')));
    }
  }

  async function act(action: 'submit' | 'post' | 'abandon') {
    if (!sheet) return;
    setBusy(action);
    try {
      if (action === 'submit') {
        // Everything held has to reach the server before the sheet stops
        // accepting counts, or an hour of work is refused one line at a time.
        const flushed = await syncCountQueue();
        if (flushed.remaining.length > 0) {
          toast.error(t('stocktake.stillWaiting', { count: flushed.remaining.length }));
          setWaiting(flushed.remaining.length);
          return;
        }
        setSheet(await submitStocktake(sheet._id, sheet.version));
        toast.success(t('stocktake.submitted'));
      } else if (action === 'post') {
        const confirmed = await ask.confirm({
          title: t('stocktake.postTitle'),
          description: t('stocktake.postBody'),
          confirmLabel: t('stocktake.postConfirm'),
          danger: true,
        });
        if (!confirmed) return;
        setSheet(
          await postStocktake(
            sheet._id,
            sheet.version,
            // Posting a count writes a stock movement for every line that
            // differs. A retry after a timeout must not write them twice.
            createFinancialIdempotencyKey('stocktake-post', sheet._id),
          ),
        );
        toast.success(t('stocktake.posted'));
      } else {
        const reason = await ask.prompt({
          title: t('stocktake.abandonTitle'),
          description: t('stocktake.abandonBody'),
          label: t('stocktake.abandonLabel'),
          confirmLabel: t('stocktake.abandonConfirm'),
          multiline: true,
          danger: true,
          // Abandoning a count throws away an hour of somebody's work, and the
          // record has to say why to whoever reads it next week.
          validate: requireReason(t),
        });
        if (reason === null) return;
        setSheet(await abandonStocktake(sheet._id, sheet.version, reason));
        // The counts held for a sheet that no longer accepts them would be a
        // permanent row of failures on every later flush.
        await dropCountsFor(sheet._id);
        setWaiting(0);
        toast.success(t('stocktake.abandoned'));
      }
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('stocktake.actionFailed')));
    } finally {
      setBusy('');
    }
  }

  if (!sheet) {
    return (
      <Screen>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <LoadingState label={t('stocktake.sheetLoading')} />
        )}
      </Screen>
    );
  }

  const counting = sheet.status === 'COUNTING';
  const expected = showsExpected(sheet);
  const done = progress(sheet.lines);

  return (
    <Screen scroll={false}>
      <View style={{ gap: layout.space[2] }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: layout.space[2],
          }}
        >
          <Text style={{ color: colour.brand, fontWeight: '600', fontSize: layout.fontSize.lg }}>
            {sheet.reference}
          </Text>
          <StatusPill kind="stocktake" status={sheet.status} />
        </View>

        <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
          {t('stocktake.ofLines', { counted: done.counted, total: done.total })}
          {sheet.scope.warehouseLocation ? ` · ${sheet.scope.warehouseLocation}` : ''}
        </Text>

        {/*
          What is held on this handset and not yet on the server. Said out loud
          because a storekeeper who walks away from a dead spot needs to know
          there is work still to send — the alternative is finding out when the
          sheet refuses to submit.
        */}
        {waiting > 0 ? (
          <View style={{ alignItems: 'flex-start' }}>
            <Badge tone="warning">{t('stocktake.heldOnThisPhone', { count: waiting })}</Badge>
          </View>
        ) : null}

        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      </View>

      <FlatList
        data={sheet.lines}
        keyExtractor={(line) => line._id}
        contentContainerStyle={{ gap: layout.space[3], paddingBottom: layout.space[6] }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        renderItem={({ item }) => (
          <Card>
            <Text style={{ color: colour.text, fontWeight: '600' }}>
              {item.snapshot.brandName} {item.snapshot.strength ?? ''}
            </Text>
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {t('stocktake.batchAndPlace', {
                batch: item.snapshot.batchNumber ?? '—',
                place: item.snapshot.warehouseLocation ?? '—',
              })}
            </Text>
            {item.snapshot.expiryDate ? (
              <ListRow
                label={t('fields.expiry')}
                value={formatFinanceDate(item.snapshot.expiryDate)}
              />
            ) : null}

            {counting ? (
              <>
                <Field
                  label={t('stocktake.countedFor', { brand: item.snapshot.brandName ?? '' })}
                  hint={
                    item.countedQuantity === null
                      ? t('stocktake.notCountedYet')
                      : t('stocktake.alreadyCounted', { count: item.countedQuantity })
                  }
                >
                  <Input
                    label={t('stocktake.countedFor', { brand: item.snapshot.brandName ?? '' })}
                    keyboardType="number-pad"
                    value={typed[item._id] ?? ''}
                    onChangeText={(value) =>
                      setTyped((current) => ({
                        ...current,
                        [item._id]: value.replace(/[^0-9]/g, ''),
                      }))
                    }
                  />
                </Field>
                <Button
                  variant="secondary"
                  label={t('stocktake.recordCount')}
                  accessibilityLabel={t('stocktake.recordCountFor', {
                    brand: item.snapshot.brandName ?? '',
                  })}
                  onPress={() => void count(item)}
                />
              </>
            ) : (
              <>
                <ListRow
                  label={t('stocktake.counted')}
                  value={item.countedQuantity ?? t('stocktake.notCounted')}
                  numeric
                />
                {/*
                  Only once the sheet has left `COUNTING`. The server does not
                  send `systemQuantity` before then; rendering whatever it
                  happens to hold would be a blind count with the answer on it.
                */}
                {expected ? (
                  <ListRow
                    label={t('stocktake.expected')}
                    value={item.systemQuantity ?? '—'}
                    numeric
                  />
                ) : null}
                {item.varianceReason ? (
                  <ListRow label={t('stocktake.reason')} value={item.varianceReason} />
                ) : null}
              </>
            )}
          </Card>
        )}
      />

      <View style={{ gap: layout.space[2], paddingTop: layout.space[2] }}>
        {counting ? (
          <>
            <Button
              busy={busy === 'submit'}
              disabled={done.counted === 0}
              label={t('stocktake.finishCounting')}
              onPress={() => void act('submit')}
            />
            <Button
              variant="secondary"
              busy={busy === 'abandon'}
              label={t('stocktake.abandon')}
              onPress={() => void act('abandon')}
            />
          </>
        ) : null}

        {sheet.status === 'REVIEW' ? (
          <>
            {sheet.summary ? (
              <Card>
                <SectionTitle>{t('stocktake.reviewTitle')}</SectionTitle>
                <ListRow
                  label={t('stocktake.differing')}
                  value={sheet.summary.linesDiffering}
                  numeric
                />
                <ListRow label={t('stocktake.over')} value={sheet.summary.unitsOver} numeric />
                <ListRow label={t('stocktake.short')} value={sheet.summary.unitsShort} numeric />
              </Card>
            ) : null}
            <Button
              busy={busy === 'post'}
              label={t('stocktake.postCount')}
              onPress={() => void act('post')}
            />
            <Button
              variant="secondary"
              busy={busy === 'abandon'}
              label={t('stocktake.abandon')}
              onPress={() => void act('abandon')}
            />
          </>
        ) : null}

        {sheet.status === 'POSTED' || sheet.status === 'ABANDONED' ? (
          <Button
            variant="secondary"
            label={t('stocktake.back')}
            onPress={() => router.replace('/(protected)/stocktakes')}
          />
        ) : null}
      </View>
    </Screen>
  );
}
