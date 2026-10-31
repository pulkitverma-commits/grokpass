// Invite sheet: the link the core built (token in the #fragment only), as a QR code, with Copy and
// Share. The screen shows the link masked; the full link goes only to the clipboard or the share
// sheet, never to any server from here.
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colors, radii, spacing } from '../theme';
import { Button } from './Button';
import { Notice, Toast } from './Notice';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { maskLink } from '@/lib/format';

type Props = { open: boolean; link: string; kind: 'quick' | 'secret' | 'business'; onDone: () => void; expiresLabel?: string; usesLabel?: string };

export function InviteSheet({ open, link, kind, onDone, expiresLabel = '1 day', usesLabel = 'once' }: Props) {
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
      <View style={styles.qrWrap} accessible accessibilityLabel="Invite QR code. Scan it with another phone to join this chat.">
        <View style={styles.qrBox}><QRCode value={link} size={180} color="#000" backgroundColor="#fff" /></View>
      </View>
      <View style={styles.linkBox}>
        <Text variant="mono" tone="muted" numberOfLines={1} ellipsizeMode="middle" style={styles.link} testID="invite.link" accessibilityLabel="Invite link, hidden">{maskLink(link)}</Text>
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
  qrWrap: { alignItems: 'center', marginVertical: spacing.md },
  qrBox: { padding: 12, backgroundColor: '#fff', borderRadius: radii.lg },
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.fill, borderRadius: radii.md, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  link: { flex: 1 },
  hint: { marginTop: spacing.sm, marginHorizontal: spacing.xs },
  err: { marginTop: spacing.sm },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
});
