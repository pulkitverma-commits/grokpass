// A QR code that is not on screen until asked for (review F-4). An invite QR or a one-time secret QR
// encodes the whole link, token or key included, and a QR is machine-readable at phone-camera
// distance: a photo of the screen, an iOS screenshot (which no app can block) or a recording would
// carry what the masked text beside it hides. So the code is drawn only after "Show QR code", and goes
// again after QR_VISIBLE_MS, when the app stops being active (app switcher, lock, a call), or when the
// sheet closes. The value is handed to the QR renderer only while shown; it is never put in a label.
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { radii, spacing } from '../theme';
import { Button } from './Button';
import { Text } from './Text';

/** How long a shown QR stays on screen. */
export const QR_VISIBLE_MS = 30_000;

type Props = {
  value: string;
  /** Read by screen readers while the code is shown, e.g. "Invite QR code. Scan it with another phone…". */
  label: string;
  /** testID prefix: `<id>.show` (the button), `<id>.code` (the shown code), `<id>.hide`. */
  testID: string;
};

export function HiddenQR({ value, label, testID }: Props) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(false), QR_VISIBLE_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') setShown(false); });
    return () => { clearTimeout(t); sub.remove(); };
  }, [shown]);

  if (!shown) {
    return (
      <View style={styles.wrap}>
        <Button title="Show QR code" icon="qr" variant="ghost" small block={false} onPress={() => setShown(true)} accessibilityHint="Shows a code another phone can scan. It hides again after 30 seconds." testID={`${testID}.show`} />
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <View accessible accessibilityLabel={label} testID={`${testID}.code`}>
        <View style={styles.box}><QRCode value={value} size={180} color="#000" backgroundColor="#fff" /></View>
      </View>
      <Text variant="meta" tone="muted" center>Hides after 30 seconds or when you leave OnePeek.</Text>
      <Button title="Hide QR code" variant="link" small block={false} onPress={() => setShown(false)} testID={`${testID}.hide`} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm, marginVertical: spacing.md },
  box: { padding: 12, backgroundColor: '#fff', borderRadius: radii.lg },
});
