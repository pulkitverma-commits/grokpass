// OnePeek mobile app config (owned by the lead). Native behaviour is configured here and through
// config plugins only; ios/ and android/ are generated (CNG) and never edited by hand.
import type { ConfigContext, ExpoConfig } from 'expo/config';

const BUNDLE_ID = 'io.onepeek.app';

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
    ],
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#0A0C0F', image: './assets/images/splash-icon.png', imageWidth: 160 }],
    'expo-secure-store',
    'expo-sqlite',
    'expo-local-authentication',
    'expo-notifications',
    'expo-camera',
    'expo-image-picker',
    'expo-document-picker',
    'expo-apple-authentication',
  ],
  experiments: { typedRoutes: true },
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    // Fixed on purpose (security review S0b M2): invite links and the notify endpoint must never be
    // redirectable through an env var or OTA update. The core validates it again.
    siteUrl: 'https://onepeek.io',
  },
});
