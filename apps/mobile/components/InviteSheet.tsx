// Invite sheet: the link the core built (token in the #fragment only), with Copy and Share, and a QR
// code behind "Show QR code" (HiddenQR: it encodes the whole link, so it is drawn only on request and
// hides again after 30 s or when the app goes inactive; review F-4). The screen shows the link
// masked; the full link goes only to the clipboard, the share sheet or the shown QR, never to any
// server from here. Security review W1-9 / W3-2: `invite.link` renders the full
// link only when the build's config carries `extra.e2e === true`, which app.config.ts sets for the
// `e2e` EAS profile alone (so Maestro can copy it); every other build, OTA bundle or local release
// build masks it. The env var is not read here: a stray EXPO_PUBLIC_E2E in a shell unmasks nothing.
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '../theme';
import { Button } from './Button';
import { HiddenQR } from './HiddenQR';
import { Notice, Toast } from './Notice';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { maskLink } from '@/lib/format';

type Props = { open: boolean; link: string; kind: 'quick' | 'secret' | 'business'; onDone: () => void; expiresLabel?: string; usesLabel?: string };

/** Fail closed: only the literal `true` the `e2e` profile's config writes unmasks the link. */
function isE2EBuild(): boolean {
  return (Constants.expoConfig?.extra as { e2e?: unknown } | undefined)?.e2e === true;
}

export function InviteSheet({ open, link, kind, onDone, expiresLabel = '1 day', usesLabel = 'once' }: Props) {
  const E2E = isE2EBuild();
  const [toast, setToast] = useState('');
  const [err, setErr] = useState('');

  async function copy() {
    try { await Clipboard.setStringAsync(link); setToast('Copied'); }
    catch { setErr('Couldn’t copy the link.'); }
  }
  async function share() {
    try { await Share.share({ message: link, url: link }); }
    catch { setErr('Couldn’t open the share sheet.'); }
  }

  return (
    <Sheet open={open} onClose={onDone} title="Invite someone" testID="invite.sheet">
      <HiddenQR value={link} label="Invite QR code. Scan it with another phone to join this chat." testID="invite.qr" />
      <View style={styles.linkBox}>
        <Text variant="mono" tone="muted" numberOfLines={E2E ? undefined : 1} ellipsizeMode={E2E ? undefined : 'middle'} style={styles.link} testID="invite.link" accessibilityLabel="Invite link, hidden">{E2E ? link : maskLink(link)}</Text>
        <Button title="Copy" icon="copy" small block={false} onPress={copy} testID="invite.copy" />
      </View>
      <Text variant="meta" tone="muted" style={styles.hint}>
        Only this chat. {kind === 'secret' ? 'They’ll also need the access code — share it another way.' : kind === 'business' ? 'You’ll approve each person before they can read anything.' : 'Anyone with the link can join until it’s used up or expires.'} The link works for {expiresLabel} and can be used {usesLabel}.
      </Text>
      {err ? <View style={styles.err}><Notice tone="error" text={err} /></View> : null}
      <View style={styles.actions}>
        <Button title="Share link" icon="share" variant="ghost" onPress={share} testID="invite.share" />
        <Button title="Done" onPress={onDone} testID="invite.done" />
      </View>
      <Toast message={toast} testID="invite.toast" />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.fill, borderRadius: radii.md, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  link: { flex: 1 },
  hint: { marginTop: spacing.sm, marginHorizontal: spacing.xs },
  err: { marginTop: spacing.sm },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
});
