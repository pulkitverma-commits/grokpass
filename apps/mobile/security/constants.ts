// Fixed strings and numbers of the security module. Everything the UI shows about a protection
// comes from here so copy stays honest and identical across screens (and matches the web where the
// web has the same notice). No room names, nicknames or ids are ever interpolated into prompts.

/** Auto-lock: the app locks when it has been in the background or inactive for longer than this. */
export const AUTO_LOCK_MS = 60_000;

/** Key under which the provider holds expo-screen-capture's FLAG_SECURE for the whole app. */
export const APP_SECURE_KEY = 'onepeek.app';

/** Biometric / passcode prompt. Fixed text: never a room name (test-plan §1.4 biometric.test). */
export const UNLOCK_PROMPT = 'Unlock OnePeek';
export const UNLOCK_CANCEL_LABEL = 'Cancel';
export const UNLOCK_FALLBACK_LABEL = 'Use passcode';

/** Shown by the Locked screen when the phone has no passcode, PIN or biometrics enrolled. */
export const DEVICE_INSECURE_WARNING =
  'This phone has no passcode or biometric lock, so OnePeek cannot ask for one. Anyone holding the phone can open your chats. Set a screen lock in the phone settings to protect them.';

/** Text announced by the cover view for screen readers (test-plan A7). */
export const COVER_LABEL = 'OnePeek is hidden';

// Screenshot notices: the web's wording, verbatim (app/chat/r/[id]/page.tsx).
export const SCREENSHOT_NOTICE_MINE = 'You pressed a screenshot shortcut. Everyone in the chat was told.';
export const screenshotNoticeTheirs = (name: string) => `${name} may have taken a screenshot.`;

// What each platform actually does. The release agent copies these; do not soften or inflate.
export const PROTECTION_COPY = {
  androidScreenshots: 'On Android, screenshots and screen recordings of OnePeek come out black, and the app is blank in the recent-apps switcher.',
  iosScreenshots: 'On iOS, a screenshot cannot be blocked. OnePeek is told when one is taken and tells everyone in the chat. While the screen is being recorded or mirrored, the chat is hidden.',
  appSwitcher: 'OnePeek shows a cover instead of your chats while the app is in the background or in the app switcher.',
  camera: 'No app can stop another phone or camera from photographing the screen. A faint watermark with the viewer’s name, device and time is shown over every chat.',
} as const;
