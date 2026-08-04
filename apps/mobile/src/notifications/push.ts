import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { PushPlatform } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { colour } from '../theme';

export type PushRegistrationOutcome =
  | { status: 'REGISTERED'; token: string }
  | { status: 'DENIED' }
  | { status: 'UNSUPPORTED'; reason: string }
  | { status: 'FAILED'; reason: string };

export const ANDROID_CHANNEL_ID = 'medsupply-operations';

/** SDK 57 requires the Android channel to exist before permissions are requested. */
export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Operations',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    /*
     * The same green as `app.json`'s channel colour, which is the token.
     *
     * This was `#16724A` — the *second* brand green, the one the token package
     * was created to collapse — while `app.json` declared `#126b45` for the
     * same Android channel. Two different greens for one notification.
     */
    lightColor: colour.brand,
  });
}

function projectId(): string | undefined {
  const easId = Constants.expoConfig?.extra?.eas?.projectId;
  return typeof easId === 'string' && easId ? easId : undefined;
}

export function platformValue(): PushPlatform {
  if (Platform.OS === 'android') return PushPlatform.ANDROID;
  if (Platform.OS === 'ios') return PushPlatform.IOS;
  return PushPlatform.WEB;
}

/**
 * Requests permission and registers the Expo push token with the API.
 *
 * The outcome is returned rather than thrown so the account screen can show an
 * honest state: a simulator and a declined prompt are different problems, and
 * neither should look like a bug.
 */
export async function registerForPush(): Promise<PushRegistrationOutcome> {
  if (!Device.isDevice) {
    return { status: 'UNSUPPORTED', reason: 'Push notifications need a physical device.' };
  }

  try {
    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted) {
      const requested = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      granted = requested.granted;
    }
    if (!granted) return { status: 'DENIED' };

    const id = projectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      id ? { projectId: id } : undefined,
    );
    const token = tokenResponse.data;

    await apiClient.post('/notifications/devices', {
      token,
      platform: platformValue(),
      deviceName: Device.deviceName ?? undefined,
    });

    registeredToken = token;
    return { status: 'REGISTERED', token };
  } catch (error) {
    return {
      status: 'FAILED',
      reason: error instanceof Error ? error.message : 'Push registration failed.',
    };
  }
}

/** Token registered by this session, so sign-out can remove exactly it. */
let registeredToken: string | null = null;

export async function unregisterPush(token: string) {
  await apiClient.delete('/notifications/devices', { data: { token } });
}

/**
 * Called on sign-out so a shared device stops receiving the previous user's
 * alerts. Failures are swallowed: a network problem must never block sign-out.
 */
export async function unregisterCurrentDevice() {
  if (!registeredToken) return;
  try {
    await unregisterPush(registeredToken);
  } catch {
    // The server also reassigns the token when the next user registers it.
  } finally {
    registeredToken = null;
  }
}

/**
 * Foreground presentation. Banners are shown but badges and sounds are left to
 * the OS defaults, so an operator scanning barcodes is not interrupted by audio.
 */
export function configureForegroundPresentation() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export interface PushPayload {
  event?: string;
  category?: string;
  link?: string;
  notificationId?: string;
}

/** Maps a notification's web link onto the matching Expo Router path. */
export function routeForPush(payload: PushPayload | undefined): string | null {
  const link = payload?.link;
  if (!link) return null;
  const order = /^\/orders\/([0-9a-fA-F]{24})$/.exec(link);
  if (order) return `/order-detail?id=${order[1]}`;
  const delivery = /^\/deliveries\/([0-9a-fA-F]{24})$/.exec(link);
  if (delivery) return `/delivery-detail?id=${delivery[1]}`;
  const payment = /^\/payments\/([0-9a-fA-F]{24})$/.exec(link);
  if (payment) return `/payment-detail?id=${payment[1]}`;
  if (link.startsWith('/fulfilment')) return '/fulfilment';
  if (link.startsWith('/inventory')) return '/inventory';
  if (link.startsWith('/account')) return '/account';
  // Anything unrecognised opens the inbox rather than a broken route.
  return '/notifications';
}
