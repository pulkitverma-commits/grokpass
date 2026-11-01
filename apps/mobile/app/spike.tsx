// Phase 0 spike screen (lead-owned, removed after Gate 0). Proves on a real phone what the Node
// tests cannot: quick-crypto's WebCrypto surface on Hermes, ts-mls group operations and their
// speed, the SecureStore + SQLite keystore round trip, and AES-GCM throughput for attachments.
// Nothing here talks to the network. Numbers go into docs/mobile/gates/phase-0.md.
import { decryptBytes, encryptBytes, newKey } from '@onepeek/core/src/crypto';
import * as mls from '@onepeek/core/src/chat/mls';
import { assertSubtleSupport, createRnKeyStore } from '@onepeek/core/src/rn';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

type Line = { label: string; value: string; ok?: boolean };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const ms = (t: number) => `${t.toFixed(1)} ms`;

async function runSpike(push: (l: Line) => void) {
  push({ label: 'device', value: `${Device.modelName ?? 'unknown'} · ${Platform.OS} ${Platform.Version}` });

  // 1. WebCrypto surface
  try {
    assertSubtleSupport();
    push({ label: 'subtle', value: 'encrypt/decrypt/digest/importKey/exportKey/generateKey/sign/verify/deriveBits', ok: true });
  } catch (e) {
    push({ label: 'subtle', value: String((e as Error).message), ok: false });
    return;
  }

  // 2. MLS: two devices, one room, 200 messages each way, state save/load
  const N = 200;
  let t = now();
  const signA = await mls.newSigningKey();
  const signB = await mls.newSigningKey();
  const kpA = await mls.newKeyPackage('device-a', signA);
  const kpB = await mls.newKeyPackage('device-b', signB);
  push({ label: 'mls keys + packages', value: ms(now() - t), ok: true });

  t = now();
  let stateA = await mls.createRoom('spike-room', kpA);
  const added = await mls.addMembers(stateA, [kpB.publicBytes]);
  stateA = added.state;
  let stateB = await mls.joinRoom(added.welcome!, kpB);
  push({ label: 'mls create + add + join', value: ms(now() - t), ok: mls.memberLeaves(stateB).length === 2 });

  const bodies: string[] = [];
  t = now();
  const cts: Uint8Array[] = [];
  for (let i = 0; i < N; i++) {
    const r = await mls.encrypt(stateA, { t: 'text', id: `m${i}`, body: `message ${i} ${'x'.repeat(60)}`, ttl: 30 });
    stateA = r.state;
    cts.push(r.ciphertext);
  }
  const tEnc = now() - t;
  t = now();
  for (const ct of cts) {
    const got = await mls.receive(stateB, ct, 'device-b');
    stateB = got.state;
    if (got.kind === 'message' && got.payload.t === 'text') bodies.push(got.payload.body);
  }
  const tDec = now() - t;
  push({ label: `mls encrypt ${N}`, value: `${ms(tEnc)} (${(tEnc / N).toFixed(2)} ms/msg)`, ok: true });
  push({ label: `mls decrypt ${N}`, value: `${ms(tDec)} (${(tDec / N).toFixed(2)} ms/msg)`, ok: bodies.length === N && bodies[N - 1]?.startsWith(`message ${N - 1}`) });

  t = now();
  const saved = mls.saveState(stateB);
  const restored = mls.loadState(saved);
  push({ label: 'mls state save+load', value: `${ms(now() - t)} · ${(saved.byteLength / 1024).toFixed(1)} KB`, ok: mls.epoch(restored) === mls.epoch(stateB) });

  t = now();
  const rot = await mls.rotate(stateA);
  const gotRot = await mls.receive(stateB, rot.commit, 'device-b');
  push({ label: 'mls rotate (commit)', value: ms(now() - t), ok: gotRot.kind === 'commit' && !gotRot.removedSelf });

  // 3. Keystore on the real SecureStore + SQLite (separate file so it never touches chat data)
  t = now();
  // Own SecureStore entry and own database: the spike's wipe() must never touch the chat keystore (review N1).
  const ks = createRnKeyStore({ secureStore: SecureStore, sqlite: SQLite, dbName: 'onepeek-spike.db', wrapKeyId: 'onepeek.wrap.spike' });
  await ks.put('spike:state', saved);
  const back = await ks.get<Uint8Array>('spike:state');
  const same = !!back && back.byteLength === saved.byteLength && back.every((b, i) => b === saved[i]);
  push({ label: 'keystore put+get (group state)', value: ms(now() - t), ok: same });
  const big = new Uint8Array(400 * 1024).map((_, i) => i & 0xff);
  t = now();
  await ks.put('spike:big', big);
  const bigBack = await ks.get<Uint8Array>('spike:big');
  push({ label: 'keystore 400 KB round trip', value: ms(now() - t), ok: !!bigBack && bigBack.byteLength === big.byteLength });
  await ks.wipe();
  push({ label: 'keystore wipe', value: (await ks.get('spike:big')) === null ? 'unreadable after wipe' : 'STILL READABLE', ok: (await ks.get('spike:big')) === null });

  // 4. AES-GCM throughput for attachments (5 MB in memory; the 50 MB case is a Gate 1 check)
  const { key } = await newKey();
  const data = new Uint8Array(5 * 1024 * 1024);
  t = now();
  const blob = await encryptBytes(key, data);
  const tE = now() - t;
  t = now();
  const plain = await decryptBytes(key, blob);
  push({ label: 'aes-gcm 5 MB encrypt / decrypt', value: `${ms(tE)} / ${ms(now() - t)}`, ok: plain.byteLength === data.byteLength });
}

export default function Spike() {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const text = lines.map((l) => `${l.ok === undefined ? '·' : l.ok ? 'OK ' : 'FAIL'} ${l.label}: ${l.value}`).join('\n');

  async function run() {
    setBusy(true); setErr(''); setLines([]);
    try {
      await runSpike((l) => setLines((prev) => [...prev, l]));
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0A0C0F' }} contentContainerStyle={{ padding: 20, paddingTop: 64, gap: 12 }}>
      <Text style={{ color: '#E6E8EB', fontSize: 22 }}>Phase 0 crypto spike</Text>
      <Text style={{ color: '#A3ABB6' }}>Runs on this phone only. Nothing is sent anywhere.</Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={run}
        style={{ backgroundColor: '#C8F135', borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
      >
        <Text style={{ color: '#0A0C0F', fontWeight: '600' }}>{busy ? 'Running…' : 'Run spike'}</Text>
      </Pressable>
      {err ? <Text style={{ color: '#ff6b6b' }}>{err}</Text> : null}
      <View style={{ gap: 6 }}>
        {lines.map((l, i) => (
          <Text key={i} style={{ color: l.ok === false ? '#ff6b6b' : l.ok ? '#89DB96' : '#E6E8EB', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) }}>
            {l.ok === undefined ? '·' : l.ok ? 'OK  ' : 'FAIL'} {l.label}: {l.value}
          </Text>
        ))}
      </View>
      {lines.length ? (
        <Pressable accessibilityRole="button" onPress={() => Clipboard.setStringAsync(text)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: '#C8F135' }}>Copy results</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
