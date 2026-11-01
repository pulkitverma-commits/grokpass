// One-time secret from the Chats home (design 07 without a chat): text or a file becomes a
// onepeek.io link through lib/secrets. There is no chat to send into here, so the composer offers
// the link only; "Send link in this chat" lives in the room's version.
import { useRouter } from 'expo-router';
import { useSecureScreen } from '@/security';
import { Header } from '../components/Header';
import { Screen } from '../components/Screen';
import { SecretComposer } from '../components/SecretComposer';

export default function SecretScreen() {
  const router = useRouter();
  useSecureScreen('secret:new');
  const done = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  return (
    <Screen scroll header={<Header close title="One-time secret" />} testID="secret.screen">
      <SecretComposer target={null} onDone={done} />
    </Screen>
  );
}
