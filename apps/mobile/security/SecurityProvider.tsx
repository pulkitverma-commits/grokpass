// N2 + N4: the one place that decides whether the app's content may be on screen.
//
//   locked    cold start → true. Cleared only by `unlock()` after the OS check (and, when the panic
//             flag is set, after the core's `unlock()`). Set again by `lockNow()`, `panic()`, by a
//             return from background after more than AUTO_LOCK_MS, and by a panic flag found in
//             the lock store on foreground (`reload()`, reviewer N3). Every one of those relocks
//             bumps an unlock generation (W1-7): an `unlock()` that was already awaiting the OS
//             prompt or the core when the relock happened applies nothing when it resolves.
//   inactive  AppState is not 'active' (app switcher, incoming call, control centre).
//   captured  iOS: UIScreen.isCaptured (recording / mirroring). Android: always false (FLAG_SECURE).
//
// Children are NOT rendered while `locked` (they are unmounted, not covered); the cover is rendered
// while `locked || inactive || captured`. `panic()` flips `locked` synchronously in the same render
// as the persistent flag write, so the cover is on screen within one frame.
//
// Native APIs: react-native AppState (change events 'active' | 'inactive' | 'background'),
// expo-screen-capture preventScreenCaptureAsync (Android FLAG_SECURE; on iOS a best-effort layer that
// is NOT relied on, see README), modules/screen-state (isCaptured + onCapturedChange).
//
// FLAG_SECURE (W1-4): the provider asserts `preventScreenCaptureAsync(APP_SECURE_KEY)` on mount and
// again on every AppState → 'active', retrying once after SECURE_RETRY_MS if the native call throws
// (MissingActivity before the activity is attached). Nothing in the app ever calls
// `allowScreenCaptureAsync`: the flag is app-wide and is never meant to come off.
import * as ScreenCapture from 'expo-screen-capture';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { getChat, getLockStore } from '@/lib/chat';
import { addCapturedListener, isCaptured } from '@/modules/screen-state';

import { excludeChatDbFromBackup } from './backup';
import { authenticateDevice, probeDeviceAuth, type Biometrics } from './biometrics';
import { APP_SECURE_KEY, AUTO_LOCK_MS, SECURE_RETRY_MS } from './constants';
import { LockCover } from './LockCover';

export type SecurityState = {
  locked: boolean;
  /** OS check (biometrics with passcode fallback), then the core's unlock if the panic flag is set. */
  unlock(): Promise<boolean>;
  /** Lock without the panic flag: the next unlock needs only the OS check. */
  lockNow(): void;
  /** Panic Exit: lock, cover now, persist the flag, tell the core. */
  panic(): void;
  /** iOS: the screen is being recorded or mirrored right now. */
  captured: boolean;
  biometrics: Biometrics;
  /** No passcode / biometrics enrolled on this phone; `unlock()` succeeds after a visible warning. */
  deviceInsecure: boolean;
  /** AppState is not 'active'. Exposed for tests and for screens that pause media. */
  inactive: boolean;
};

const SecurityContext = createContext<SecurityState | null>(null);

/** The lock store on this branch may or may not have `reload()`; call it when present. */
type ReloadableLock = { get(): boolean; reload?: () => void };

export type SecurityProviderProps = {
  children: React.ReactNode;
  /** Replaces the default cover (mobile-ui's Locked screen, U3). Receives nothing: it uses useSecurity(). */
  cover?: React.ReactNode;
  /** Test hook: clock. */
  now?: () => number;
};

