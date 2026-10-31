// N4: device authentication through expo-local-authentication
// (https://docs.expo.dev/versions/v58.0.0/sdk/local-authentication/).
// `authenticateAsync` with `disableDeviceFallback: false` lets the OS fall back to the device
// passcode / PIN after biometrics fail or are unavailable (LAPolicyDeviceOwnerAuthentication on iOS,
// BiometricPrompt with device credential on Android). The prompt text is fixed.
import * as LocalAuthentication from 'expo-local-authentication';

import { UNLOCK_CANCEL_LABEL, UNLOCK_FALLBACK_LABEL, UNLOCK_PROMPT } from './constants';

export type Biometrics = 'face' | 'fingerprint' | 'passcode' | 'none';

export type DeviceAuthState = {
  /** What the unlock prompt will use. 'passcode' = secure device without usable biometrics. */
  biometrics: Biometrics;
  /** No passcode, PIN, pattern or biometrics enrolled (SecurityLevel.NONE): nothing to ask for. */
  deviceInsecure: boolean;
};

export async function probeDeviceAuth(): Promise<DeviceAuthState> {
  try {
    const [level, types, enrolled] = await Promise.all([
      LocalAuthentication.getEnrolledLevelAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (level === LocalAuthentication.SecurityLevel.NONE) return { biometrics: 'none', deviceInsecure: true };
    let biometrics: Biometrics = 'passcode';
    if (enrolled) {
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) biometrics = 'face';
      else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT) || types.includes(LocalAuthentication.AuthenticationType.IRIS)) biometrics = 'fingerprint';
    }
    return { biometrics, deviceInsecure: false };
  } catch {
    // Unknown state: fail closed on the label, but do not pretend the device is insecure.
    return { biometrics: 'passcode', deviceInsecure: false };
  }
}

/** True only when the OS reports success. Cancel, lockout and errors are all "still locked". */
export async function authenticateDevice(): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: UNLOCK_PROMPT,
      cancelLabel: UNLOCK_CANCEL_LABEL,
      fallbackLabel: UNLOCK_FALLBACK_LABEL,
      disableDeviceFallback: false,
    });
    return r.success === true;
  } catch {
    return false;
  }
}
