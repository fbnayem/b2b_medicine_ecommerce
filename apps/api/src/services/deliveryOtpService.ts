import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Types } from 'mongoose';
import { NotificationEvent } from '@medsupply/shared-types';
import { Shop } from '../models/Shop';
import { notify } from './notificationService';
import { deliverySettings } from './settingsService';

function digest(deliveryId: string, code: string) {
  return createHash('sha256')
    .update(`${deliveryId}:${code}:${process.env.JWT_SECRET ?? ''}`)
    .digest('hex');
}

export async function issueDeliveryOtp(deliveryId: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { otpExpiryMinutes } = await deliverySettings();
  return {
    code,
    hash: digest(deliveryId, code),
    expiresAt: new Date(Date.now() + otpExpiryMinutes * 60 * 1000),
    expiryMinutes: otpExpiryMinutes,
  };
}

export function verifyDeliveryOtp(deliveryId: string, code: string, expectedHash: string) {
  const actual = Buffer.from(digest(deliveryId, code));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface OtpDeliveryProvider {
  send(
    shopId: Types.ObjectId,
    reference: string,
    code: string,
    expiryMinutes: number,
  ): Promise<void>;
}

export class InAppOtpDeliveryProvider implements OtpDeliveryProvider {
  async send(shopId: Types.ObjectId, reference: string, code: string, expiryMinutes: number) {
    const shop = await Shop.findById(shopId).select('ownerIds');
    if (!shop) throw new Error('Delivery shop not found');
    await notify({
      event: NotificationEvent.DELIVERY_OTP,
      recipientIds: shop.ownerIds,
      context: { reference, code, count: expiryMinutes },
      entityType: 'Delivery',
      // Each issued code is a distinct occurrence; a resend must reach the shop.
      occurrenceKey: `${reference}:${digest(reference, code).slice(0, 16)}`,
    });
  }
}

export const otpDeliveryProvider: OtpDeliveryProvider = new InAppOtpDeliveryProvider();
