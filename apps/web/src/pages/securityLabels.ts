/**
 * Presentation helpers for the security centre.
 *
 * Kept out of the component file so that module exports only a component: a
 * file that exports both loses fast refresh, and these are worth testing on
 * their own anyway.
 */

/**
 * Describes a session in terms its owner can recognise.
 *
 * A user asked "is this you?" cannot answer from a user-agent string, so the
 * client and platform are named instead.
 */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const platform = /android/i.test(userAgent)
    ? 'Android'
    : /iphone|ipad|ios/i.test(userAgent)
      ? 'iOS'
      : /windows/i.test(userAgent)
        ? 'Windows'
        : /mac os|macintosh/i.test(userAgent)
          ? 'macOS'
          : /linux/i.test(userAgent)
            ? 'Linux'
            : 'Unknown platform';
  const client = /medsupply|expo|okhttp/i.test(userAgent)
    ? 'MedSupply mobile'
    : /edg\//i.test(userAgent)
      ? 'Edge'
      : /chrome\//i.test(userAgent)
        ? 'Chrome'
        : /firefox\//i.test(userAgent)
          ? 'Firefox'
          : /safari\//i.test(userAgent)
            ? 'Safari'
            : 'Unknown client';
  return `${client} on ${platform}`;
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
export function revocationLabel(reason: string | null): string {
  switch (reason) {
    case 'TOKEN_REUSE':
      return 'Ended for safety';
    case 'REVOKED_BY_ADMIN':
      return 'Ended by an administrator';
    case 'ROLE_CHANGED':
      return 'Ended after a role change';
    case 'SIGNED_OUT_EVERYWHERE':
      return 'Signed out everywhere';
    default:
      return 'Signed out';
  }
}
