// Public surface of the security module (consumed by app/_layout.tsx and mobile-ui's screens).
export { SecurityProvider, useSecurity, type SecurityState, type SecurityProviderProps } from './SecurityProvider';
export { useSecureScreen } from './secureScreen';
export { onScreenshot, useScreenshotAlert } from './screenshot';
export { Watermark, shortDeviceCode, watermarkText, type WatermarkProps } from './Watermark';
export { LockCover } from './LockCover';
export { excludeChatDbFromBackup } from './backup';
export { probeDeviceAuth, type Biometrics } from './biometrics';
export {
  AUTO_LOCK_MS, COVER_LABEL, DEVICE_INSECURE_WARNING, PROTECTION_COPY, SCREENSHOT_NOTICE_MINE, screenshotNoticeTheirs, UNLOCK_PROMPT,
} from './constants';
