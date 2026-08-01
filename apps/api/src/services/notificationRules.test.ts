import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NotificationChannel,
  NotificationEvent,
  OPTIONAL_NOTIFICATION_CHANNELS,
} from '@medsupply/shared-types';
import { allTemplates, formatBdt, templateFor } from './notificationCatalogue';
import {
  activityDedupeKey,
  deliveryIdempotencyKey,
  dhakaLocalMinutes,
  isWithinQuietHours,
  notificationDedupeKey,
  parseLocalTime,
  resolveChannels,
} from './notificationRules';
import { backoffDelayMs, InProcessQueue, JOB_ATTEMPTS } from './jobQueue';

test('every catalogued event has a template that renders without context', () => {
  const events = Object.values(NotificationEvent);
  assert.equal(allTemplates().length, events.length);
  for (const event of events) {
    const template = templateFor(event);
    const rendered = template.render({});
    assert.ok(rendered.title.length > 0, `${event} title`);
    assert.ok(rendered.body.length > 0, `${event} body`);
    assert.ok(!rendered.title.includes('undefined'), `${event} title interpolation`);
    assert.ok(!rendered.body.includes('undefined'), `${event} body interpolation`);
    assert.ok(
      !template.defaultChannels.includes(NotificationChannel.IN_APP),
      `${event} must not list IN_APP as an optional default`,
    );
  }
});

test('money is rendered from integer minor units without float drift', () => {
  assert.equal(formatBdt(0), '৳0.00');
  assert.equal(formatBdt(5), '৳0.05');
  assert.equal(formatBdt(123_456_789), '৳1,234,567.89');
  assert.equal(formatBdt(-2_50), '-৳2.50');
  assert.throws(() => formatBdt(10.5), /integer minor/);
});

test('quiet hours convert UTC to Asia/Dhaka and wrap past midnight', () => {
  assert.equal(parseLocalTime('22:00'), 22 * 60);
  // 18:30 UTC is 00:30 the next day in Dhaka (UTC+6).
  assert.equal(dhakaLocalMinutes(new Date('2026-08-01T18:30:00.000Z')), 30);

  const overnight = { enabled: true, start: '22:00', end: '07:00' };
  assert.equal(isWithinQuietHours(new Date('2026-08-01T18:30:00.000Z'), overnight), true);
  // 09:00 Dhaka is outside the window.
  assert.equal(isWithinQuietHours(new Date('2026-08-01T03:00:00.000Z'), overnight), false);

  const daytime = { enabled: true, start: '09:00', end: '17:00' };
  assert.equal(isWithinQuietHours(new Date('2026-08-01T05:00:00.000Z'), daytime), true);
  assert.equal(isWithinQuietHours(new Date('2026-08-01T18:00:00.000Z'), daytime), false);
  assert.equal(
    isWithinQuietHours(new Date('2026-08-01T18:00:00.000Z'), { ...daytime, enabled: false }),
    false,
  );
});

test('in-app delivery is never suppressed by preferences', () => {
  const template = templateFor(NotificationEvent.ORDER_APPROVED);
  const muted = resolveChannels({
    template,
    preference: { mutedEvents: [NotificationEvent.ORDER_APPROVED] },
    at: new Date('2026-08-01T06:00:00.000Z'),
  });
  assert.deepEqual(muted.channels, [NotificationChannel.IN_APP]);
  assert.equal(muted.suppressed.length, OPTIONAL_NOTIFICATION_CHANNELS.length);
  for (const entry of muted.suppressed) {
    assert.match(entry.reason, /muted/i);
  }
});

test('an event override wins over the global default channels', () => {
  const template = templateFor(NotificationEvent.ORDER_APPROVED);
  const resolution = resolveChannels({
    template,
    preference: {
      defaultChannels: [NotificationChannel.EMAIL],
      overrides: [{ event: NotificationEvent.ORDER_APPROVED, channels: [NotificationChannel.SMS] }],
    },
    at: new Date('2026-08-01T06:00:00.000Z'),
  });
  assert.deepEqual(resolution.channels, [NotificationChannel.IN_APP, NotificationChannel.SMS]);
  assert.ok(
    resolution.suppressed.some(
      (entry) => entry.channel === NotificationChannel.EMAIL && /preference/i.test(entry.reason),
    ),
  );
});

