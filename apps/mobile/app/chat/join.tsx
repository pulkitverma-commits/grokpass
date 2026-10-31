// Deep-link entry for invites: `https://onepeek.io/chat/join#<token>` (Universal Link / App Link)
// and `onepeek://chat/join#<token>`. The token is the URL fragment, read from the full URL via
// expo-linking (it never appears in route params or a request) and handed straight to the core.
import { useLinkingURL } from 'expo-linking';
import { JoinScreen } from '../../components/JoinScreen';
import { inviteTokenFrom } from '@/lib/format';

export default function JoinDeepLinkRoute() {
  const url = useLinkingURL();
  return <JoinScreen key={url ?? ''} initialToken={inviteTokenFrom(url)} />;
}
