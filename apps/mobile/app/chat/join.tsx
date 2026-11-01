// Deep-link entry for invites: `https://onepeek.io/chat/join#<token>` (Universal Link / App Link)
// and `onepeek://chat/join#<token>`. The token is the URL fragment, read from the full URL via
// expo-linking (it never appears in route params or a request) and handed straight to the core.
// The QR scanner and the share target arrive here too, with the link parked in lib/links' hand-off.
import { useLinkingURL } from 'expo-linking';
import { useState } from 'react';
import { JoinScreen } from '../../components/JoinScreen';
import { inviteTokenFrom } from '@/lib/format';
import { takeHandoff } from '@/lib/links';

export default function JoinDeepLinkRoute() {
  const url = useLinkingURL();
  const [handed] = useState(() => takeHandoff('invite'));
  const token = inviteTokenFrom(handed) ?? inviteTokenFrom(url);
  return <JoinScreen key={token ?? ''} initialToken={token} />;
}
