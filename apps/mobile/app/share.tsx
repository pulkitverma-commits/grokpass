// Share target (design 10): another app handed OnePeek some text or a file through the native share
// sheet (native-security's share extension / share intent routes here with `{ text?, uris?, nonce?,
// dropped? }`: `nonce` names this share's own cache directory, `dropped` counts items the receiver
// skipped, P3-3 / P3-6).
// Choices: send it into one of this phone's chats (the room's own send / sendFile, view-once for
// files), or make a onepeek.io link with the secret composer. Shared text that is itself a secret
// or invite link goes straight to the viewer / join flow (P2-5: classified on arrival, parked in
// lib/links' hand-off and the route REPLACED, so `/share?text=<link>` does not stay in the router
// history; the bridge-side fix, classifying before routing so the text never travels as a param,
// belongs to native-security's `security/shareIntent.ts`). The shared content stays in component
// state; the file is read by the core when it is encrypted and is never copied by this screen.
// Whatever the bridge left in <cache>/share-intent/<nonce>/ is removed with `consumeShare(nonce)` as
// soon as this screen is done with it: after a send (success or failure), on cancel, after a link was
// made, or when the text was a OnePeek link (P2-3). Exactly once per share, and only this share's
// directory: a second share that arrived meanwhile keeps its copies (P3-3).
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { consumeShare, useSecureScreen } from '@/security';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { useChat } from '../components/ChatProvider';
import { Field } from '../components/Field';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { SecretComposer } from '../components/SecretComposer';
import { SectionLabel } from '../components/SectionLabel';
import { Text } from '../components/Text';
import { colors, radii, spacing, touchTarget } from '../theme';
import { MAX_ATTACHMENT_BYTES, fileSize, fileSource, pickedFromUri, type Picked } from '@/lib/files';
import { KIND_NAME, errorCode, friendlyError, roomTitle, ttlLabel } from '@/lib/format';
import { classify, stashHandoff } from '@/lib/links';

type Chat = ReturnType<ReturnType<typeof useChat>['chat']>;
type Room = Awaited<ReturnType<Chat['myRooms']>>[number];

const SECRET_INPUT = {
  autoCorrect: false,
  spellCheck: false,
  autoCapitalize: 'none',
  autoComplete: 'off',
  importantForAutofill: 'no',
  textContentType: 'none',
} as const;

const kindIcon = (k: Room['kind']) => (k === 'secret' ? 'lock' : k === 'business' ? 'shield' : 'clock');

function firstUri(v: string | string[] | undefined): string | null {
  if (!v) return null;
  const list = Array.isArray(v) ? v : v.split(',');
  const u = list.map((s) => s.trim()).find(Boolean);
  return u ?? null;
}

