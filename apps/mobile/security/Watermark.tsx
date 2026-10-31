// N5: a faint, repeated, rotated stamp of who is looking and when, so a photo or screenshot of the
// screen shows its source. Same text as the web (app/chat/r/[id]/page.tsx `mark`):
//   `${viewerName} · ${deviceCode} · ${stamp}`  with stamp = toLocaleString(day numeric, month short,
//   hour 2-digit, minute 2-digit). Rendered 24 times, rotated -22°, opacity .1, like `.c-wm`.
// It never takes touches (pointerEvents none) and is hidden from screen readers.
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type WatermarkProps = {
  /** The viewer's nickname (or the web's fallback `Device XXXX`). */
  viewerName: string;
  /** Short device code, see `shortDeviceCode`. Never a user id. */
  deviceCode: string;
  /** Test hook: fixed time instead of the clock. */
  now?: number;
  /** Optional monospace font family once the lead has loaded one (e.g. Geist Mono). */
  fontFamily?: string;
  /** Overrides the default opacity (0.1, the web's Secret Chat value). */
  opacity?: number;
};

const COPIES = 24;
const REFRESH_MS = 60_000;

/** The web's `shortId`: first 4 hex characters of the device id, upper-case (app/chat/format.ts). */
export function shortDeviceCode(deviceId: string): string {
  return deviceId.replace(/-/g, '').slice(0, 4).toUpperCase();
}

/** The web's `stamp` format string. */
export function watermarkStamp(now: number): string {
  return new Date(now).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function watermarkText(viewerName: string, deviceCode: string, now: number): string {
  return `${viewerName} · ${deviceCode} · ${watermarkStamp(now)}`;
}

export function Watermark({ viewerName, deviceCode, now, fontFamily, opacity = 0.1 }: WatermarkProps) {
  const [tick, setTick] = useState(() => Date.now());
  const live = now === undefined;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setTick(Date.now()), REFRESH_MS);
    return () => clearInterval(id);
  }, [live]);
  const text = watermarkText(viewerName, deviceCode, now ?? tick);
  return (
    <View
      testID="security.watermark"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.layer, { opacity }]}
    >
      {Array.from({ length: COPIES }, (_, i) => (
        <Text key={i} style={[styles.text, fontFamily ? { fontFamily } : null]} numberOfLines={1}>
          {text}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: '-30%',
    left: '-30%',
    right: '-30%',
    bottom: '-30%',
    zIndex: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'space-around',
    justifyContent: 'space-around',
    rowGap: 54,
    columnGap: 80,
    transform: [{ rotate: '-22deg' }],
    overflow: 'hidden',
  },
  text: { fontSize: 12, color: '#FFFFFF' },
});
