import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = { OS: 'android' as string };
const device = { isDevice: true, deviceName: 'Pixel 8' };
const notifications = {
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  setNotificationHandler: vi.fn(),
  AndroidImportance: { MAX: 5 },
};
const post = vi.fn();
const del = vi.fn();

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-device', () => device);
vi.mock('expo-notifications', () => notifications);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { eas: { projectId: 'project-9' } } } },
}));
vi.mock('../api/client', () => ({ apiClient: { post, delete: del }, baseURL: '' }));

const loadModule = async () => {
  vi.resetModules();
  return import('./push');
};

describe('Expo push registration', () => {
  beforeEach(() => {
    platform.OS = 'android';
    device.isDevice = true;
    Object.values(notifications).forEach((value) => {
      if (typeof value === 'function' && 'mockReset' in value) value.mockReset();
    });
    post.mockReset();
    del.mockReset();
    notifications.setNotificationChannelAsync.mockResolvedValue(undefined);
    notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    post.mockResolvedValue({ data: { data: {} } });
  });

  it('creates the Android channel, requests permission and registers the token', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false });
    notifications.requestPermissionsAsync.mockResolvedValue({ granted: true });

    const { registerForPush } = await loadModule();
    const outcome = await registerForPush();

    expect(outcome).toEqual({ status: 'REGISTERED', token: 'ExponentPushToken[abc]' });
    // SDK 57 requires the channel before the Android 13+ permission prompt.
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'medsupply-operations',
      expect.objectContaining({ importance: 5 }),
    );
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-9' });
    expect(post).toHaveBeenCalledWith('/notifications/devices', {
      token: 'ExponentPushToken[abc]',
      platform: 'ANDROID',
      deviceName: 'Pixel 8',
    });
  });

  it('does not re-prompt when permission was already granted', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: true });

    const { registerForPush } = await loadModule();
    await registerForPush();

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports a declined prompt without registering a token', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false });
    notifications.requestPermissionsAsync.mockResolvedValue({ granted: false });

    const { registerForPush } = await loadModule();
    expect(await registerForPush()).toEqual({ status: 'DENIED' });
    expect(post).not.toHaveBeenCalled();
  });

  it('reports an emulator as unsupported rather than as a failure', async () => {
    device.isDevice = false;

    const { registerForPush } = await loadModule();
    const outcome = await registerForPush();
    expect(outcome.status).toBe('UNSUPPORTED');
    expect(post).not.toHaveBeenCalled();
  });

  it('surfaces a provider failure instead of throwing into the screen', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    notifications.getExpoPushTokenAsync.mockRejectedValue(new Error('Expo unreachable'));

    const { registerForPush } = await loadModule();
    expect(await registerForPush()).toEqual({
      status: 'FAILED',
      reason: 'Expo unreachable',
    });
  });

  it('removes only the token this session registered on sign-out', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    const { registerForPush, unregisterCurrentDevice } = await loadModule();

    // Nothing registered yet: sign-out must not call the API.
    await unregisterCurrentDevice();
    expect(del).not.toHaveBeenCalled();

    await registerForPush();
    await unregisterCurrentDevice();
    expect(del).toHaveBeenCalledWith('/notifications/devices', {
      data: { token: 'ExponentPushToken[abc]' },
    });

    // A second sign-out has nothing left to remove.
    del.mockClear();
    await unregisterCurrentDevice();
    expect(del).not.toHaveBeenCalled();
  });

  it('never blocks sign-out when the unregister request fails', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    del.mockRejectedValue(new Error('offline'));
    const { registerForPush, unregisterCurrentDevice } = await loadModule();
    await registerForPush();
    await expect(unregisterCurrentDevice()).resolves.toBeUndefined();
  });

  it('maps a notification link onto the matching mobile route', async () => {
    const { routeForPush } = await loadModule();
    expect(routeForPush({ link: '/orders/64b7f1c2a1b2c3d4e5f60718' })).toBe(
      '/order-detail?id=64b7f1c2a1b2c3d4e5f60718',
    );
    expect(routeForPush({ link: '/deliveries/64b7f1c2a1b2c3d4e5f60719' })).toBe(
      '/delivery-detail?id=64b7f1c2a1b2c3d4e5f60719',
    );
    expect(routeForPush({ link: '/payments/64b7f1c2a1b2c3d4e5f6071a' })).toBe(
      '/payment-detail?id=64b7f1c2a1b2c3d4e5f6071a',
    );
    expect(routeForPush({ link: '/fulfilment/anything' })).toBe('/fulfilment');
    // An unknown or absent link must never produce a broken route.
    expect(routeForPush({ link: '/some/unmapped/page' })).toBe('/notifications');
    expect(routeForPush(undefined)).toBeNull();
    expect(routeForPush({})).toBeNull();
  });

  it('skips the Android channel on iOS and reports the iOS platform', async () => {
    platform.OS = 'ios';
    notifications.getPermissionsAsync.mockResolvedValue({ granted: true });

    const { registerForPush, platformValue } = await loadModule();
    await registerForPush();

    expect(platformValue()).toBe('IOS');
    expect(notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      '/notifications/devices',
      expect.objectContaining({ platform: 'IOS' }),
    );
  });
});
