import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import { saveCreditNote } from '../../src/documents/files';
import { useSaveDocument } from '../../src/documents/useSaveDocument';
import { formatFinanceDate } from '../../src/finance/date';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { formatMoneyMinor } from '../../src/finance/money';
import {
  availableActions,
  dispositionProblem,
  getReturn,
  returnAction,
  type ReturnDetailView,
  type ReturnLineView,
  type ReturnStep,
} from '../../src/returns/api';
import { useAuthStore } from '../../src/store/useAuth';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  ListRow,
  LoadingState,
  SectionTitle,
  StatusPill,
  requireReason,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

type Field4 = 'restock' | 'damaged' | 'expired' | 'quarantined';
type Draft = Record<string, Record<Field4, string>>;

const EMPTY: Record<Field4, string> = {
  restock: '0',
  damaged: '0',
  expired: '0',
  quarantined: '0',
};

/** Label key per disposition, so all four read the same as on the web screen. */
const DISPOSITION_KEY: Record<Field4, string> = {
  restock: 'returnDetail.restock',
  damaged: 'returnDetail.damagedColumn',
  expired: 'returnDetail.expiredColumn',
  quarantined: 'returnDetail.quarantineColumn',
};

const lineKey = (line: ReturnLineView) => `${line.medicineId}:${line.batchId}`;
const count = (value: string) => Math.max(0, Math.trunc(Number(value) || 0));

