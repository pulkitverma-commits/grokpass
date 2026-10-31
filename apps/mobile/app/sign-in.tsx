// Sign in (design 02). Apple (identity token + nonce), Google through the system browser, an email
// link, or guest. Passkeys are offered on the web but there is no native passkey library in the app
// yet, so that entry is hidden here (see PASSKEYS_AVAILABLE); the lead decides at Gate 1.
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { Notice } from '../components/Notice';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { colors, spacing } from '../theme';
import { AUTH_REDIRECT_URL, auth } from '@/lib/chat';

// Closes a leftover browser auth window on web; a no-op on phones.
WebBrowser.maybeCompleteAuthSession();

/** Passkey sign-in needs a native WebAuthn bridge the app does not have yet. Hidden until it does. */
const PASSKEYS_AVAILABLE = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hex(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

type Busy = null | 'apple' | 'google' | 'email' | 'guest';

export default function SignInScreen() {
  const router = useRouter();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  async function apple() {
    setErr(''); setBusy('apple');
    try {
      // The raw nonce goes to our auth server; Apple gets its SHA-256 and binds it into the identity token.
      const nonce = hex(Crypto.getRandomBytes(16));
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashed,
      });
      if (!cred.identityToken) throw new Error('no_identity_token');
      await auth.signInWithApple(cred.identityToken, nonce);
      router.replace('/');
    } catch (e) {
      if ((e as { code?: string })?.code !== 'ERR_REQUEST_CANCELED') setErr('Sign in with Apple didn’t work. Try again.');
      setBusy(null);
    }
  }

  async function google() {
    setErr(''); setBusy('google');
    try {
      const url = await auth.startOAuth('google');
      const result = await WebBrowser.openAuthSessionAsync(url, AUTH_REDIRECT_URL);
      if (result.type === 'success') {
        const ok = await auth.completeFromUrl(result.url);
        if (!ok) throw new Error('not_completed');
        router.replace('/');
        return;
      }
      setBusy(null);
    } catch {
      setErr('Google sign-in didn’t work. Try again.');
      setBusy(null);
    }
  }

  async function sendLink() {
    const to = email.trim().toLowerCase();
    if (!EMAIL_RE.test(to)) { setErr('Enter your email address.'); return; }
    setErr(''); setBusy('email');
    try {
      await auth.sendEmailLink(to);
      setSentTo(to);
    } catch (e) {
      setErr((e as { code?: string })?.code === 'rate_limited' ? 'Too many attempts. Wait a few minutes and try again.' : 'The link couldn’t be sent. Check the address and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function guest() {
    setErr(''); setBusy('guest');
    try {
      await auth.signInAsGuest();
      router.replace('/');
    } catch {
      setErr('Guest sign-in didn’t work. Try again.');
      setBusy(null);
    }
  }

  return (
    <Screen scroll header={<Header />} testID="signin.screen">
      <Text variant="display" tone="heading" accessibilityRole="header">Sign in</Text>
      <Text variant="sub" tone="muted" style={styles.sub}>
        Use the same account as onepeek.io. Your chats stay on this phone; the server only holds encrypted messages.
      </Text>

      <View style={styles.buttons}>
        {PASSKEYS_AVAILABLE ? <Button title="Continue with a passkey" icon="key" disabled testID="signin.passkey" /> : null}
        {appleAvailable ? (
          <Button title="Sign in with Apple" variant="secondary" leading={<Icon name="apple" size={18} color={colors.accentText} />} busy={busy === 'apple'} disabled={!!busy && busy !== 'apple'} onPress={apple} testID="signin.apple" />
        ) : null}
        <Button title="Continue with Google" variant="ghost" leading={<Icon name="google" size={18} />} busy={busy === 'google'} disabled={!!busy && busy !== 'google'} onPress={google} testID="signin.google" />
      </View>

      <View style={styles.or} accessible={false}>
        <View style={styles.rule} /><Text variant="meta" tone="muted">or</Text><View style={styles.rule} />
      </View>

      {sentTo ? (
        <View style={styles.sent} testID="signin.emailSent">
          <Notice tone="success" icon="mail" text={`Check your inbox. We sent a sign-in link to ${sentTo}. Open it on this phone to finish signing in.`} />
          <Button title="Use a different email" variant="link" block={false} small onPress={() => { setSentTo(''); setErr(''); }} testID="signin.emailAgain" />
        </View>
      ) : (
        <>
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@company.com" autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="send" onSubmitEditing={sendLink} testID="signin.email" />
          <Button title="Email me a sign-in link" variant="ghost" busy={busy === 'email'} disabled={!!busy && busy !== 'email'} onPress={sendLink} testID="signin.sendLink" />
        </>
      )}

      {err ? <View style={styles.err}><Notice tone="error" text={err} testID="signin.error" /></View> : null}

      <View style={styles.guestBox}>
        <Icon name="user" size={20} color={colors.accent} />
        <View style={styles.guestText}>
          <Text variant="meta" tone="muted">
            Got an invite?{' '}
            <Text variant="meta" tone="accent" accessibilityRole="link" onPress={() => router.push('/join')} testID="signin.joinGuest">Join that chat as a guest</Text>, no account needed.
          </Text>
          <Text variant="meta" tone="muted">
            No account?{' '}
            <Text variant="meta" tone="accent" accessibilityRole="button" accessibilityState={{ busy: busy === 'guest' }} onPress={busy ? undefined : guest} testID="signin.guest">Start a Quick Chat as a guest</Text>
          </Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { marginTop: spacing.sm, marginBottom: spacing.xxl },
  buttons: { gap: spacing.md },
  or: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.xl },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  sent: { gap: spacing.sm, alignItems: 'flex-start' },
  err: { marginTop: spacing.md },
  guestBox: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', marginTop: spacing.xxl * 1.5, padding: spacing.lg, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  guestText: { flex: 1, gap: spacing.sm },
});
