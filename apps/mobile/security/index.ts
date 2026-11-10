// Public surface of the security module (consumed by app/_layout.tsx and mobile-ui's screens).
export { SecurityProvider, useSecurity, type SecurityState, type SecurityProviderProps } from './SecurityProvider';
export { useSecureScreen } from './secureScreen';
export { onScreenshot, useScreenshotAlert } from './screenshot';
export { Watermark, shortDeviceCode, watermarkText, type WatermarkProps } from './Watermark';
export { LockCover } from './LockCover';
export { excludeChatDbFromBackup } from './backup';
export { probeDeviceAuth, type Biometrics } from './biometrics';
// N6: links, share intent (Android module) / share extension (iOS, expo-share-intent).
export { parseOnePeekLink, isSecretLink, isInviteLink, isShareWakeUrl, forgetLinkingURL, type OnePeekLink } from './links';
export { useShareIntent, consumeShare, deleteShareDir, sweepShareCache, readPendingShare, shareParams, resetPackageShare, SHARE_ROUTE, SHARE_SECURE_KEY, SHARE_SWEEP_AGE_MS, packageHookOptions, type PendingShare, type ShareParams } from './shareIntent';
export { importShareIntent, releaseImport, sweepGroupContainer, APP_GROUP, SHARE_DIR, GROUP_SWEEP_GRACE_MS } from './iosShare';
export {
  AUTO_LOCK_MS, COVER_LABEL, MAX_SHARE_ITEMS, MAX_SHARE_ITEM_BYTES, MAX_SHARE_BYTES, DEVICE_INSECURE_WARNING, PROTECTION_COPY, SCREENSHOT_NOTICE_MINE, screenshotNoticeTheirs, UNLOCK_PROMPT,
} from './constants';
