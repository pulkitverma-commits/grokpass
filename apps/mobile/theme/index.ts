// Design tokens for the OnePeek app. Values come from the web chat's `app/chat/chat.css` (the
// `--c-*` custom properties) and the design frames in docs/mobile/design/*.png, so the phone and
// the browser share one palette. Questrial is the UI face; Geist Mono carries codes, safety numbers,
// timers and section labels.
// Per-weight entry points: the package index requires every weight, which would ship 18 Geist Mono
// files (~1.9 MB) in the bundle for the two the app uses.
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { Questrial_400Regular } from '@expo-google-fonts/questrial/400Regular';

export const colors = {
  bg: '#0A0C0F',
  surface: '#111419',
  raised: '#161A20',
  fill: '#1A1F26',
  segOn: '#262C35',
  text: '#E6E8EB',
  heading: '#F4F5F6',
  muted: '#A3ABB6',
  faint: '#6B7380',
  line: '#262C35',
  ghostBorder: '#343B46',
  accent: '#C8F135',
  accentText: '#0A0C0F',
  accentSoft: 'rgba(200, 241, 53, 0.12)',
  mineText: '#0A0C0F',
  theirs: '#1A1F26',
  secure: '#89DB96',
  secureSoft: 'rgba(137, 219, 150, 0.12)',
  danger: '#ff6b6b',
  dangerSoft: 'rgba(255, 107, 107, 0.12)',
  focus: 'rgba(200, 241, 53, 0.55)',
  white: '#FFFFFF',
  backdrop: 'rgba(0, 0, 0, 0.6)',
} as const;

/** The "mine" bubble and brand gradient (`--c-mine`), as stops for expo-linear-gradient or SVG. */
export const mineGradient = {
  colors: ['#45BDEB', '#89DB96', '#D5FD3A'] as const,
  locations: [0, 0.55, 1] as const,
  angle: 135,
};

export const radii = { lg: 16, md: 12, sm: 8, pill: 999, sheet: 22, bubble: 19 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 26, gutter: 16 } as const;

export const fonts = {
  ui: 'Questrial_400Regular',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const;

/** Passed to expo-font's useFonts in the root layout. */
export const fontAssets = {
  Questrial_400Regular,
  GeistMono_400Regular,
  GeistMono_500Medium,
};

/** Type scale (points). Matches chat.css: body 15/16, meta 13, label 12.5, h1 ~34, h2 20. */
export const type = {
  display: { fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
  h1: { fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  h2: { fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  title: { fontSize: 17, lineHeight: 22 },
  body: { fontSize: 16, lineHeight: 22 },
  sub: { fontSize: 15, lineHeight: 21 },
  meta: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12.5, lineHeight: 16, letterSpacing: 0.8 },
  mono: { fontSize: 14, lineHeight: 18, letterSpacing: 0.4 },
} as const;

/** Dynamic type: text scales with the OS setting, capped so layouts stay usable. */
export const maxFontSizeMultiplier = 1.6;

/** Minimum touch target (points) for every interactive element. */
export const touchTarget = 44;
/** Minimum list row height. */
export const rowHeight = 56;

export const theme = { colors, mineGradient, radii, spacing, fonts, type, maxFontSizeMultiplier, touchTarget, rowHeight };
export type Theme = typeof theme;
