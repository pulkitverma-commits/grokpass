// Composer (design 05): timer pill, attach, multiline input, send. Disabled with an honest
// placeholder until the first sync says this device has been let in and holds the room's keys.
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { colors, fonts, maxFontSizeMultiplier, radii, spacing, touchTarget, type } from '../../theme';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { ttlLabel } from '@/lib/format';

type Props = {
  text: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  onAttach: () => void;
  onTimer: () => void;
  ttl: number;
  joined: boolean;
  synced: boolean;
  busy: boolean;
  replyPreview: string | null;
  onCancelReply: () => void;
};

export function Composer({ text, onChangeText, onSend, onAttach, onTimer, ttl, joined, synced, busy, replyPreview, onCancelReply }: Props) {
  const canSend = joined && !!text.trim() && !busy;
  return (
    <View style={styles.wrap}>
      {replyPreview !== null ? (
        <View style={styles.replying} accessibilityLiveRegion="polite">
          <Icon name="reply" size={14} color={colors.muted} />
          <Text variant="meta" tone="muted" numberOfLines={1} style={styles.replyText}>Replying to “{replyPreview}”</Text>
          <Pressable onPress={onCancelReply} accessibilityRole="button" accessibilityLabel="Cancel reply" hitSlop={10} style={styles.cancel} testID="room.replyCancel">
            <Icon name="close" size={16} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.row}>
        <Pressable onPress={onTimer} accessibilityRole="button" accessibilityLabel={`Message timer: ${ttlLabel(ttl)}`} accessibilityHint="Changes how long your next messages stay readable" style={styles.pill} testID="room.timer">
          <Icon name="clock" size={16} color={colors.text} />
          <Text variant="sub" mono>{ttlLabel(ttl)}</Text>
        </Pressable>
        <Pressable onPress={onAttach} disabled={!joined || busy} accessibilityRole="button" accessibilityLabel="Send an encrypted photo or file" accessibilityState={{ disabled: !joined || busy }} style={[styles.round, (!joined || busy) && styles.off]} testID="room.attach">
          <Icon name="plus" size={22} color={colors.text} />
        </Pressable>
        <TextInput
          value={text}
          onChangeText={onChangeText}
          editable={joined}
          multiline
          maxLength={4000}
          placeholder={joined ? 'Message' : synced ? 'Waiting to be let in…' : 'Loading…'}
          placeholderTextColor={colors.faint}
          selectionColor={colors.accent}
          keyboardAppearance="dark"
          allowFontScaling
          maxFontSizeMultiplier={maxFontSizeMultiplier}
          autoCorrect
          autoComplete="off"
          accessibilityLabel="Message"
          style={styles.input}
          testID="room.composer"
        />
        <Pressable onPress={onSend} disabled={!canSend} accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !canSend }} style={[styles.send, !canSend && styles.off]} testID="room.send">
          <Icon name="send" size={20} color={colors.accentText} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.gutter, paddingTop: spacing.sm, paddingBottom: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.bg, gap: spacing.sm },
  replying: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 12, minHeight: 36, borderRadius: radii.md, backgroundColor: colors.surface },
  replyText: { flex: 1 },
  cancel: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: touchTarget + 4, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.fill, borderWidth: 1, borderColor: colors.line },
  round: { width: touchTarget + 4, height: touchTarget + 4, borderRadius: radii.pill, backgroundColor: colors.fill, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: touchTarget + 4, maxHeight: 140, fontFamily: fonts.ui, ...type.body, color: colors.text, backgroundColor: colors.fill, borderRadius: 24, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  send: { width: touchTarget + 4, height: touchTarget + 4, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.45 },
});
