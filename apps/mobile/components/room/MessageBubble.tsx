// One message in the conversation (designs 05/06). Own messages sit right on the brand gradient;
// others sit left on the dark fill. In Secret rooms someone else's text is NOT in the tree until
// the bubble is pressed and held (`held`): the outer Pressable carries `msg.<id>` so a long press
// hits it, the first hold starts the timer upstream, and releasing hides the text again. Nothing
// about the content goes into accessibility labels: the hidden state announces "Hold to read" and
// the shown state lets VoiceOver read the bubble text itself.
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radii, spacing, touchTarget } from '../../theme';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { MineGradient } from './MineGradient';
import { fileSize } from '@/lib/files';
import { timerText } from '@/lib/format';

export type BubbleMessage = {
  id: string;
  mine: boolean;
  sender: string;
  body: string;
  ttl: number;
  sentAt: number;
  expiresAt: number | null;
  replyTo?: string;
  file?: { name: string; mime: string; size: number; viewOnce: boolean };
  viewed?: boolean;
  pending?: boolean;
};

type Props = {
  m: BubbleMessage;
  /** The message this one replies to, if it is still on this device. */
  parent?: BubbleMessage;
  secret: boolean;
  held: boolean;
  now: number;
  senderName: string;
  fileBusy: boolean;
  onHoldStart: (m: BubbleMessage) => void;
  onHoldEnd: () => void;
  onOpenFile: (m: BubbleMessage) => void;
  onReply: (m: BubbleMessage) => void;
};

function replyPreview(p: BubbleMessage, secret: boolean) {
  if (p.file) return secret ? 'File' : p.file.name;
  return p.body;
}

export const MessageBubble = memo(function MessageBubble({ m, parent, secret, held, now, senderName, fileBusy, onHoldStart, onHoldEnd, onOpenFile, onReply }: Props) {
  // Secret rooms guard someone else's text behind a hold; files show their row (the bytes stay encrypted until opened).
  const guarded = secret && !m.mine && !m.file;
  const hidden = guarded && !held;
  const left = m.expiresAt === null ? null : m.expiresAt - now;
  const soon = left !== null && left < 10_000;
  const f = m.file;

  const fileTitle = f
    ? f.viewOnce ? (m.mine ? 'View-once file' : m.viewed ? 'Opened' : f.mime.startsWith('image/') ? 'View-once photo' : 'View-once file')
      : secret && !m.mine ? 'Encrypted file' : f.name
    : '';
  const fileSub = f
    ? fileBusy ? 'Decrypting…'
      : f.viewOnce ? (m.mine ? `Sent · ${fileSize(f.size)}` : m.viewed ? 'Already viewed' : `Tap to view once · ${fileSize(f.size)}`)
      : `${fileSize(f.size)} · tap to open`
    : '';
  const fileDisabled = !!f && ((f.viewOnce && (m.mine || !!m.viewed)) || fileBusy);

  const body = hidden ? (
    <View style={styles.holdRow}>
      <Icon name="eye" size={16} color={colors.muted} />
      <Text variant="body" tone="muted">Hold to read</Text>
    </View>
  ) : f ? (
    <Pressable
      onPress={() => onOpenFile(m)}
      disabled={fileDisabled}
      accessibilityRole="button"
      accessibilityLabel={`${fileTitle}. ${fileSub}`}
      accessibilityState={{ disabled: fileDisabled }}
      style={styles.fileRow}
      testID={`file.${m.id}`}
    >
      <View style={styles.fileIcon}><Icon name={f.mime.startsWith('image/') ? 'image' : 'file'} size={22} color={colors.accent} /></View>
      <View style={styles.fileMain}>
        <Text variant="title" tone={m.mine ? 'inverse' : 'text'} numberOfLines={1}>{fileTitle}</Text>
        <Text variant="meta" tone={m.mine ? 'inverse' : 'muted'} numberOfLines={1}>{fileSub}</Text>
      </View>
    </Pressable>
  ) : (
    <Text variant="body" tone={m.mine ? 'inverse' : 'text'} selectable={!secret}>{m.body}</Text>
  );

  const bubble = (
    <View style={[styles.bubble, m.mine ? styles.mine : styles.theirs, hidden && styles.hiddenBubble, m.pending && styles.pending]}>
      {m.mine ? <MineGradient /> : null}
      {parent && !hidden ? (
        <View style={[styles.reply, m.mine && styles.replyMine]}>
          <Text variant="meta" tone={m.mine ? 'inverse' : 'muted'} numberOfLines={2}>{replyPreview(parent, secret)}</Text>
        </View>
      ) : null}
      {body}
    </View>
  );

  return (
    <View style={[styles.row, m.mine ? styles.rowMine : styles.rowTheirs]} testID={`row.${m.id}`}>
      {guarded ? (
        <Pressable
          onPressIn={() => onHoldStart(m)}
          onPressOut={onHoldEnd}
          delayLongPress={120}
          onLongPress={() => {}}
          accessibilityRole="button"
          accessibilityLabel={hidden ? 'Hold to read this message' : 'Message shown while held'}
          accessibilityHint="Press and hold to show the message. It starts its timer the first time."
          testID={`msg.${m.id}`}
          style={({ pressed }) => [styles.press, pressed && styles.pressing]}
        >
          {bubble}
        </Pressable>
      ) : (
        <View testID={`msg.${m.id}`} style={styles.press}>{bubble}</View>
      )}
      <View style={[styles.meta, m.mine && styles.metaMine]}>
        {!m.mine ? <Text variant="meta" tone="muted">{senderName} · </Text> : null}
        {m.pending ? (
          <Text variant="meta" tone="muted">Sending…</Text>
        ) : (
          <>
            <Text variant="meta" tone={soon ? 'danger' : 'muted'} mono testID={`timer.${m.id}`}>{timerText(m.ttl, m.expiresAt, now)}</Text>
            {!hidden ? (
              <Pressable onPress={() => onReply(m)} accessibilityRole="button" accessibilityLabel="Reply to this message" hitSlop={12} style={styles.replyBtn} testID={`reply.${m.id}`}>
                <Icon name="reply" size={14} color={colors.muted} />
                <Text variant="meta" tone="muted">Reply</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { marginVertical: 5, maxWidth: '82%' },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  press: { minHeight: touchTarget },
  pressing: { opacity: 0.96 },
  bubble: { borderRadius: radii.bubble, paddingHorizontal: 16, paddingVertical: 12, overflow: 'hidden', minHeight: touchTarget, justifyContent: 'center' },
  mine: { backgroundColor: colors.secure },
  theirs: { backgroundColor: colors.theirs },
  hiddenBubble: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.ghostBorder, backgroundColor: colors.surface },
  pending: { opacity: 0.6 },
  holdRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reply: { borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: 8, marginBottom: 6, opacity: 0.85 },
  replyMine: { borderLeftColor: colors.accentText },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget },
  fileIcon: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  fileMain: { flexShrink: 1, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginHorizontal: 6, minHeight: 24 },
  metaMine: { justifyContent: 'flex-end' },
  replyBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 6, minHeight: 24 },
});
