import { router } from 'expo-router';
import { useAuthStore } from './useAuth';
import { disconnectRealtime } from '../notifications/realtime';
import { unregisterCurrentDevice } from '../notifications/push';

/**
 * Signing out, in the order the three things have to happen.
 *
 * The sequence is not obvious and it was written out in exactly one place — the
 * bottom of the home screen — so any second sign-out button was one push token
 * away from a defect: **clearing the credential first leaves the device
 * registered**, and the server goes on sending order and delivery notifications
 * to a handset nobody is signed in on. On a shared counter tablet that is one
 * pharmacy's order updates arriving on another's screen.
 *
 * `unregisterCurrentDevice` therefore runs while the token is still valid, the
 * realtime socket is closed before the store forgets who it belonged to, and
 * only then is the credential cleared from `SecureStore`.
 */
export async function leaveSession() {
  await unregisterCurrentDevice();
  disconnectRealtime();
  await useAuthStore.getState().logout();
  router.replace('/');
}
