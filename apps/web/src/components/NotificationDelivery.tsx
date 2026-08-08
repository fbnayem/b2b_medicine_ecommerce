import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEvent,
  UserRole,
} from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import { Badge, Button, Card, Field, Input, Select, toast } from './ui';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { useAuthStore } from '../store/useAuth';
import { formatFinanceDateTime } from '../lib/finance';

/**
 * Why a notification did or did not arrive, and a way to prove a channel works.
 *
 * `NotificationDelivery` has recorded one row per recipient, channel and
 * occurrence since the notifications phase — with the provider's reference, the
 * error text and the reason a suppressed message was suppressed — and
 * `GET /notifications/{id}/deliveries` served all of it to nobody. When a
 * manager said "I never got the email", the only way to find out whether it was
 * sent, refused by a preference or rejected by the provider was to read the
 * collection directly.
 *
 * `POST /notifications/test` is the other half: a channel that has never
 * carried a message is a channel nobody knows is broken until the first real
 * one fails to arrive.
 */

const ADMINISTRATORS: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

/**
 * A test goes to the person asking for it, and to nobody else.
 *
 * The endpoint accepts any recipient and any event, which together would send a
 * real customer a real-looking "your order was approved" — indistinguishable
 * from the true one, because it is the true template. What an administrator
 * actually needs to know is whether a **channel** carries, and their own
 * address, handset and number answer that completely.
 */
const TEST_EVENT = NotificationEvent.STOCK_NEAR_EXPIRY;

interface Delivery {
  _id: string;
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  attempts?: number;
  providerReference?: string;
  lastError?: string;
  suppressionReason?: string;
  sentAt?: string;
  failedAt?: string;
  createdAt: string;
}

const TONE: Record<NotificationDeliveryStatus, 'success' | 'danger' | 'neutral' | 'brand'> = {
  [NotificationDeliveryStatus.SENT]: 'success',
  [NotificationDeliveryStatus.FAILED]: 'danger',
  [NotificationDeliveryStatus.SUPPRESSED]: 'neutral',
  [NotificationDeliveryStatus.PENDING]: 'brand',
};

/** The attempt log behind one notification, opened on demand. */
export function DeliveryLog({ notificationId }: { notificationId: string }) {
  const { t, language } = useLanguage();
  const role = useAuthStore((state) => state.user?.role);
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [loading, setLoading] = useState(false);

  if (!role || !ADMINISTRATORS.includes(role)) return null;

  async function load() {
    setLoading(true);
    try {
      const response = await apiClient.get(`/notifications/${notificationId}/deliveries`);
      setRows(response.data.data as Delivery[]);
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('notifications.deliveriesFailed')));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 w-full">
      <Button
        size="sm"
        data-test={`deliveries-${notificationId}`}
        disabled={loading}
        onClick={() => void load()}
      >
        {loading ? t('notifications.deliveriesLoading') : t('notifications.deliveries')}
      </Button>

      {rows && rows.length === 0 && (
        <p className="mt-2 text-sm text-text-muted">{t('notifications.noDeliveries')}</p>
      )}

      {rows && rows.length > 0 && (
        <ul className="m-0 mt-2 list-none p-0" data-test={`delivery-log-${notificationId}`}>
          {rows.map((row) => (
            <li key={row._id} className="border-b border-border py-2 text-sm last:border-b-0">
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[row.status]}>
                  {t(`notificationDeliveryStatus.${row.status}`)}
                </Badge>
                <strong className="text-text">{t(`notificationChannel.${row.channel}`)}</strong>
                <span className="text-text-muted">
                  {formatFinanceDateTime(row.sentAt ?? row.failedAt ?? row.createdAt)}
                </span>
                {(row.attempts ?? 0) > 1 && (
                  <span className="text-text-muted">
                    {t('notifications.attempts', { count: row.attempts ?? 0 })}
                  </span>
                )}
              </span>
              {/*
                The reason, whichever kind it is. A suppression is not a
                failure — it is a preference working — and printing them the
                same way is how somebody ends up chasing a bug that is really
                one person's switched-off email.
              */}
              {row.suppressionReason && (
                <p className="m-0 mt-1 text-text-muted">{row.suppressionReason}</p>
              )}
              {row.lastError && <p className="m-0 mt-1 text-danger">{row.lastError}</p>}
              {row.providerReference && (
                <p className="m-0 mt-1 text-text-muted">
                  {t('notifications.providerReference', { reference: row.providerReference })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Send one message to yourself, to find out whether a channel carries. */
export function TestSend() {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const me = useAuthStore((state) => state.user?._id);
  const [channel, setChannel] = useState<string>(NotificationChannel.EMAIL);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  if (!role || !ADMINISTRATORS.includes(role) || !me) return null;

  async function send(submitted: FormEvent) {
    submitted.preventDefault();
    setSending(true);
    try {
      await apiClient.post('/notifications/test', {
        recipientId: me,
        event: TEST_EVENT,
        channels: [channel],
        note: note.trim(),
      });
      // The test lands in this same inbox, and the whole point is to open its
      // attempt log — so the list it will appear in has to be refetched.
      await queryClient.invalidateQueries({ queryKey: keys.notifications.all });
      toast.success(t('notifications.testSent'));
      setNote('');
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('notifications.testFailed')));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="mb-4">
      <h2 className="mb-1 text-lg font-semibold text-text">{t('notifications.testTitle')}</h2>
      <p className="mb-3 text-sm text-text-muted">{t('notifications.testBody')}</p>

      <form className="flex flex-wrap items-end gap-3" onSubmit={(form) => void send(form)}>
        <Field
          label={t('notifications.testChannel')}
          className="min-w-44"
          hint={t('hints.testChannel')}
        >
          <Select
            value={channel}
            data-test="test-channel"
            onChange={(change) => setChannel(change.target.value)}
          >
            {Object.values(NotificationChannel).map((value) => (
              <option key={value} value={value}>
                {t(`notificationChannel.${value}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t('notifications.testNote')}
          className="min-w-56 flex-1"
          hint={t('hints.testNote')}
        >
          <Input
            value={note}
            data-test="test-note"
            onChange={(change) => setNote(change.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" disabled={sending || note.trim().length < 3}>
          {sending ? t('notifications.testSending') : t('notifications.testSend')}
        </Button>
      </form>
    </Card>
  );
}