export function SecurityProvider({ children, cover, now = Date.now }: SecurityProviderProps) {
  const [locked, setLocked] = useState(true);
  // 'unknown' (first read on Android / in tests) is not "inactive": only a real leave shows the cover.
  const [inactive, setInactive] = useState(() => AppState.currentState === 'background' || AppState.currentState === 'inactive');
  const [captured, setCaptured] = useState<boolean>(() => isCaptured());
  const [biometrics, setBiometrics] = useState<Biometrics>('passcode');
  const [deviceInsecure, setDeviceInsecure] = useState(false);
  const leftAt = useRef<number | null>(null);
  const unlocking = useRef(false);
  // W1-7: bumped by every relock. `unlock()` reads it at start and applies its result only if unchanged.
  const generation = useRef(0);
  const secureRetry = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Lock and invalidate any unlock still in flight. The only way `locked` becomes true. */
  const relock = useCallback(() => {
    generation.current += 1;
    unlocking.current = false;   // a fresh unlock may start; the stale one is discarded by generation
    setLocked(true);
  }, []);

  // W1-4: assert the app-wide FLAG_SECURE key; one delayed retry if the native call throws.
  const assertSecure = useCallback(() => {
    if (secureRetry.current !== null) { clearTimeout(secureRetry.current); secureRetry.current = null; }
    ScreenCapture.preventScreenCaptureAsync(APP_SECURE_KEY).catch(() => {
      secureRetry.current = setTimeout(() => {
        secureRetry.current = null;
        ScreenCapture.preventScreenCaptureAsync(APP_SECURE_KEY).catch(() => { /* re-asserted on the next foreground */ });
      }, SECURE_RETRY_MS);
    });
  }, []);

  // Probe the device's auth capabilities once; refresh on each foreground (enrolment can change).
  const probe = useCallback(() => {
    probeDeviceAuth().then((s) => { setBiometrics(s.biometrics); setDeviceInsecure(s.deviceInsecure); });
  }, []);

  useEffect(() => {
    probe();
    // App-wide capture protection. Android: FLAG_SECURE (re-asserted on every foreground, never
    // released). iOS: best effort only.
    assertSecure();
    excludeChatDbFromBackup().catch(() => {});
    const offCapture = addCapturedListener(setCaptured);
    return () => {
      offCapture();
      if (secureRetry.current !== null) { clearTimeout(secureRetry.current); secureRetry.current = null; }
    };
  }, [probe, assertSecure]);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') {
        setInactive(false);
        const away = leftAt.current;
        leftAt.current = null;
        if (away !== null && now() - away > AUTO_LOCK_MS) relock();
        // Reviewer N3: a panic lock set elsewhere (another screen, a pending write at the previous
        // cold start) must be seen when we come back.
        try {
          const store = getLockStore() as unknown as ReloadableLock;
          store.reload?.();
          if (store.get()) relock();
        } catch { /* lib/chat not wired yet: nothing to reload */ }
        probe();
        assertSecure();
      } else {
        setInactive(true);
        if (leftAt.current === null) leftAt.current = now();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [now, probe, assertSecure, relock]);

  const lockNow = useCallback(() => { relock(); }, [relock]);

  const panic = useCallback(() => {
    relock();
    // Persist first (sync SecureStore write when available), then tell the core. Order matters for
    // the "flag survives a force-quit" promise; both are idempotent on the same store.
    try { getLockStore().set(); } catch { /* fail closed: we are locked already */ }
    try { getChat().lock(); } catch { /* same */ }
  }, [relock]);

  const unlock = useCallback(async () => {
    if (unlocking.current) return false;
    unlocking.current = true;
    const gen = generation.current;
    try {
      // An insecure device has nothing to prompt for; the Locked screen shows DEVICE_INSECURE_WARNING.
      if (!deviceInsecure) {
        const ok = await authenticateDevice();
        if (!ok) return false;
      }
      // W1-7: a relock (auto-lock after a long background trip, lockNow, panic) while the prompt was
      // up makes this result stale: do not unlock, the user must pass a fresh prompt.
      if (generation.current !== gen) return false;
      const chat = getChat();
      if (chat.isLocked()) await chat.unlock();   // clears the persistent panic flag (may throw: stay locked)
      if (generation.current !== gen) return false;
      setLocked(false);
      return true;
    } catch {
      return false;
    } finally {
      if (generation.current === gen) unlocking.current = false;
    }
  }, [deviceInsecure]);

  const value = useMemo<SecurityState>(
    () => ({ locked, unlock, lockNow, panic, captured, biometrics, deviceInsecure, inactive }),
    [locked, unlock, lockNow, panic, captured, biometrics, deviceInsecure, inactive],
  );

  const showCover = locked || inactive || captured;
  return (
    <SecurityContext.Provider value={value}>
      {locked ? null : children}
      {showCover ? (cover ?? <LockCover />) : null}
    </SecurityContext.Provider>
  );
}

export function useSecurity(): SecurityState {
  const ctx = useContext(SecurityContext);
  if (!ctx) throw new Error('useSecurity must be used inside <SecurityProvider>');
  return ctx;
}
