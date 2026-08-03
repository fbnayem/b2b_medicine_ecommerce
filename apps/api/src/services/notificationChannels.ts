import {
  NotificationCategory,
  NotificationChannel,
  NotificationEvent,
  NotificationPriority,
} from '@medsupply/shared-types';
import { PushDevice } from '../models/PushDevice';
import { isProduction } from '../env';
import { logger } from './logger';

export interface OutboundRecipient {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

export interface OutboundMessage {
  recipient: OutboundRecipient;
  event: NotificationEvent;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  link?: string;
  notificationId?: string;
  correlationId?: string;
}

export interface ChannelSendResult {
  providerReference?: string;
}

/**
 * A channel adapter is the only place that talks to an external provider.
 * `unavailableReason` lets the dispatcher record an honest SUPPRESSED row
 * instead of retrying a channel that can never succeed for this recipient.
 */
export interface ChannelAdapter {
  channel: NotificationChannel;
  /** Human-readable adapter name recorded on delivery rows. */
  name: string;
  unavailableReason(message: OutboundMessage): Promise<string | null>;
  send(message: OutboundMessage): Promise<ChannelSendResult>;
}

const trimmed = (value: string | undefined) => {
  const result = value?.trim();
  return result ? result : undefined;
};

/**
 * Posts the message to a provider webhook. Every outbound provider in this
 * system (transactional email, SMS gateway, WhatsApp Business API) is reachable
 * through one signed JSON POST, so a single adapter covers all three until real
 * vendor credentials are issued.
 */
class WebhookChannelAdapter implements ChannelAdapter {
  constructor(
    readonly channel: NotificationChannel,
    private readonly urlVariable: string,
    private readonly tokenVariable: string,
    private readonly requires: 'email' | 'phone',
  ) {}

  get name() {
    return this.url ? `${this.channel}_WEBHOOK` : `${this.channel}_LOG`;
  }

  private get url() {
    return trimmed(process.env[this.urlVariable]);
  }

  async unavailableReason(message: OutboundMessage) {
    const destination =
      this.requires === 'email' ? message.recipient.email : message.recipient.phone;
    if (!destination) {
      return `Recipient has no ${this.requires} on record for ${this.channel}`;
    }
    return null;
  }

  async send(message: OutboundMessage): Promise<ChannelSendResult> {
    const destination =
      this.requires === 'email' ? message.recipient.email : message.recipient.phone;
    const payload = {
      channel: this.channel,
      to: destination,
      event: message.event,
      category: message.category,
      priority: message.priority,
      subject: message.title,
      body: message.body,
      link: message.link,
      notificationId: message.notificationId,
      correlationId: message.correlationId,
    };

    const url = this.url;
    if (!url) {
      // Local development adapter: the message is still produced and observable,
      // which is how a developer reads a delivery OTP without an SMS provider.
      //
      // That observability must not survive into production. This branch is
      // reached whenever the channel's webhook variable is unset, so a
      // production deployment that has simply not configured SMS yet would
      // otherwise print every OTP, in plaintext, on the ordinary success path —
      // no error required. The body is therefore withheld off development, and
      // the missing configuration is reported as the fault it is.
      if (isProduction) {
        logger.warn('notification channel is not configured; no provider was called', {
          channel: this.channel,
          variable: this.urlVariable,
          event: message.event,
          notificationId: message.notificationId,
        });
      } else {
        logger.info('notification delivered to the development log adapter', {
          channel: this.channel,
          to: destination,
          subject: message.title,
          body: message.body,
        });
      }
      return { providerReference: `log:${message.notificationId ?? message.event}` };
    }

    const token = trimmed(process.env[this.tokenVariable]);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`${this.channel} provider responded ${response.status}`);
    }

    const reference = response.headers.get('x-provider-reference');
    return { providerReference: reference ?? undefined };
  }
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Expo's push service accepts unauthenticated sends for tokens issued to the
 * project, so this adapter is fully functional in development. `EXPO_ACCESS_TOKEN`
 * is honoured when the project enables enhanced push security.
 */
export class ExpoPushChannelAdapter implements ChannelAdapter {
  readonly channel = NotificationChannel.PUSH;
  readonly name = 'EXPO_PUSH';

  private get endpoint() {
    return trimmed(process.env.EXPO_PUSH_API_URL) ?? 'https://exp.host/--/api/v2/push/send';
  }

  private async activeTokens(userId: string) {
    const devices = await PushDevice.find({ userId, disabledAt: { $exists: false } })
      .select('token')
      .lean();
    return devices.map((device) => device.token as string);
  }

  async unavailableReason(message: OutboundMessage) {
    const tokens = await this.activeTokens(message.recipient.id);
    return tokens.length ? null : 'Recipient has no registered push device';
  }

  async send(message: OutboundMessage): Promise<ChannelSendResult> {
    const tokens = await this.activeTokens(message.recipient.id);
    if (!tokens.length) throw new Error('Recipient has no registered push device');

    const messages = tokens.map((token) => ({
      to: token,
      title: message.title,
      body: message.body,
      priority: message.priority === NotificationPriority.LOW ? 'normal' : 'high',
      data: {
        event: message.event,
        category: message.category,
        link: message.link,
        notificationId: message.notificationId,
      },
    }));

    const token = trimmed(process.env.EXPO_ACCESS_TOKEN);
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      throw new Error(`Expo push responded ${response.status}`);
    }

    const payload = (await response.json()) as { data?: ExpoPushTicket[] };
    const tickets = payload.data ?? [];
    const failures: string[] = [];

    await Promise.all(
      tickets.map(async (ticket, index) => {
        if (ticket.status === 'ok') return;
        failures.push(ticket.message ?? 'Unknown push error');
        // A token Expo no longer recognises must stop consuming retries.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          await PushDevice.updateOne(
            { token: tokens[index] },
            { $set: { disabledAt: new Date(), disabledReason: 'DeviceNotRegistered' } },
          );
        }
      }),
    );

    if (failures.length === tickets.length && tickets.length > 0) {
      throw new Error(`Expo push rejected every token: ${failures.join('; ')}`);
    }

    const accepted = tickets.find((ticket) => ticket.status === 'ok');
    return { providerReference: accepted?.id };
  }
}

const adapters = new Map<NotificationChannel, ChannelAdapter>([
  [
    NotificationChannel.EMAIL,
    new WebhookChannelAdapter(
      NotificationChannel.EMAIL,
      'NOTIFICATION_EMAIL_WEBHOOK_URL',
      'NOTIFICATION_EMAIL_WEBHOOK_TOKEN',
      'email',
    ),
  ],
  [
    NotificationChannel.SMS,
    new WebhookChannelAdapter(
      NotificationChannel.SMS,
      'NOTIFICATION_SMS_WEBHOOK_URL',
      'NOTIFICATION_SMS_WEBHOOK_TOKEN',
      'phone',
    ),
  ],
  [
    NotificationChannel.WHATSAPP,
    new WebhookChannelAdapter(
      NotificationChannel.WHATSAPP,
      'NOTIFICATION_WHATSAPP_WEBHOOK_URL',
      'NOTIFICATION_WHATSAPP_WEBHOOK_TOKEN',
      'phone',
    ),
  ],
  [NotificationChannel.PUSH, new ExpoPushChannelAdapter()],
]);

export function channelAdapter(channel: NotificationChannel): ChannelAdapter | undefined {
  return adapters.get(channel);
}

/** Test seam: lets integration tests substitute a recording adapter. */
export function registerChannelAdapter(adapter: ChannelAdapter) {
  adapters.set(adapter.channel, adapter);
}
