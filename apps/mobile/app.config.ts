// OnePeek mobile app config (owned by the lead). Native behaviour is configured here and through
// config plugins only; ios/ and android/ are generated (CNG) and never edited by hand.
import type { ConfigContext, ExpoConfig } from 'expo/config';

const BUNDLE_ID = 'io.onepeek.app';

// `extra.e2e` makes the invite sheet render the full invite link (a bearer token) so Maestro can read
// it. It is true only when EAS Build runs the `e2e` profile (`EAS_BUILD_PROFILE=e2e`): fail closed
// (security review W2-6 / W3-2). `expo export` for `eas update`, `expo run:ios --configuration
// Release` and a release archive from the generated projects evaluate this config with no profile
// and therefore never unmask. `EXPO_PUBLIC_E2E` alone unmasks nothing any more; the throw below stays
// as belt and braces so a stray flag on a preview/production build fails loudly instead of quietly.
// Evaluated inside the export so `__tests__/app.config.test.ts` can run it under several environments.
function e2eFlag(): boolean {
  const flag = process.env.EXPO_PUBLIC_E2E === '1';
  const profile = process.env.EAS_BUILD_PROFILE ?? '';
  if (flag && (profile === 'preview' || profile === 'production')) {
    throw new Error(`EXPO_PUBLIC_E2E=1 is not allowed for the "${profile}" build profile`);
  }
  return profile === 'e2e';
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'OnePeek',
  slug: 'onepeek',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'onepeek',
  userInterfaceStyle: 'dark',
  icon: './assets/images/icon.png',
  // Over-the-air updates may never change crypto or key handling (section 3 of the build prompt).
  // Those changes ship as store builds; runtimeVersion is tied to the native build.
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    // Universal Links for onepeek.io secret links and chat invites (AASA served by the web app).
    associatedDomains: ['applinks:onepeek.io', 'applinks:www.onepeek.io'],
    infoPlist: {
      // Encryption questionnaire: end-to-end encryption; the release agent drafts the answers.
      ITSAppUsesNonExemptEncryption: true,
      NSCameraUsageDescription: 'OnePeek uses the camera to scan invite and secret QR codes, and to take photos you choose to send in a chat. The camera image never leaves this phone unencrypted.',
      NSFaceIDUsageDescription: 'OnePeek uses Face ID to unlock your chats on this phone.',
      NSPhotoLibraryUsageDescription: 'OnePeek needs photo access only for pictures you choose to send. They are encrypted on this phone before upload.',
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#0A0C0F',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    // No backups of app data: keys and message copies stay on this device only.
    // FCM client config is a secret file supplied by EAS (file-type env var); see docs/mobile/release/fcm-client-config.md.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    allowBackup: false,
    predictiveBackGestureEnabled: false,
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: 'onepeek.io', pathPrefix: '/s/' },
          { scheme: 'https', host: 'onepeek.io', pathPrefix: '/chat/join' },
          { scheme: 'https', host: 'www.onepeek.io', pathPrefix: '/s/' },
          { scheme: 'https', host: 'www.onepeek.io', pathPrefix: '/chat/join' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
      // native-security (N6): receive from the Android share sheet. Read by modules/share-intent; the
      // copies land in <cache>/share-intent/ and are swept by apps/mobile/security/shareIntent.ts.
      {
        action: 'SEND',
        data: [{ mimeType: 'text/plain' }, { mimeType: 'image/*' }, { mimeType: '*/*' }],
        category: ['DEFAULT'],
      },
      {
        action: 'SEND_MULTIPLE',
        data: [{ mimeType: 'image/*' }, { mimeType: '*/*' }],
        category: ['DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#0A0C0F', image: './assets/images/splash-icon.png', imageWidth: 160 }],
    // native-security: its backup rules are superseded by ./plugins/withBackupRules.js (excludes every
    // domain, SharedPreferences included), so SecureStore must not install its own.
    ['expo-secure-store', { configureAndroidBackup: false }],
    'expo-sqlite',
    'expo-local-authentication',
    'expo-notifications',
    // No feature records audio: keep the microphone permission and usage string out of the build (release, Phase 3).
    ['expo-camera', { recordAudioAndroid: false, microphonePermission: false }],
    ['expo-image-picker', { microphonePermission: false }],
    'expo-document-picker',
    'expo-apple-authentication',
    // native-security (N1, N3): FLAG_SECURE on MainActivity; Android backup/transfer rules.
    './plugins/withSecureWindow.js',
    './plugins/withBackupRules.js',
    // native-security (N6b): App Group entitlement on the app target. Must stay BEFORE 'expo-share-intent'
    // (it dedupes the group that plugin prepends); same id as `iosAppGroupIdentifier` below.
    ['./plugins/withAppGroup.js', { appGroup: 'group.io.onepeek.app' }],
    // native-security (N6b): iOS share sheet via expo-share-intent: Share Extension target "OnePeekShare"
    // (display name "OnePeek Share", bundle id io.onepeek.app.share-extension), App Group, activation rules
    // (text, 1 URL, up to 10 images / movies / files; no WebPage rule: no JS preprocessor in Safari pages).
    // Android stays on modules/share-intent: disableAndroid skips the package's intent filters and launchMode,
    // and security/shareIntent.ts disables its hook off iOS. Consumed by security/shareIntent.ts + iosShare.ts.
    [
      'expo-share-intent',
      {
        iosActivationRules: {
          NSExtensionActivationSupportsText: true,
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsImageWithMaxCount: 10,
          NSExtensionActivationSupportsMovieWithMaxCount: 10,
          NSExtensionActivationSupportsFileWithMaxCount: 10,
        },
        iosAppGroupIdentifier: 'group.io.onepeek.app',
        iosShareExtensionName: 'OnePeek Share',
        disableAndroid: true,
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    // Fixed on purpose (security review S0b M2): invite links and the notify endpoint must never be
    // redirectable through an env var or OTA update. The core validates it again.
    siteUrl: 'https://onepeek.io',
    // The only producer is the `e2e` EAS profile; InviteSheet checks `=== true`.
    e2e: e2eFlag(),
  },
});
