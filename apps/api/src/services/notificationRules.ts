import {
  NotificationChannel,
  NotificationEvent,
  NotificationPriority,
  OPTIONAL_NOTIFICATION_CHANNELS,
} from '@medsupply/shared-types';
import type { NotificationTemplate } from './notificationCatalogue';

export interface QuietHoursSetting {
  enabled: boolean;
  start: string;
  end: string;
}

export interface ResolvablePreference {
  defaultChannels?: NotificationChannel[] | null;
  overrides?: Array<{ event: NotificationEvent; channels: NotificationChannel[] }> | null;
  quietHours?: QuietHoursSetting | null;
  mutedEvents?: NotificationEvent[] | null;
}

export interface ChannelSuppression {
  channel: NotificationChannel;
  reason: string;
}

export interface ChannelResolution {
  channels: NotificationChannel[];
  suppressed: ChannelSuppression[];
}

/** Channels that reach a person outside the app and are therefore quiet-hours sensitive. */
const INTRUSIVE_CHANNELS: NotificationChannel[] = [
  NotificationChannel.SMS,
  NotificationChannel.PUSH,
  NotificationChannel.WHATSAPP,
];

export function parseLocalTime(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid quiet-hours time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Minutes past midnight in Asia/Dhaka. Timestamps are stored in UTC, so quiet
 * hours are only meaningful once converted at this boundary.
 */
export function dhakaLocalMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

export function isWithinQuietHours(at: Date, quietHours?: QuietHoursSetting | null): boolean {
  if (!quietHours?.enabled) return false;
  const start = parseLocalTime(quietHours.start);
  const end = parseLocalTime(quietHours.end);
  if (start === end) return false;
  const now = dhakaLocalMinutes(at);
  // A window such as 22:00-07:00 wraps past midnight.
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/**
 * Decides which channels a single notification uses.
 *
 * IN_APP is always present: it is the durable record the notification list
 * reads from, so disabling it would silently lose the event. Everything else is
 * the recipient's choice, narrowed by quiet hours for non-critical events.
 */
export function resolveChannels(input: {
  template: NotificationTemplate;
  preference?: ResolvablePreference | null;
  at: Date;
}): ChannelResolution {
  const { template, preference, at } = input;
  const suppressed: ChannelSuppression[] = [];

  if (preference?.mutedEvents?.includes(template.event)) {
    for (const channel of OPTIONAL_NOTIFICATION_CHANNELS) {
      suppressed.push({ channel, reason: 'Recipient muted this event' });
    }
    return { channels: [NotificationChannel.IN_APP], suppressed };
  }

  const override = preference?.overrides?.find((entry) => entry.event === template.event);
  const requested = override?.channels ?? preference?.defaultChannels ?? template.defaultChannels;
  const selected = OPTIONAL_NOTIFICATION_CHANNELS.filter((channel) => requested.includes(channel));

  for (const channel of OPTIONAL_NOTIFICATION_CHANNELS) {
    if (!selected.includes(channel)) {
      suppressed.push({ channel, reason: 'Channel disabled by recipient preference' });
    }
  }

  const quiet =
    template.priority !== NotificationPriority.CRITICAL &&
    isWithinQuietHours(at, preference?.quietHours);

  const channels: NotificationChannel[] = [NotificationChannel.IN_APP];
  for (const channel of selected) {
    if (quiet && INTRUSIVE_CHANNELS.includes(channel)) {
      suppressed.push({ channel, reason: 'Recipient quiet hours' });
      continue;
    }
    channels.push(channel);
  }

  return { channels, suppressed };
}

/**
 * Stable per recipient and occurrence. Retrying a failed transaction or
 * replaying an idempotent request must not create a second notification.
 */
export function notificationDedupeKey(input: {
  recipientId: string;
  event: NotificationEvent;
  occurrenceKey: string;
}): string {
  return `${input.recipientId}:${input.event}:${input.occurrenceKey}`;
}

export function deliveryIdempotencyKey(input: {
  recipientId: string;
  event: NotificationEvent;
  occurrenceKey: string;
  channel: NotificationChannel;
}): string {
  return `${notificationDedupeKey(input)}:${input.channel}`;
}

export function activityDedupeKey(input: {
  action: string;
  entityType: string;
  entityId: string;
  occurrenceKey: string;
}): string {
  return `${input.entityType}:${input.entityId}:${input.action}:${input.occurrenceKey}`;
}
