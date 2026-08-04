import { describeDevice, revocationReason } from '@medsupply/utilities';

/**
 * Presentation helpers for the security centre.
 *
 * Kept out of the component file so that module exports only a component: a
 * file that exports both loses fast refresh, and these are worth testing on
 * their own anyway.
 *
 * The user-agent classification and the revocation mapping used to live here
 * *and* in `apps/mobile/src/security/api.ts`, byte for byte apart from one
 * regex, and both returned finished English sentences into screens that are
 * otherwise translated. They now come from `@medsupply/utilities` as data, and
 * the words come from the catalogue.
 */

type Translate = (path: string, values?: Record<string, string | number>) => string;

/**
 * Describes a session in terms its owner can recognise.
 *
 * A user asked "is this you?" cannot answer from a user-agent string, so the
 * client and platform are named instead — and when we cannot tell, that is said
 * in their language rather than in ours.
 */
export function deviceLabel(t: Translate, userAgent: string | null): string {
  const { client, platform } = describeDevice(userAgent);
  if (!client && !platform) return t('security.unknownDevice');
  return t('security.deviceOn', {
    client: client ?? t('security.unknownClient'),
    platform: platform ?? t('security.unknownPlatform'),
  });
}

/** Uptime at the resolution an operator actually reads it at. */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Why a session ended, in words rather than an enum. */
export function endedLabel(t: Translate, reason: string | null): string {
  const key = revocationReason(reason);
  return t(`security.ended${key.charAt(0).toUpperCase()}${key.slice(1)}`);
}
