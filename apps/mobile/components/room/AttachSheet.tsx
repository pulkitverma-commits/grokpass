// Attach sheet: pick a photo or a file, choose view-once, send. Copy is the web's FileSheet. The
// picked file is encrypted on this phone by the core before upload; the sheet only shows its name
// and size, and never keeps bytes of its own.
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { colors, radii, spacing, touchTarget } from '../../theme';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Notice } from '../Notice';
import { Sheet } from '../Sheet';
import { Text } from '../Text';
import { fileSize, type Picked } from '@/lib/files';
import { ttlLabel } from '@/lib/format';

type Props = {
  open: boolean;
  onClose: () => void;
  secret: boolean;
  ttl: number;
  picked: Picked | null;
  error: string;
  onPickPhoto: () => void;
  onPickFile: () => void;
  onSend: (viewOnce: boolean) => void;
};

export function AttachSheet({ open, onClose, secret, ttl, picked, error, onPickPhoto, onPickFile, onSend }: Props) {
  const [viewOnce, setViewOnce] = useState(secret);
  // Each time the sheet opens it starts from the room's default (view once in Secret rooms).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (open) setViewOnce(secret); }
  return (
    <Sheet open={open} onClose={onClose} title="Send a file" testID="attach.sheet">
      <View style={styles.sources}>
        <Pressable onPress={onPickPhoto} accessibilityRole="button" accessibilityLabel="Choose a photo" style={({ pressed }) => [styles.source, pressed && styles.pressed]} testID="attach.photo">
          <Icon name="image" size={22} color={colors.accent} />
          <Text variant="title">Photo</Text>
        </Pressable>
        <Pressable onPress={onPickFile} accessibilityRole="button" accessibilityLabel="Choose a file" style={({ pressed }) => [styles.source, pressed && styles.pressed]} testID="attach.file">
          <Icon name="file" size={22} color={colors.accent} />
          <Text variant="title">File</Text>
        </Pressable>
      </View>
      {picked ? (
        <View style={styles.pickedRow} accessible accessibilityLabel={`Selected file, ${fileSize(picked.size)}`} testID="attach.picked">
          <View style={styles.fileIcon}><Icon name={(picked.mime ?? '').startsWith('image/') ? 'image' : 'file'} size={20} color={colors.accent} /></View>
          <View style={styles.fileMain}>
            <Text variant="title" numberOfLines={1}>{picked.name}</Text>
            <Text variant="meta" tone="muted">{fileSize(picked.size)} · disappears {ttlLabel(ttl)} after it’s read</Text>
          </View>
        </View>
      ) : (
        <Text variant="meta" tone="muted" style={styles.hint}>Pick a photo or a file to send.</Text>
      )}
      <View style={styles.toggleRow}>
        <View style={styles.toggleText}>
          <Text variant="title">View once</Text>
          <Text variant="meta" tone="muted">It can be opened one time, then it’s gone for everyone. You won’t be able to open it either.</Text>
        </View>
        <Switch value={viewOnce} onValueChange={setViewOnce} trackColor={{ true: colors.accent, false: colors.segOn }} thumbColor={colors.white} accessibilityLabel="View once" testID="attach.viewOnce" />
      </View>
      <Text variant="meta" tone="muted" style={styles.hint}>Encrypted on this device before upload. OnePeek never sees the file, its name or its key.</Text>
      <Text variant="meta" tone="muted" style={styles.hintTight} testID="attach.exif">Photos keep their embedded details, such as location, unless your phone removes them.</Text>
      {error ? <View style={styles.err}><Notice tone="error" text={error} testID="attach.error" /></View> : null}
      <View style={styles.actions}>
        <Button title="Encrypt and send" disabled={!picked} onPress={() => onSend(viewOnce)} testID="attach.send" />
        <Button title="Cancel" variant="ghost" onPress={onClose} testID="attach.cancel" />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sources: { flexDirection: 'row', gap: spacing.sm },
  source: { flex: 1, minHeight: touchTarget + 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.md, backgroundColor: colors.fill, borderWidth: 1, borderColor: colors.line },
  pressed: { opacity: 0.85 },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.fill },
  fileIcon: { width: 40, height: 40, borderRadius: radii.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  fileMain: { flex: 1, gap: 2 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, minHeight: touchTarget },
  toggleText: { flex: 1, gap: 2 },
  hint: { marginTop: spacing.md, marginHorizontal: spacing.xs },
  hintTight: { marginTop: spacing.xs, marginHorizontal: spacing.xs },
  err: { marginTop: spacing.sm },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
});