test('quiet hours mute intrusive channels but keep email and critical events', () => {
  const quietHours = { enabled: true, start: '22:00', end: '07:00' };
  const duringQuietHours = new Date('2026-08-01T18:30:00.000Z');

  const normal = resolveChannels({
    template: templateFor(NotificationEvent.ORDER_APPROVED),
    preference: {
      overrides: [
        {
          event: NotificationEvent.ORDER_APPROVED,
          channels: [NotificationChannel.PUSH, NotificationChannel.EMAIL],
        },
      ],
      quietHours,
    },
    at: duringQuietHours,
  });
  assert.deepEqual(normal.channels, [NotificationChannel.IN_APP, NotificationChannel.EMAIL]);
  assert.ok(
    normal.suppressed.some(
      (entry) => entry.channel === NotificationChannel.PUSH && /quiet hours/i.test(entry.reason),
    ),
  );

  // A critical event must still reach the person overnight.
  const critical = resolveChannels({
    template: templateFor(NotificationEvent.DELIVERY_OTP),
    preference: { quietHours },
    at: duringQuietHours,
  });
  assert.ok(critical.channels.includes(NotificationChannel.SMS));
});

test('with no saved preference the template defaults apply', () => {
  const template = templateFor(NotificationEvent.DELIVERY_ASSIGNED);
  const resolution = resolveChannels({ template, preference: null, at: new Date() });
  assert.deepEqual(resolution.channels, [NotificationChannel.IN_APP, ...template.defaultChannels]);
});

test('dedupe keys separate recipients, events, occurrences and channels', () => {
  const base = {
    recipientId: 'user-1',
    event: NotificationEvent.ORDER_APPROVED,
    occurrenceKey: 'v1',
  };
  assert.equal(notificationDedupeKey(base), 'user-1:ORDER_APPROVED:v1');
  assert.notEqual(
    notificationDedupeKey(base),
    notificationDedupeKey({ ...base, recipientId: 'user-2' }),
  );
  assert.notEqual(
    notificationDedupeKey(base),
    notificationDedupeKey({ ...base, occurrenceKey: 'v2' }),
  );
  assert.notEqual(
    deliveryIdempotencyKey({ ...base, channel: NotificationChannel.EMAIL }),
    deliveryIdempotencyKey({ ...base, channel: NotificationChannel.SMS }),
  );
  assert.equal(
    activityDedupeKey({
      action: 'ORDER_APPROVED',
      entityType: 'Order',
      entityId: 'o1',
      occurrenceKey: 'v3',
    }),
    'Order:o1:ORDER_APPROVED:v3',
  );
});

test('the in-process queue retries with exponential backoff and gives up at the attempt limit', async () => {
  assert.equal(backoffDelayMs(1), 1_000);
  assert.equal(backoffDelayMs(3), 4_000);

  const queue = new InProcessQueue<{ id: string }>('test-retry', 1);
  let attempts = 0;
  queue.process(async () => {
    attempts += 1;
    throw new Error('always fails');
  });
  await queue.enqueue({ id: 'a' });
  await queue.drain();
  assert.equal(attempts, JOB_ATTEMPTS);
  await queue.close();
});

test('the in-process queue drops a repeat enqueue of the same job id', async () => {
  const queue = new InProcessQueue<{ id: string }>('test-dedupe');
  const handled: string[] = [];
  queue.process(async (job) => {
    handled.push(job.id);
  });
  await queue.enqueue({ id: 'a' }, { jobId: 'job-1' });
  await queue.enqueue({ id: 'a' }, { jobId: 'job-1' });
  await queue.enqueue({ id: 'b' }, { jobId: 'job-2' });
  await queue.drain();
  assert.deepEqual(handled.sort(), ['a', 'b']);
  await queue.close();
});
