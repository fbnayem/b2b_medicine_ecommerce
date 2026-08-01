import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { UserRole } from '@medsupply/shared-types';
import { FinanceState } from '../../src/finance/components';
import { apiErrorMessage } from '../../src/finance/api';
import { formatFinanceDate } from '../../src/finance/date';
import { createFinancialIdempotencyKey } from '../../src/finance/idempotency';
import { formatMoneyMinor } from '../../src/finance/money';
import {
  availableActions,
  dispositionProblem,
  getReturn,
  returnAction,
  returnStatusLabel,
  type ReturnDetailView,
  type ReturnLineView,
} from '../../src/returns/api';
import { useAuthStore } from '../../src/store/useAuth';

type Draft = Record<
  string,
  { restock: string; damaged: string; expired: string; quarantined: string }
>;

const lineKey = (line: ReturnLineView) => `${line.medicineId}:${line.batchId}`;
const count = (value: string) => Math.max(0, Math.trunc(Number(value) || 0));

export default function ReturnDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useAuthStore((state) => state.user?.role);
  const [record, setRecord] = useState<ReturnDetailView | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [rejection, setRejection] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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
      setError(apiErrorMessage(caught, 'Unable to load this return.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: string, body: Record<string, unknown>, message: string) {
    if (!record) return;
    const mapKey = `${record._id}:${action}`;
    let key = actionKeys.current.get(mapKey);
    if (!key) {
      key = createFinancialIdempotencyKey(`return-${action}`, record._id);
      actionKeys.current.set(mapKey, key);
    }
    setBusy(action);
    setSuccess('');
    try {
      await returnAction(record._id, action as never, {
        version: record.version,
        idempotencyKey: key,
        ...body,
      });
      actionKeys.current.delete(mapKey);
      setSuccess(message);
      setError('');
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught, 'That action could not be completed.'));
    } finally {
      setBusy('');
    }
  }

  if (loading) return <FinanceState loading />;
  if (!record)
    return <FinanceState error={error || 'Return not found.'} onRetry={() => void load()} />;

  const actions = availableActions(role, record.status);
  const receivableLines = record.lines.filter((line) => line.approvedQuantity > 0);
  const receiptProblem = receivableLines
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

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
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
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.reference}>{record.reference}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{returnStatusLabel(record.status)}</Text>
          </View>
        </View>
        <Text style={styles.amount}>
          {formatMoneyMinor(record.approvedTotalMinor || record.requestedTotalMinor)}
        </Text>
        <Text style={styles.muted}>
          Requested {formatFinanceDate(record.requestedAt)} ·{' '}
          {record.primaryReason.replaceAll('_', ' ').toLowerCase()}
        </Text>
        {record.creditNoteReference ? (
          <Text style={styles.credit}>Credit note {record.creditNoteReference}</Text>
        ) : null}
        {record.rejectionReason ? (
          <Text style={styles.reject}>{record.rejectionReason}</Text>
        ) : null}
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.heading}>Items</Text>
        {record.lines.map((line) => (
          <View key={lineKey(line)} style={styles.line}>
            <Text style={styles.lineTitle}>{line.medicineSnapshot.brandName}</Text>
            <Text style={styles.muted}>
              Batch {line.batchNumber} · expires {formatFinanceDate(line.expiryDate)}
            </Text>
            <Text>
              Requested {line.requestedQuantity} · approved {line.approvedQuantity} · received{' '}
              {line.receivedQuantity}
            </Text>
            <Text style={styles.muted}>Credit {formatMoneyMinor(line.refundMinor)}</Text>
          </View>
        ))}
      </View>

      {actions.includes('approve') ? (
        <View style={styles.card}>
          <Text style={styles.heading}>Review</Text>
          <Text style={styles.muted}>
            Approving on mobile accepts every requested unit. Use the web application to approve
            partial quantities.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(busy)}
            style={styles.action}
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
                'Return approved in full.',
              )
            }
          >
            <Text style={styles.actionText}>
              {busy === 'decision' ? 'Saving…' : 'Approve in full'}
            </Text>
          </Pressable>
          {/* A typed reason works on both platforms; Alert.prompt is iOS only. */}
          <Text style={styles.inputLabel}>Reason, if rejecting</Text>
          <TextInput
            accessibilityLabel="Rejection reason"
            style={styles.input}
            multiline
            value={rejection}
            onChangeText={setRejection}
            placeholder="At least five characters"
          />
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(busy) || rejection.trim().length < 5}
            style={[styles.danger, rejection.trim().length < 5 ? styles.disabled : null]}
            onPress={() =>
              void act('reject', { rejectionReason: rejection.trim() }, 'Return rejected.')
            }
          >
            <Text style={styles.actionText}>
              {busy === 'reject' ? 'Rejecting…' : 'Reject return'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {actions.includes('receive') ? (
        <View style={styles.card}>
          <Text style={styles.heading}>Receive and inspect</Text>
          {receivableLines.map((line) => {
            const key = lineKey(line);
            const entry = draft[key] ?? {
              restock: '0',
              damaged: '0',
              expired: '0',
              quarantined: '0',
            };
            return (
              <View key={`receive-${key}`} style={styles.line}>
                <Text style={styles.lineTitle}>{line.medicineSnapshot.brandName}</Text>
                <Text style={styles.muted}>Approved {line.approvedQuantity}</Text>
                <View style={styles.inputRow}>
                  {(
                    [
                      ['restock', 'Restock'],
                      ['damaged', 'Damaged'],
                      ['expired', 'Expired'],
                      ['quarantined', 'Quarantine'],
                    ] as const
                  ).map(([field, label]) => (
                    <View key={field} style={styles.inputCell}>
                      <Text style={styles.inputLabel}>{label}</Text>
                      <TextInput
                        accessibilityLabel={`${label} quantity for ${line.medicineSnapshot.brandName}`}
                        style={styles.input}
                        keyboardType="number-pad"
                        value={entry[field]}
                        onChangeText={(value) =>
                          setDraft((current) => ({
                            ...current,
                            [key]: { ...entry, [field]: value },
                          }))
                        }
                      />
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
          {receiptProblem ? <Text style={styles.error}>{receiptProblem}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(busy) || Boolean(receiptProblem)}
            style={[styles.action, receiptProblem ? styles.disabled : null]}
            onPress={() =>
              void act(
                'receive',
                {
                  lines: receivableLines.map((line) => {
                    const entry = draft[lineKey(line)] ?? {
                      restock: '0',
                      damaged: '0',
                      expired: '0',
                      quarantined: '0',
                    };
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
                'Goods received and stock updated.',
              )
            }
          >
            <Text style={styles.actionText}>
              {busy === 'receive' ? 'Booking in…' : 'Confirm receipt'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.heading}>Actions</Text>
        {actions.includes('review') ? (
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(busy)}
            style={styles.secondary}
            onPress={() => void act('review', {}, 'Return claimed for review.')}
          >
            <Text style={styles.secondaryText}>
              {busy === 'review' ? 'Claiming…' : 'Start review'}
            </Text>
          </Pressable>
        ) : null}
        {actions.includes('collect') ? (
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(busy)}
            style={styles.action}
            onPress={() => void act('collect', {}, 'Marked as collected from the shop.')}
          >
            <Text style={styles.actionText}>
              {busy === 'collect' ? 'Saving…' : 'Mark collected'}
            </Text>
          </Pressable>
        ) : null}
        {actions.includes('credit-note') ? (
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(busy)}
            style={styles.action}
            onPress={() =>
              Alert.alert(
                'Issue credit note?',
                `This credits ${formatMoneyMinor(record.approvedTotalMinor)} to the customer ledger and cannot be edited afterwards.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Issue',
                    onPress: () => void act('credit-note', {}, 'Credit note issued.'),
                  },
                ],
              )
            }
          >
            <Text style={styles.actionText}>
              {busy === 'credit-note' ? 'Issuing…' : 'Issue credit note'}
            </Text>
          </Pressable>
        ) : null}
        {actions.includes('cancel') ? (
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(busy)}
            style={styles.danger}
            onPress={() =>
              Alert.alert('Cancel this return?', 'The request will be withdrawn.', [
                { text: 'Keep it', style: 'cancel' },
                {
                  text: 'Cancel return',
                  style: 'destructive',
                  onPress: () =>
                    void act(
                      'cancel',
                      {
                        reason:
                          role === UserRole.SHOP_OWNER
                            ? 'Withdrawn by the shop'
                            : 'Cancelled by staff',
                      },
                      'Return cancelled.',
                    ),
                },
              ])
            }
          >
            <Text style={styles.actionText}>
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel return'}
            </Text>
          </Pressable>
        ) : null}
        {actions.length === 0 ? (
          <Text style={styles.muted}>No action is available to your role at this stage.</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { padding: 14, gap: 12, paddingBottom: 36 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 15, gap: 9 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  reference: { color: '#126b45', fontWeight: '900', fontSize: 18 },
  amount: { color: '#173f2e', fontWeight: '900', fontSize: 24 },
  badge: {
    backgroundColor: '#eef6f1',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeText: { color: '#274b3b', fontSize: 11, fontWeight: '700' },
  heading: { color: '#173f2e', fontWeight: '900', fontSize: 15 },
  line: { borderTopWidth: 1, borderTopColor: '#eef2ef', paddingTop: 9, gap: 3 },
  lineTitle: { fontWeight: '700', color: '#173f2e' },
  muted: { color: '#66756d' },
  credit: { color: '#126b45', fontWeight: '700' },
  reject: { color: '#8b2525' },
  inputRow: { flexDirection: 'row', gap: 7, marginTop: 6 },
  inputCell: { flex: 1, gap: 3 },
  inputLabel: { color: '#66756d', fontSize: 11 },
  input: {
    borderWidth: 1,
    borderColor: '#d9e3dd',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
    backgroundColor: '#fff',
    textAlign: 'center',
  },
  action: { backgroundColor: '#126b45', padding: 13, borderRadius: 9 },
  danger: { backgroundColor: '#8b2525', padding: 13, borderRadius: 9 },
  disabled: { opacity: 0.5 },
  actionText: { color: '#fff', textAlign: 'center', fontWeight: '900' },
  secondary: { backgroundColor: '#eef6f1', padding: 13, borderRadius: 9 },
  secondaryText: { color: '#126b45', textAlign: 'center', fontWeight: '900' },
  error: { color: '#8b2525', backgroundColor: '#fff0ee', padding: 10, borderRadius: 8 },
  success: { color: '#126b45', backgroundColor: '#e9f7ef', padding: 10, borderRadius: 8 },
});