export default function ReturnDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const ask = useAsk();
  const role = useAuthStore((state) => state.user?.role);
  const document = useSaveDocument();

  const [record, setRecord] = useState<ReturnDetailView | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // One key per action per return, so a retry after a dropped response replays
  // rather than applying the action twice.
  const actionKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getReturn(id);
      setRecord(data);
      setDraft(
        Object.fromEntries(
          data.lines.map((line) => [
            lineKey(line),
            {
              restock: String(
                line.restockQuantity || (line.receivedQuantity ? 0 : line.approvedQuantity),
              ),
              damaged: String(line.damagedQuantity || 0),
              expired: String(line.expiredQuantity || 0),
              quarantined: String(line.quarantinedQuantity || 0),
            },
          ]),
        ),
      );
      setError('');
    } catch (caught) {
      setError(errorMessage(caught, language, t('returnDetail.couldNotLoad')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: ReturnStep, body: Record<string, unknown>, message: string) {
    if (!record || busy) return;
    const mapKey = `${record._id}:${action}`;
    let key = actionKeys.current.get(mapKey);
    if (!key) {
      key = createFinancialIdempotencyKey(`return-${action}`, record._id);
      actionKeys.current.set(mapKey, key);
    }
    setBusy(action);
    try {
      await returnAction(record._id, action, {
        version: record.version,
        idempotencyKey: key,
        ...body,
      });
      actionKeys.current.delete(mapKey);
      toast.success(message);
      setError('');
      await load();
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('returnDetail.actionFailed')));
    } finally {
      setBusy('');
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.canvas }}>
        <LoadingState label={t('returnDetail.loading')} />
      </View>
    );
  }

  if (!record) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.canvas, padding: layout.space[4] }}>
        <ErrorState message={error || t('returnDetail.couldNotLoad')} onRetry={() => void load()} />
      </View>
    );
  }

  const actions = availableActions(role, record.status);
  const receivableLines = record.lines.filter((line) => line.approvedQuantity > 0);
  const problem = receivableLines
    .map((line) => {
      const entry = draft[lineKey(line)];
      if (!entry) return null;
      return dispositionProblem(line, {
        restockQuantity: count(entry.restock),
        damagedQuantity: count(entry.damaged),
        expiredQuantity: count(entry.expired),
        quarantinedQuantity: count(entry.quarantined),
      });
    })
    .find(Boolean);

  /** Refusing a return is a decision the shop is told about, so it takes a reason. */
  async function refuse() {
    const reason = await ask.prompt({
      title: t('returnDetail.rejectReturn'),
      description: t('returnDetail.reviewBody'),
      label: t('returnDetail.rejectionLabel'),
      multiline: true,
      confirmLabel: t('returnDetail.rejectReturn'),
      danger: true,
      validate: requireReason(t),
    });
    if (!reason) return;
    await act('reject', { rejectionReason: reason }, t('returnDetail.rejected'));
  }

  async function issueCreditNote() {
    if (!record) return;
    const confirmed = await ask.confirm({
      title: t('returnDetail.confirmCreditTitle', {
        amount: formatMoneyMinor(record.approvedTotalMinor),
      }),
      description: t('returnDetail.confirmCreditBody'),
      confirmLabel: t('returnDetail.issueCreditNote'),
      danger: true,
    });
    if (!confirmed) return;
    await act('credit-note', {}, t('returnDetail.creditIssued'));
  }

  async function cancelReturn() {
    const reason = await ask.prompt({
      title: t('returnDetail.cancelTitle'),
      description: t('returnDetail.cancelBody'),
      label: t('actions.reason'),
      multiline: true,
      confirmLabel: t('returnDetail.cancelConfirm'),
      danger: true,
      validate: requireReason(t),
    });
    if (!reason) return;
    await act('cancel', { reason }, t('returnDetail.cancelled'));
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colour.canvas }}
      contentContainerStyle={{
        padding: layout.space[4],
        gap: layout.space[3],
        paddingBottom: layout.space[10],
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    >
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Card>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: layout.space[2],
          }}
        >
          <SectionTitle>{record.reference}</SectionTitle>
          {/* Was `returnStatusLabel()` — a third set of status words, English
              in both languages, disagreeing with the list screen's. */}
          <StatusPill kind="return" status={record.status} />
        </View>
        <Text
          style={{
            fontSize: layout.fontSize['2xl'],
            fontWeight: '700',
            color: colour.text,
            fontVariant: ['tabular-nums'],
          }}
        >
          {formatMoneyMinor(record.approvedTotalMinor || record.requestedTotalMinor)}
        </Text>
        <ListRow
          label={t('returns.columnRequested')}
          value={formatFinanceDate(record.requestedAt)}
        />
        <ListRow
          label={t('returnDetail.mainReason')}
          value={t(`returnReason.${record.primaryReason}`)}
        />
        {record.creditNoteReference ? (
          <ListRow label={t('returnDetail.creditNote')} value={record.creditNoteReference} />
        ) : null}
        {record.rejectionReason ? (
          <ListRow label={t('returnDetail.rejectionReason')} value={record.rejectionReason} />
        ) : null}
      </Card>

      {/*
        The credit note itself.

        The reference above has been shown since the returns phase, and it is
        the *document* that proves the money came back — the thing a pharmacy
        reconciles against and hands to whoever keeps the books. Until now this
        client could name it and not fetch it.
      */}
      {record.creditNote ? (
        <Button
          variant="secondary"
          busy={document.busy}
          label={document.busy ? t('documents.preparing') : t('documents.saveCreditNote')}
          onPress={() =>
            void document.save(() =>
              saveCreditNote(
                record.creditNote!._id,
                record.creditNote!.reference,
                t('documents.creditNoteTitle', { reference: record.creditNote!.reference }),
              ),
            )
          }
        />
      ) : null}

      <SectionTitle>{t('returnDetail.items')}</SectionTitle>
      {record.lines.map((line) => (
        <Card key={lineKey(line)}>
          <Text style={{ fontSize: layout.fontSize.base, fontWeight: '600', color: colour.text }}>
            {line.medicineSnapshot.brandName}
          </Text>
          <ListRow label={t('fields.batch')} value={line.batchNumber} />
          <ListRow label={t('fields.expiry')} value={formatFinanceDate(line.expiryDate)} />
          <ListRow
            label={t('returnDetail.columnRequested')}
            value={line.requestedQuantity}
            numeric
          />
          <ListRow label={t('returnDetail.columnApproved')} value={line.approvedQuantity} numeric />
          <ListRow label={t('returnDetail.columnReceived')} value={line.receivedQuantity} numeric />
          <ListRow
            label={t('returnDetail.columnCredit')}
            value={formatMoneyMinor(line.refundMinor)}
            numeric
          />
        </Card>
      ))}

      {actions.includes('approve') ? (
        <Card>
          <SectionTitle>{t('returnDetail.reviewTitle')}</SectionTitle>
          <Text style={{ color: colour.textMuted }}>{t('returnDetail.mobileApprovesInFull')}</Text>
          <Button
            label={t('returnDetail.saveDecision')}
            busy={busy === 'decision'}
            disabled={busy !== ''}
            onPress={() =>
              void act(
                'decision',
                {
                  lines: record.lines.map((line) => ({
                    medicineId: line.medicineId,
                    batchId: line.batchId,
                    approvedQuantity: line.requestedQuantity,
                  })),
                },
                t('returnDetail.decisionSaved'),
              )
            }
          />
          <Button
            variant="danger"
            label={t('returnDetail.rejectReturn')}
            busy={busy === 'reject'}
            disabled={busy !== ''}
            onPress={() => void refuse()}
          />
        </Card>
      ) : null}

      {actions.includes('receive') ? (
        <Card>
          <SectionTitle>{t('returnDetail.receiveTitle')}</SectionTitle>
          <Text style={{ color: colour.textMuted }}>{t('returnDetail.receiveBody')}</Text>

          {receivableLines.map((line) => {
            const key = lineKey(line);
            const entry = draft[key] ?? EMPTY;
            return (
              <View key={`receive-${key}`} style={{ gap: layout.space[2] }}>
                <Text style={{ fontWeight: '600', color: colour.text }}>
                  {line.medicineSnapshot.brandName}
                </Text>
                <ListRow
                  label={t('returnDetail.columnApproved')}
                  value={line.approvedQuantity}
                  numeric
                />
                {(Object.keys(DISPOSITION_KEY) as Field4[]).map((field) => (
                  <Field
                    key={field}
                    label={t('returnDetail.dispositionFor', {
                      field: t(DISPOSITION_KEY[field]),
                      brand: line.medicineSnapshot.brandName,
                    })}
                  >
                    <Input
                      label={t('returnDetail.dispositionFor', {
                        field: t(DISPOSITION_KEY[field]),
                        brand: line.medicineSnapshot.brandName,
                      })}
                      keyboardType="number-pad"
                      value={entry[field]}
                      onChangeText={(value) =>
                        setDraft((current) => ({
                          ...current,
                          [key]: { ...entry, [field]: value },
                        }))
                      }
                    />
                  </Field>
                ))}
              </View>
            );
          })}

          {problem ? <ErrorState message={t(problem.key, problem.values)} /> : null}

          <Button
            label={t('returnDetail.confirmReceipt')}
            busy={busy === 'receive'}
            disabled={busy !== '' || Boolean(problem)}
            onPress={() =>
              void act(
                'receive',
                {
                  lines: receivableLines.map((line) => {
                    const entry = draft[lineKey(line)] ?? EMPTY;
                    return {
                      medicineId: line.medicineId,
                      batchId: line.batchId,
                      restockQuantity: count(entry.restock),
                      damagedQuantity: count(entry.damaged),
                      expiredQuantity: count(entry.expired),
                      quarantinedQuantity: count(entry.quarantined),
                    };
                  }),
                },
                t('returnDetail.receivedDone'),
              )
            }
          />
        </Card>
      ) : null}

      <Card>
        <SectionTitle>{t('returnDetail.actions')}</SectionTitle>
        {actions.includes('review') ? (
          <Button
            variant="secondary"
            label={t('returnDetail.startReview')}
            busy={busy === 'review'}
            disabled={busy !== ''}
            onPress={() => void act('review', {}, t('returnDetail.claimed'))}
          />
        ) : null}
        {actions.includes('collect') ? (
          <Button
            label={t('returnDetail.markCollected')}
            busy={busy === 'collect'}
            disabled={busy !== ''}
            onPress={() => void act('collect', {}, t('returnDetail.collectedDone'))}
          />
        ) : null}
        {actions.includes('credit-note') ? (
          <Button
            label={t('returnDetail.issueCreditNote')}
            busy={busy === 'credit-note'}
            disabled={busy !== ''}
            onPress={() => void issueCreditNote()}
          />
        ) : null}
        {actions.includes('cancel') ? (
          <Button
            variant="danger"
            label={t('returnDetail.cancelReturn')}
            busy={busy === 'cancel'}
            disabled={busy !== ''}
            onPress={() => void cancelReturn()}
          />
        ) : null}
        {actions.length === 0 ? (
          <Text style={{ color: colour.textMuted }}>{t('returnDetail.noActions')}</Text>
        ) : null}
      </Card>
    </ScrollView>
  );
}
