// Keeps this phone's push registration alive (review W2-8). The Settings switch registers once; the
// server row can then be taken over by another account (008: one owner per token) or die with the
// token (APNs/FCM rotation, BadDeviceToken cleanup) while the switch still shows "on" and nothing is
// delivered. So on every app start, when this phone holds a registered token and the OS permission
// is already granted, the fresh device token is registered again (the upsert refreshes owner and
// last_seen; `push.register` unregisters a rotated previous token), and a push-token rotation event
// re-registers at once. A verified sign-in (`auth.onSignedIn`) registers again too, even with an
// unchanged token: the row may belong to the previous account on this phone (008 takeover).
// NOT `auth.onChange` (review P2-1): Supabase's SIGNED_IN event also fires for the session an
// attacker's email link installs during the W1-1 window, before lib/chat has compared the address
// and signed it out again; a register RPC in that window would re-own this phone's token row under
// the attacker's JWT. `onSignedIn` fires only after lib/chat completed and checked the sign-in.
// Nothing prompts the user here: no permission is requested, and a phone that never turned
// notifications on does nothing. The token goes to `push.register` only.
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { auth, push } from '@/lib/chat';

const platform = (): 'ios' | 'android' => (Platform.OS === 'ios' ? 'ios' : 'android');

export function PushRefresher() {
  // The token last handed to push.register: the start-up fetch also fires the listener, and a listener
  // event for an unchanged token has nothing to do.
  const last = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    const register = async (token: string) => {
      if (!alive || !token || token === last.current) return;
      last.current = token;
      try {
        if (await push.current()) await push.register(platform(), token);
      } catch { /* offline, not signed in or not configured: the next launch or rotation tries again */ }
    };
    const refresh = async () => {
      try {
        if (!(await push.current())) return;
        const perm = await Notifications.getPermissionsAsync();
        if (!perm.granted) return;
        const t = await Notifications.getDevicePushTokenAsync();
        await register(String(t.data));
      } catch { /* same: best effort */ }
    };
    void refresh();
    const sub = Notifications.addPushTokenListener((t) => { void register(String(t.data)); });
    let off = () => {};
    try {
      off = auth.onSignedIn(() => { last.current = null; void refresh(); });
    } catch { /* lib/chat not wired: start-up and rotation still cover it */ }
    return () => { alive = false; sub.remove(); off(); };
  }, []);
  return null;
}
