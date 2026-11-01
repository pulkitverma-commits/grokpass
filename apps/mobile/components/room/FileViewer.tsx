// Full-screen viewer for a decrypted attachment. Images render inline (expo-image from a data: URI
// or a temp file in the cache directory that is deleted on close); small text files render inline;
// anything else shows name and size and can be handed to the system share sheet only after an
// explicit tap. In Secret rooms an inline preview is on screen only while held, as on the web.
// `gone` is the view-once second-open state. The watermark names the viewer while content shows.
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Watermark } from '@/security';
import { colors, radii, spacing, touchTarget } from '../../theme';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Notice } from '../Notice';
import { Text } from '../Text';
import { DATA_URI_LIMIT, dataUri, deleteTemp, extensionOf, fileSize, shareBytes, writeTemp } from '@/lib/files';

export type Opened = { bytes: Uint8Array; mime: string; name: string; size: number; viewOnce: boolean };

type Props = {
  /** The decrypted file, or `'gone'` for a view-once file that was already opened. */
  item: Opened | 'gone' | null;
  secret: boolean;
  viewerName: string;
  deviceCode: string;
  onClose: () => void;
};

const TEXT_LIMIT = 200_000;

export function FileViewer({ item, secret, viewerName, deviceCode, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [held, setHeld] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [text, setText] = useState<string | undefined>(undefined);
  const [err, setErr] = useState('');
  const [sharing, setSharing] = useState(false);

  const opened = item && item !== 'gone' ? item : null;
  const isImage = !!opened && opened.mime.startsWith('image/');
  const isText = !!opened && opened.mime.startsWith('text/') && opened.size < TEXT_LIMIT;

  // A new file resets the view (state adjusted during render, the React pattern for prop changes).
  const [lastOpened, setLastOpened] = useState(opened);
  if (opened !== lastOpened) {
    setLastOpened(opened);
    setHeld(false); setErr(''); setText(undefined); setUri(null);
  }

  // Decode once per opened file; the temp copy (if any) is removed when the viewer closes.
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    let tempUri: string | null = null;
    (async () => {
      try {
        if (isImage) {
          if (opened.bytes.length <= DATA_URI_LIMIT) {
            if (alive) setUri(dataUri(opened.bytes, opened.mime));
          } else {
            tempUri = await writeTemp(opened.bytes, extensionOf(opened.name, opened.mime));
            if (alive) { setUri(tempUri); setTemp(tempUri); } else deleteTemp(tempUri);
          }
        } else if (isText) {
          if (alive) setText(new TextDecoder().decode(opened.bytes));
        }
      } catch {
        if (alive) setErr('This file couldn’t be shown.');
      }
    })();
    return () => {
      alive = false;
      if (tempUri) deleteTemp(tempUri);
      setTemp(null);
    };
  }, [opened, isImage, isText]);

  function close() {
    if (temp) deleteTemp(temp);
    setTemp(null); setUri(null); setText(undefined); setHeld(false);
    onClose();
  }

  async function share() {
    if (!opened || sharing) return;
    setSharing(true); setErr('');
    try { await shareBytes(opened.bytes, opened.mime, extensionOf(opened.name, opened.mime)); }
    catch { setErr('Couldn’t open the share sheet.'); }
    finally { setSharing(false); }
  }

  const preview = isImage || isText;
  const guarded = secret && preview;
  const showContent = !guarded || held;

  const content = opened ? (
    isImage ? (uri ? <Image source={{ uri }} style={styles.image} contentFit="contain" accessibilityLabel="Image" cachePolicy="none" /> : <Text variant="sub" tone="muted">Decoding…</Text>)
    : isText && text !== undefined ? <ScrollView style={styles.textScroll}><Text variant="mono" selectable={!secret && !opened.viewOnce}>{text}</Text></ScrollView>
    : (
      <View style={styles.generic}>
        <Icon name="file" size={40} color={colors.muted} />
        <Text variant="title" center numberOfLines={2}>{secret ? 'Encrypted file' : opened.name}</Text>
        <Text variant="meta" tone="muted" center>{fileSize(opened.size)}</Text>
      </View>
    )
  ) : null;

  return (
    <Modal visible={item !== null} animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: Math.max(insets.bottom, spacing.lg) }]} testID="viewer.screen" accessibilityViewIsModal>
        <View style={styles.top}>
          <Text variant="title" numberOfLines={1} style={styles.title}>{opened ? (secret ? 'Encrypted file' : opened.name) : 'View once'}</Text>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={styles.closeBtn} testID="viewer.close">
            <Icon name="close" size={24} color={colors.text} />
          </Pressable>
        </View>

        {item === 'gone' ? (
          <View style={styles.gone} testID="viewer.gone">
            <Icon name="ban" size={36} color={colors.muted} />
            <Text variant="h2" tone="heading" center>Already viewed</Text>
            <Text variant="sub" tone="muted" center>That file has already been opened or has expired.</Text>
          </View>
        ) : guarded ? (
          <Pressable
            onPressIn={() => setHeld(true)}
            onPressOut={() => setHeld(false)}
            delayLongPress={120}
            onLongPress={() => {}}
            accessibilityRole="button"
            accessibilityLabel={held ? 'File shown while held' : 'Press and hold to view'}
            style={styles.body}
            testID="viewer.hold"
          >
            {showContent ? (
              <>
                {content}
                <Watermark viewerName={viewerName} deviceCode={deviceCode} />
              </>
            ) : (
              <View style={styles.holdHint}>
                <Icon name="eye" size={22} color={colors.muted} />
                <Text variant="title" tone="muted">Press and hold to view</Text>
              </View>
            )}
          </Pressable>
        ) : (
          <View style={styles.body}>
            {content}
            <Watermark viewerName={viewerName} deviceCode={deviceCode} />
          </View>
        )}

        {opened?.viewOnce ? <Text variant="meta" tone="muted" center style={styles.note}>View once: this is the only time it opens. Closing it removes it from this device.</Text> : null}
        {err ? <View style={styles.err}><Notice tone="error" text={err} /></View> : null}
        <View style={styles.bar}>
          {opened && (!opened.viewOnce || !preview) ? <Button title={sharing ? 'Opening…' : 'Share or save…'} variant="ghost" busy={sharing} onPress={share} testID="viewer.share" /> : null}
          <Button title="Close" onPress={close} testID="viewer.done" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.gutter },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: touchTarget },
  title: { flex: 1 },
  closeBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  body: { flex: 1, marginVertical: spacing.md, borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  textScroll: { alignSelf: 'stretch', padding: spacing.lg },
  generic: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  holdHint: { alignItems: 'center', gap: spacing.sm },
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  note: { marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  err: { marginBottom: spacing.sm },
  bar: { gap: spacing.sm },
});