export default function ShareScreen() {
  const params = useLocalSearchParams<{ text?: string; uris?: string | string[]; nonce?: string; dropped?: string }>();
  const router = useRouter();
  const { chat, guard } = useChat();
  useSecureScreen('share');

  const sharedText = typeof params.text === 'string' ? params.text : '';
  const uri = useMemo(() => firstUri(params.uris), [params.uris]);
  const extra = useMemo(
    () => (Array.isArray(params.uris) ? params.uris.length : (params.uris ?? '').split(',').filter(Boolean).length) - 1,
    [params.uris],
  );
  const nonce = typeof params.nonce === 'string' ? params.nonce : undefined;
  const skipped = Number(params.dropped) > 0;
  const [file] = useState<Picked | null>(() => (uri ? pickedFromUri(uri) : null));
  const [text, setText] = useState(sharedText);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [viewOnce, setViewOnce] = useState(true);
  const [mode, setMode] = useState<'chat' | 'link'>('chat');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // The plaintext copies the bridge left for this share go the moment this screen is finished with
  // them (P2-3). Once: a send and the cancel that follows, or a link and its Done, share one share.
  const consumed = useRef(false);
  const consume = useCallback(() => {
    if (consumed.current) return;
    consumed.current = true;
    void consumeShare(nonce).catch(() => {
      /* best effort: a later launch sweeps the directory once it is old enough */
    });
  }, [nonce]);

  // A shared OnePeek link is not something to forward: it is opened. The text is consumed here and
  // the route replaced, so the link does not stay reachable as a `/share` param (P2-5).
  const routed = useMemo(() => (!file ? classify(sharedText) : { kind: 'none' as const }), [file, sharedText]);
  useEffect(() => {
    if (routed.kind === 'secret') {
      stashHandoff('secret', routed.url);
      consume();
      router.replace(`/s/${routed.id}`);
    } else if (routed.kind === 'invite') {
      stashHandoff('invite', routed.url);
      consume();
      router.replace('/chat/join');
    }
  }, [routed, router, consume]);
  // Any other way out (iOS swipe-dismiss, Android back, a redirect) must not leave the copy behind (P3-1).
  useEffect(() => () => consume(), [consume]);

  const load = useCallback(async () => {
    if (routed.kind !== 'none') return;
    try {
      const list = (await guard(() => chat().myRooms())).filter((r) => r.memberState === 'active');
      setRooms(list);
      setRoomId((cur) => cur ?? list[0]?.id ?? null);
    } catch (e) {
      if (errorCode(e) === 'not_signed_in') {
        consume();
        router.replace('/welcome');
      } else {
        setRooms([]);
        setErr('Chats couldn’t load. You can still make a link.');
      }
    }
  }, [chat, guard, router, routed.kind, consume]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const tooBig = !!file && file.size > MAX_ATTACHMENT_BYTES;
  const canSend = !!roomId && !busy && !tooBig && (file ? true : text.trim().length > 0);
  const room = rooms?.find((r) => r.id === roomId) ?? null;
  const cancel = () => {
    consume();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  async function send() {
    if (!roomId || !canSend) return;
    setBusy(true);
    setErr('');
    try {
      const ttl = room?.ttl ?? 60;
      if (file) await guard(() => chat().sendFile(roomId, fileSource(file), ttl, viewOnce));
      else await guard(() => chat().send(roomId, text.trim(), ttl));
      consume();
      void chat().notifyRoom(roomId);
      router.replace(`/room/${roomId}`);
    } catch (e) {
      // The copy is not kept for a retry: a failed send leaves nothing behind either (P2-3). The
      // shared text stays in state, so "Make a one-time link" still works; a file needs a new share.
      consume();
      setErr(friendlyError(errorCode(e)));
      setBusy(false);
    }
  }

  if (routed.kind !== 'none') return <Screen testID="share.screen" />;

  if (mode === 'link') {
    return (
      <Screen
        scroll
        header={<Header close title="One-time link" onBack={() => setMode('chat')} testID="share.backToChat" />}
        testID="share.screen"
      >
        <SecretComposer
          target={null}
          fixed
          initialText={file ? '' : text}
          initialFile={file}
          onLinkMade={consume}
          onDone={cancel}
        />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      header={<Header close title="Send with OnePeek" onBack={cancel} testID="share.cancel" />}
      testID="share.screen"
      footer={
        <Button
          title={busy ? 'Encrypting…' : 'Encrypt and send'}
          busy={busy}
          disabled={!canSend}
          onPress={send}
          testID="share.send"
        />
      }
    >
      {file ? (
        <View
          style={styles.card}
          accessible
          accessibilityLabel={`Shared file, ${fileSize(file.size)}`}
          testID="share.file"
        >
          <View style={styles.fileIcon}>
            <Icon name={(file.mime ?? '').startsWith('image/') ? 'image' : 'file'} size={24} color={colors.accent} />
          </View>
          <View style={styles.fileMain}>
            <Text variant="title" numberOfLines={1}>
              {file.name}
            </Text>
            <Text variant="meta" tone="muted">
              {fileSize(file.size)} · encrypted on this phone before upload
            </Text>
          </View>
        </View>
      ) : (
        <Field
          label="Shared text"
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={4}
          maxLength={4000}
          style={styles.textArea}
          {...SECRET_INPUT}
          testID="share.text"
        />
      )}
      {extra > 0 ? (
        <Text variant="meta" tone="muted" style={styles.hint}>
          Only the first file is sent. Share the others one at a time.
        </Text>
      ) : null}
      {skipped ? (
        <Text variant="meta" tone="muted" style={styles.hint} testID="share.skipped">
          Some items were skipped.
        </Text>
      ) : null}
      {tooBig ? <Notice tone="error" text="Files can be up to 50 MB." /> : null}

      {file ? (
        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text variant="title">View once</Text>
            <Text variant="meta" tone="muted">
              Opens one time, then it’s gone for everyone.
            </Text>
          </View>
          <Switch
            value={viewOnce}
            onValueChange={setViewOnce}
            trackColor={{ true: colors.accent, false: colors.segOn }}
            thumbColor={colors.white}
            accessibilityLabel="View once"
            testID="share.viewOnce"
          />
        </View>
      ) : null}

      <SectionLabel>Send to a chat</SectionLabel>
      <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel="Send to a chat">
        {rooms === null ? (
          <Text variant="sub" tone="muted" center style={styles.empty}>
            Loading…
          </Text>
        ) : rooms.length === 0 ? (
          <Text variant="sub" tone="muted" center style={styles.empty} testID="share.noRooms">
            No active chats on this phone. Make a one-time link instead.
          </Text>
        ) : (
          rooms.map((r) => {
            const on = r.id === roomId;
            return (
              <Pressable
                key={r.id}
                onPress={() => setRoomId(r.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on, selected: on }}
                accessibilityLabel={roomTitle(r)}
                accessibilityHint={`${KIND_NAME[r.kind]}, messages disappear ${ttlLabel(r.ttl)} after reading`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                testID="share.room"
              >
                <Avatar icon={kindIcon(r.kind)} accent={r.kind === 'secret'} />
                <Text variant="title" numberOfLines={1} style={styles.rowTitle}>
                  {roomTitle(r)}
                </Text>
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
              </Pressable>
            );
          })
        )}
      </View>

      <Pressable
        onPress={() => setMode('link')}
        accessibilityRole="button"
        accessibilityLabel="Make a one-time link instead"
        style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
        testID="share.link"
      >
        <Icon name="link" size={18} color={colors.text} />
        <Text variant="title">Make a one-time link instead</Text>
      </Pressable>
      {err ? (
        <View style={styles.err}>
          <Notice tone="error" text={err} testID="share.error" />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  fileIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileMain: { flex: 1, gap: 2 },
  textArea: { minHeight: 110, textAlignVertical: 'top' },
  hint: { marginTop: spacing.sm, marginHorizontal: spacing.xs },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    minHeight: touchTarget,
  },
  toggleText: { flex: 1, gap: 2 },
  list: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  empty: { padding: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowTitle: { flex: 1 },
  pressed: { opacity: 0.85 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.ghostBorder,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accentText },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    minHeight: touchTarget + 8,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.ghostBorder,
  },
  err: { marginTop: spacing.md },
});
